const baseUrl = "http://127.0.0.1:8787";
const MAX_QUEUE = 500;
const queue = [];
const deliveries = new Map();
let processing = false;
let queueWakeTimer = null;
let j7TabId = null;
let activeCommandId = null;
let deliveredCount = 0;
const pumpCommandsSeen = new Set();
let pumpCommandPollInFlight = false;
let researchPaused = false;
let controlPollInFlight = false;

async function post(path, value) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`Launch Guard returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function updateQueueStatus(delivered = false) {
  const held = [...deliveries.values()].filter((entry) => ["uncertain", "held"].includes(entry.state)).length;
  post("/api/worker/status", {
    state: researchPaused ? "stopped" : held ? "error" : "watching",
    message: researchPaused ? "AI research stopped · no new reviews" : held
      ? `Firefox has ${held} held delivery${held === 1 ? "" : "ies"}; inspect the item errors before retrying.`
      : `J7 connected in Firefox · ${queue.length} research item${queue.length === 1 ? "" : "s"} queued or retrying`,
    queuePending: queue.length,
    queueUncertain: held,
    ...(delivered ? { postsSeen: deliveredCount, lastBatch: new Date().toISOString() } : {}),
  }).catch(() => {});
}

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      if (researchPaused) return;
      const now = Date.now();
      const entry = queue.find((candidate) => (candidate.readyAt || 0) <= now);
      if (!entry) {
        const wait = Math.max(50, Math.min(...queue.map((candidate) => candidate.readyAt || now + 50)) - now);
        clearTimeout(queueWakeTimer);
        queueWakeTimer = setTimeout(() => { queueWakeTimer = null; processQueue(); }, wait);
        return;
      }
      entry.state = "sending";
      updateQueueStatus();
      try {
        // A one-item request avoids the server's per-batch AI cap delaying later posts.
        const result = await post("/api/research/batch", { items: [entry.item] });
        if (!Array.isArray(result.items) || !result.items.length) throw new Error("Launch Guard did not confirm the research item");
        const reviewed = result.items[0];
        if (reviewed.verdict === "error") {
          entry.attempts = (entry.attempts || 0) + 1;
          if (entry.attempts >= 3) {
            queue.splice(queue.indexOf(entry), 1);
            entry.state = "held";
            entry.error = `Server review failed after ${entry.attempts} attempts: ${reviewed.reason || "unknown error"}`;
            entry.resolve({ ok: false, sourceUrl: entry.url, error: entry.error });
            updateQueueStatus();
            continue;
          }
          entry.state = "retrying";
          entry.readyAt = Date.now() + 65_000;
          updateQueueStatus();
          // The server caches errors for 60 seconds; retry beyond that window.
          continue;
        }
        if (reviewed.verdict === "queued") {
          const reason = String(reviewed.reason || "");
          if (/already being reviewed/i.test(reason)) {
            entry.state = "retrying";
            entry.readyAt = Date.now() + 3_000;
            updateQueueStatus();
            continue;
          }
          // No AI key or another server-side hold needs operator action, not repeated requests.
          queue.splice(queue.indexOf(entry), 1);
          entry.state = "held";
          entry.error = `Server held the item: ${reason || "review queued"}`;
          entry.resolve({ ok: false, sourceUrl: entry.url, error: entry.error });
          updateQueueStatus();
          continue;
        }
        queue.splice(queue.indexOf(entry), 1);
        entry.state = "delivered";
        deliveredCount += 1;
        if (reviewed) {
          const shortlisted = ["watching", "shortlisted"].includes(reviewed.verdict) ? 1 : 0;
          const originalPosts = entry.item.eventType === "post" ? 1 : 0;
          post("/api/discovery/report", {
            postsSeen: 1,
            originalPosts,
            shortlisted,
            source: "J7Tracker Firefox companion",
            note: `Firefox processed 1 new J7 item; ${result.aiCalls || 0} AI review${result.aiCalls === 1 ? "" : "s"}.`,
          }).catch(() => {});
        }
        entry.resolve({ ok: true, accepted: true, sourceUrl: entry.url });
        updateQueueStatus(true);
      } catch (error) {
        if (error.status === 503) {
          researchPaused = true;
          entry.state = "queued";
          updateQueueStatus();
          continue;
        }
        // The server now dedupes saved and in-flight source URLs. Delay retries past its error cache.
        entry.attempts = (entry.attempts || 0) + 1;
        entry.error = String(error.message || error).slice(0, 180);
        if (entry.attempts >= 3) {
          queue.splice(queue.indexOf(entry), 1);
          entry.state = "held";
          entry.resolve({ ok: false, uncertain: true, sourceUrl: entry.url, error: entry.error });
        } else {
          entry.state = "retrying";
          entry.readyAt = Date.now() + 65_000;
        }
        updateQueueStatus();
      }
    }
  } finally {
    processing = false;
    if (queue.length && !queueWakeTimer && !researchPaused) processQueue();
  }
}

function enqueue(item) {
  const url = String(item.sourceUrl || "");
  const existing = deliveries.get(url);
  if (existing) {
    if (existing.state === "delivered") return Promise.resolve({ ok: true, accepted: true, sourceUrl: url });
    if (["uncertain", "held"].includes(existing.state)) return Promise.resolve({ ok: false, uncertain: existing.state === "uncertain", sourceUrl: url, error: existing.error });
    return existing.promise;
  }
  if (queue.length >= MAX_QUEUE) {
    return Promise.resolve({ ok: false, full: true, sourceUrl: url, error: "Firefox research queue is full" });
  }
  if (deliveries.size >= 5000) {
    for (const [oldUrl, oldEntry] of deliveries) {
      if (oldEntry.state === "delivered") deliveries.delete(oldUrl);
      if (deliveries.size < 4000) break;
    }
  }
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const entry = { item, url, resolve, promise, state: "queued", attempts: 0, createdAt: Date.now() };
  deliveries.set(url, entry);
  queue.push(entry);
  processQueue();
  return promise;
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (sender.tab?.id && sender.url?.startsWith("https://j7tracker.io/")) j7TabId = sender.tab.id;
  if (message?.type === "status") {
    if (message.value?.state === "watching") return updateQueueStatus();
    return post("/api/worker/status", message.value).catch(() => null);
  }
  if (message?.type !== "batch" || !Array.isArray(message.items) || !message.items.length) return null;
  if (researchPaused) return { ok: false, results: message.items.map((item) => ({ ok: false, paused: true, sourceUrl: item.sourceUrl })) };
  // Preserve every card from the scan; queue processing sends one item at a time.
  const results = await Promise.all(message.items.map((item) => enqueue(item)));
  return { ok: results.every((result) => result.ok), results };
});

async function checkDraftCommand() {
  if (activeCommandId || !j7TabId) return;
  try {
    const response = await fetch(`${baseUrl}/api/browser-command`);
    if (!response.ok) return;
    const { command } = await response.json();
    if (!command || command.id === activeCommandId) return;
    activeCommandId = command.id;
    let result;
    try {
      result = await browser.tabs.sendMessage(j7TabId, { type: "prepare_j7_draft", candidate: command.candidate });
    } catch (error) {
      result = { ok: false, message: `Could not reach the J7 page: ${String(error.message).slice(0, 160)}` };
    }
    await post("/api/browser-command/result", { id: command.id, success: result?.ok === true, message: result?.message || "J7 did not confirm the draft" });
  } catch (_) {
    // The local dashboard may be restarting. The command remains queued until it expires.
  } finally {
    activeCommandId = null;
  }
}

setInterval(checkDraftCommand, 2000);

async function pumpPostResult(result) {
  let lastError = "Pump.fun result request failed";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${baseUrl}/api/pump-draft/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Launch Guard returned ${response.status}`);
      return;
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 160);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 300 : 900));
  }
  throw new Error(lastError);
}

async function waitForPumpContent(tabId, timeout = 20_000) {
  const startedAt = Date.now();
  let lastError = "Pump.fun form is still loading";
  while (Date.now() - startedAt < timeout) {
    try {
      const reply = await browser.tabs.sendMessage(tabId, { type: "pump_draft_ping" });
      if (reply?.ready) return;
      lastError = "Pump.fun draft helper is not ready";
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 160);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Pump.fun form did not become ready: ${lastError}`);
}

async function handlePumpDraftCommand(command) {
  const result = { id: command.id, success: false, message: "Draft preparation did not complete", fields: {} };
  let tabId = null;
  try {
    const tab = await browser.tabs.create({ url: "https://pump.fun/create" });
    tabId = tab.id;
    await waitForPumpContent(tabId);
    const prepared = await browser.tabs.sendMessage(tabId, {
      type: "prepare_pump_draft",
      draft: command.draft || {},
    });
    result.success = prepared?.success === true;
    result.message = prepared?.message || "Pump.fun did not confirm all requested draft fields";
    result.fields = prepared?.fields || {};
  } catch (error) {
    result.message = String(error?.message || error).slice(0, 240);
  }
  try {
    await pumpPostResult(result);
  } catch (error) {
    // Keep this command ID consumed even if reporting fails, so polling cannot open duplicate tabs.
    console.warn("Could not report Pump.fun draft result", String(error?.message || error));
  }
}

async function checkPumpDraftCommand() {
  if (pumpCommandPollInFlight) return;
  pumpCommandPollInFlight = true;
  try {
    const response = await fetch(`${baseUrl}/api/pump-draft/command`);
    if (!response.ok) return;
    const { command } = await response.json();
    if (!command || !command.id || pumpCommandsSeen.has(command.id)) return;
    // Record before opening a tab or reporting, including on any later failure.
    pumpCommandsSeen.add(command.id);
    if (pumpCommandsSeen.size > 2000) pumpCommandsSeen.clear();
    pumpCommandsSeen.add(command.id);
    await handlePumpDraftCommand(command);
  } catch (_) {
    // The local dashboard may be restarting; retry polling on the next interval.
  } finally {
    pumpCommandPollInFlight = false;
  }
}

setInterval(checkPumpDraftCommand, 1000);

async function checkResearchControl() {
  if (controlPollInFlight) return;
  controlPollInFlight = true;
  try {
    const response = await fetch(`${baseUrl}/api/research-control`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return;
    const { paused } = await response.json();
    if (paused !== researchPaused) {
      researchPaused = paused === true;
      updateQueueStatus();
      if (!researchPaused) processQueue();
    }
  } catch (_) {
    // Keep the last known stop state while the local server reconnects.
  } finally { controlPollInFlight = false; }
}

setInterval(checkResearchControl, 1000);
checkResearchControl();
