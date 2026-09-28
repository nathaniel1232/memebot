import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { scoreSignal, aiReview, applyDuplicateGate } from "./scorer.js";
import { aiConfigured, requestJson, reviewResearchItem, setResearchPaused, isResearchPaused } from "./ai.js";
import { deployCandidate } from "./j7.js";
import { loadState, getState, saveCandidate, findCandidate, saveScan, saveResearch, saveResearchFeedback, recordPerformance, recordMarketObservation } from "./store.js";
import { deployedCoinStats, getTokenStats } from "./market.js";
import { canAutoLaunch } from "./autopilot.js";
import { marketOutcomeExamples } from "./learning.js";
import { fetchFreshArticles, sendNewsAlert, validNtfyTopic } from "./news.js";
import { pumpDraftStatus, pumpDraftCommand, completePumpDraft, preparePumpDraft } from "./pump-drafts.js";

const publicDir = path.resolve("public");
const envPath = path.resolve(".env");
const eventClients = new Set();
const launchesInProgress = new Set();
const researchInProgress = new Set();
const newsAiTimes = [];
const aiReviewTimes = [];
let newsScanInProgress = false;
let lastNewsScanAt = "";
let newsScanError = "";
let newsFeedErrors = [];
let newsLastStats = { scanned: 0, reviewed: 0, ideas: 0, shortlisted: 0 };
const firefoxExtensionOrigin = process.env.FIREFOX_EXTENSION_ORIGIN || "";
const firefoxCompanionRoutes = new Set(["/api/worker/status", "/api/research/batch", "/api/research-control", "/api/discovery/report", "/api/browser-command", "/api/browser-command/result", "/api/pump-draft/command", "/api/pump-draft/result"]);
let browserDraftCommand = null;
let workerStatus = {
  state: config.j7BrowserEngine === "extension" ? "needs_login" : "starting",
  message: config.j7BrowserEngine === "extension" ? "Open J7 in Firefox with the Launch Guard companion enabled" : "Waiting for the continuous J7 watcher",
  at: new Date().toISOString(),
};
const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value, null, 2));
};

function safeConfigured() {
  return {
    approvalKey: Boolean(config.approvalKey),
    autoLaunchEnabled: config.autoLaunchEnabled,
    j7Jwt: Boolean(config.j7Jwt),
    j7EncryptedKey: Boolean(config.j7EncryptedKey),
    creatorFeeWallet: Boolean(config.creatorFeeWallet),
    aiKey: Boolean(config.aiKey),
    phoneAlertsConfigured: Boolean(config.ntfyTopic),
    openaiKey: Boolean(config.aiKey),
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    aiBaseUrl: config.aiBaseUrl,
    devBuySol: config.devBuySol,
  };
}

function emitEvent(type, detail = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...detail })}\n\n`;
  for (const client of eventClients) client.write(message);
}

function validSecret(value, minimum = 20) {
  return typeof value === "string" && value.length >= minimum && value.length <= 4096 && !/[\r\n\0]/.test(value);
}

async function persistSecrets(values) {
  let current = "";
  try { current = await fs.readFile(envPath, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    current = pattern.test(current) ? current.replace(pattern, line) : `${current.trimEnd()}\n${line}\n`;
  }
  const temporary = `${envPath}.tmp`;
  await fs.writeFile(temporary, current, { mode: 0o600 });
  await fs.rename(temporary, envPath);
}
const body = async (req) => {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Body too large");
  }
  return value ? JSON.parse(value) : {};
};

function pruneAiReviewTimes(now = Date.now()) {
  while (aiReviewTimes.length && now - aiReviewTimes[0] >= 3_600_000) aiReviewTimes.shift();
  while (newsAiTimes.length && now - newsAiTimes[0] >= 3_600_000) newsAiTimes.shift();
  return Math.max(0, config.maxAiReviewsPerHour - aiReviewTimes.length);
}

await loadState();

function budgetStatus(now = Date.now()) {
  const deployed = getState().candidates.filter((candidate) => {
    const timestamp = Date.parse(candidate.deployedAt || "");
    return candidate.status === "deployed" && Number.isFinite(timestamp) && now - timestamp < 86_400_000;
  });
  const latest = deployed.map((candidate) => Date.parse(candidate.deployedAt)).sort((a, b) => b - a)[0] || 0;
  const cooldownRemainingMinutes = Math.max(0, Math.ceil((latest + config.liveLaunchCooldownMinutes * 60_000 - now) / 60_000));
  const affordable = Math.max(0, Math.floor((config.walletBalanceSol - config.reserveSol) / config.estimatedLaunchCostSol));
  const dailyRemaining = Math.max(0, config.maxLiveLaunchesPerDay - deployed.length);
  const blockers = [];
  if (dailyRemaining === 0) blockers.push("daily live-launch cap reached");
  if (cooldownRemainingMinutes > 0) blockers.push(`${cooldownRemainingMinutes} minute launch cooldown remaining`);
  if (affordable === 0) blockers.push("estimated wallet reserve would be breached");
  return {
    allowed: blockers.length === 0,
    blockers,
    launchesLast24Hours: deployed.length,
    dailyRemaining,
    cooldownRemainingMinutes,
    walletBalanceSol: config.walletBalanceSol,
    reserveSol: config.reserveSol,
    estimatedLaunchCostSol: config.estimatedLaunchCostSol,
    estimatedAffordableLaunches: affordable,
  };
}

async function scanNews() {
  if (isResearchPaused()) return { skipped: true, reason: "AI research is stopped" };
  if (newsScanInProgress) return { skipped: true, reason: "A news scan is already running" };
  newsScanInProgress = true;
  lastNewsScanAt = new Date().toISOString();
  newsScanError = "";
  let reviewedCount = 0;
  let alertCount = 0;
  try {
    const feedResult = await fetchFreshArticles();
    if (isResearchPaused()) return { skipped: true, reason: "AI research is stopped" };
    const articles = feedResult.articles;
    newsFeedErrors = feedResult.feedErrors;
    const existing = getState().research.filter((item) => item.sourceType === "news");
    const knownUrls = new Set(existing.filter((item) => item.verdict !== "error" && item.verdict !== "queued").map((item) => item.sourceUrl));
    const retryByUrl = new Map(existing.filter((item) => item.verdict === "error" || item.verdict === "queued").map((item) => [item.sourceUrl, item]));
    const now = Date.now();
    pruneAiReviewTimes(now);
    const remainingBudget = Math.min(
      Math.max(0, config.maxNewsAiPerHour - newsAiTimes.length),
      Math.max(0, config.maxAiReviewsPerHour - aiReviewTimes.length),
    );
    const fresh = articles.filter((article) => {
      if (knownUrls.has(article.sourceUrl)) return false;
      const previous = retryByUrl.get(article.sourceUrl);
      if (!previous) return true;
      if (!aiConfigured() || Number(previous.retryCount || 0) >= 3) return false;
      return !previous.nextRetryAt || Date.parse(previous.nextRetryAt) <= now;
    }).slice(0, Math.min(2, remainingBudget));
    const feedbackExamples = getState().research
      .filter((item) => item.userFeedback)
      .slice(0, 12)
      .map((item) => ({ headline: item.articleTitle || item.text.slice(0, 160), angle: item.memeAngle || "", feedback: item.userFeedback }));
    const outcomeLearning = marketOutcomeExamples(getState().candidates);
    const reviewed = [];
    for (const article of fresh) {
      if (isResearchPaused()) break;
      const previous = retryByUrl.get(article.sourceUrl);
      const item = { ...article, id: crypto.randomUUID(), checkedAt: new Date().toISOString(), authorVerified: true, ...(previous?.userFeedback ? { userFeedback: previous.userFeedback, userFeedbackAt: previous.userFeedbackAt } : {}) };
      let review;
      if (!aiConfigured()) {
        review = { aiUsed: false, verdict: "queued", reason: "Waiting for an AI provider key", risk: "unknown", memeAngle: "pending", narrative: "", proposedName: "", proposedTicker: "", model: config.aiModel };
      } else if (pruneAiReviewTimes() <= 0 || newsAiTimes.length >= config.maxNewsAiPerHour) {
        review = { aiUsed: false, verdict: "queued", reason: "Queued behind the hourly AI review limit", risk: "unknown", memeAngle: "pending", narrative: "", proposedName: "", proposedTicker: "", model: config.aiModel };
      } else {
        newsAiTimes.push(Date.now());
        aiReviewTimes.push(Date.now());
        try { review = await reviewResearchItem(item, outcomeLearning, feedbackExamples); }
        catch (error) { review = { aiUsed: false, verdict: "error", reason: error.message, risk: "unknown", memeAngle: "none", narrative: "", proposedName: "", proposedTicker: "", model: config.aiModel }; }
      }
      const retryCount = review.verdict === "error" || review.verdict === "queued" ? Number(previous?.retryCount || 0) + 1 : 0;
      const result = { ...item, ...review, retryCount, ...(retryCount > 0 ? { nextRetryAt: new Date(Date.now() + [120_000, 600_000, 1_800_000][Math.min(retryCount - 1, 2)]).toISOString() } : {}) };
      if (!retryCount) delete result.nextRetryAt;
      if (review.verdict === "shortlisted" && review.risk !== "high" && review.proposedName && review.proposedTicker) {
        if (config.ntfyTopic) {
          try {
            const outcome = await sendNewsAlert(config.ntfyTopic, result);
            result.notificationSent = outcome.sent;
            alertCount += Number(outcome.sent);
          } catch (error) {
            result.notificationError = String(error.message || "Phone alert failed").slice(0, 180);
          }
        } else result.notificationSent = false;
      }
      reviewed.push(result);
      reviewedCount += 1;
      emitEvent("research", { message: `${item.author}: ${review.verdict}`, item: { id: item.id, sourceUrl: item.sourceUrl, verdict: review.verdict, reason: review.reason } });
    }
    if (reviewed.length) await saveResearch(reviewed);
    newsLastStats = { scanned: articles.length, reviewed: reviewedCount, ideas: reviewed.filter((item) => ["watching", "shortlisted"].includes(item.verdict)).length, shortlisted: reviewed.filter((item) => item.verdict === "shortlisted").length };
    emitEvent("news", { message: `News scan checked ${articles.length} fresh headlines; ${reviewedCount} sent to AI; ${newsLastStats.ideas} ideas; ${alertCount} phone alerts` });
    return { ...newsLastStats, alerted: alertCount, feedErrors: newsFeedErrors, aiRemainingThisHour: pruneAiReviewTimes() };
  } catch (error) {
    newsScanError = String(error.message || "News scan failed").slice(0, 240);
    emitEvent("warning", { message: `News scan failed: ${newsScanError}` });
    return { scanned: 0, reviewed: reviewedCount, alerted: alertCount, feedErrors: newsFeedErrors, error: newsScanError };
  } finally {
    newsScanInProgress = false;
  }
}

async function maybeAutoLaunch(candidate) {
  if (!config.j7Jwt || !config.j7EncryptedKey) {
    if (config.autoLaunchEnabled && config.liveDeployEnabled && candidate.status === "needs_approval") {
      candidate.autoLaunchNote = "Autopilot is on, but J7 deployment credentials are incomplete.";
      await saveCandidate(candidate);
    }
    return candidate;
  }
  const guard = budgetStatus();
  const eligible = canAutoLaunch({
    enabled: config.autoLaunchEnabled,
    liveDeployEnabled: config.liveDeployEnabled,
    credentialsReady: Boolean(config.j7Jwt && config.j7EncryptedKey),
    budgetAllowed: guard.allowed,
    candidate,
  });
  if (!eligible || launchesInProgress.has(candidate.id)) {
    if (config.autoLaunchEnabled && config.liveDeployEnabled && candidate.status === "needs_approval" && !guard.allowed) {
      candidate.autoLaunchNote = `Autopilot held by spend guard: ${guard.blockers.join("; ")}`;
      await saveCandidate(candidate);
    }
    return candidate;
  }
  launchesInProgress.add(candidate.id);
  candidate.status = "approved";
  candidate.approvedAt = new Date().toISOString();
  candidate.approvalMode = "autopilot";
  await saveCandidate(candidate);
  try {
    const deployment = await deployCandidate(candidate);
    candidate.status = deployment.dryRun ? "dry_run_approved" : "deployed";
    if (!deployment.dryRun) candidate.deployedAt = new Date().toISOString();
    candidate.deployment = deployment;
    delete candidate.autoLaunchNote;
    delete candidate.lastDeploymentError;
    await saveCandidate(candidate);
    emitEvent("deployed", { message: `Autopilot launched ${candidate.name}`, candidateId: candidate.id, mint: deployment.mint_address || deployment.mint || "" });
  } catch (error) {
    candidate.status = "needs_approval";
    candidate.lastDeploymentError = error.message;
    candidate.autoLaunchNote = "Autopilot stopped after a deployment error; review this idea manually.";
    await saveCandidate(candidate);
    emitEvent("warning", { message: `Autopilot stopped for ${candidate.name}`, candidateId: candidate.id });
  } finally {
    launchesInProgress.delete(candidate.id);
  }
  return candidate;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const origin = req.headers.origin || "";
    if (origin && origin === firefoxExtensionOrigin && firefoxCompanionRoutes.has(url.pathname)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
          "Access-Control-Max-Age": "600",
        });
        return res.end();
      }
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        mode: config.liveDeployEnabled ? "live-enabled" : "dry-run",
        ai: aiConfigured(),
        researchPaused: isResearchPaused(),
        configured: safeConfigured(),
        worker: workerStatus,
        selection: {
          minScore: config.minScore,
          maxSignalAgeMinutes: config.maxSignalAgeMinutes,
          minAuthorFollowers: config.minAuthorFollowers,
          minViews: config.minViews,
          minEngagement: config.minEngagement,
          minVelocity: config.minVelocity,
        },
        budget: budgetStatus(),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      eventClients.add(res);
      req.on("close", () => eventClients.delete(res));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/worker/status") return json(res, 200, workerStatus);
    if (req.method === "GET" && url.pathname === "/api/research-control") return json(res, 200, { paused: isResearchPaused() });
    if (req.method === "POST" && url.pathname === "/api/research-control") {
      if (origin !== `http://127.0.0.1:${config.port}`) return json(res, 403, { error: "Use the local dashboard to stop or resume research" });
      const input = await body(req);
      if (typeof input.paused !== "boolean") return json(res, 400, { error: "paused must be true or false" });
      if (input.paused) setResearchPaused(true);
      try { await persistSecrets({ RESEARCH_PAUSED: input.paused }); }
      catch (error) { return json(res, 500, { error: `Could not save research control: ${error.message}` }); }
      config.researchPaused = input.paused;
      setResearchPaused(input.paused);
      emitEvent("research-control", { message: input.paused ? "AI research stopped" : "AI research resumed", paused: input.paused });
      return json(res, 200, { paused: input.paused });
    }
    if (req.method === "POST" && url.pathname === "/api/worker/status") {
      const input = await body(req);
      workerStatus = {
        state: ["starting", "needs_login", "watching", "error", "stopped"].includes(input.state) ? input.state : "error",
        message: String(input.message || "").slice(0, 240),
        postsSeen: Math.max(0, Number(input.postsSeen ?? workerStatus.postsSeen ?? 0)),
        lastBatch: String(input.lastBatch ?? workerStatus.lastBatch ?? ""),
        at: new Date().toISOString(),
      };
      emitEvent("worker", { message: workerStatus.message, worker: workerStatus });
      return json(res, 200, workerStatus);
    }
    if (req.method === "GET" && url.pathname === "/api/pump-draft/status") return json(res, 200, pumpDraftStatus());
    if (url.pathname === "/api/pump-draft/command" || url.pathname === "/api/pump-draft/result") {
      // Firefox background requests with a host permission may omit Origin.
      // Browser pages with any other origin never receive draft commands or report results.
      if (!firefoxExtensionOrigin || (origin ? origin !== firefoxExtensionOrigin : req.headers["sec-fetch-site"] === "cross-site")) return json(res, 403, { error: "Use the Firefox companion for draft delivery" });
      if (req.method === "GET" && url.pathname.endsWith("/command")) return json(res, 200, pumpDraftCommand());
      if (req.method === "POST" && url.pathname.endsWith("/result")) {
        if (!completePumpDraft(await body(req))) return json(res, 409, { error: "This draft is no longer pending" });
        const status = pumpDraftStatus();
        emitEvent("pump-draft", { message: status.job.message });
        return json(res, 200, { ok: true });
      }
    }
    const pumpDraftMatch = url.pathname.match(/^\/api\/research\/([^/]+)\/prepare-pump$/);
    if (req.method === "POST" && pumpDraftMatch) {
      if (origin !== `http://127.0.0.1:${config.port}`) return json(res, 403, { error: "Prepare drafts from the local dashboard" });
      const input = await body(req);
      const item = getState().research.find((entry) => entry.id === decodeURIComponent(pumpDraftMatch[1]));
      if (!item) return json(res, 404, { error: "Idea not found. Refresh the dashboard." });
      if (!["watching", "shortlisted"].includes(item.verdict)) return json(res, 409, { error: "Choose an idea from the concept board." });
      try {
        const status = preparePumpDraft({ ...item, generateOriginalArt: input.generateOriginalArt === true }, (updated) => emitEvent("pump-draft", { message: updated.job.message }));
        return json(res, 202, status);
      } catch (error) { return json(res, 409, { error: error.message }); }
    }
    if (req.method === "GET" && url.pathname === "/api/browser-command") {
      if (browserDraftCommand && Date.now() - browserDraftCommand.createdAt > 90_000) browserDraftCommand = null;
      return json(res, 200, { command: browserDraftCommand });
    }
    if (req.method === "POST" && url.pathname === "/api/browser-command/result") {
      const input = await body(req);
      if (!browserDraftCommand || input.id !== browserDraftCommand.id) return json(res, 404, { error: "Browser draft command not found" });
      const candidate = findCandidate(browserDraftCommand.candidate.id);
      if (candidate) {
        candidate.browserDraftStatus = input.success === true ? "prepared" : "error";
        candidate.browserDraftMessage = String(input.message || "J7 browser did not confirm the draft").slice(0, 240);
        candidate.browserDraftAt = new Date().toISOString();
        await saveCandidate(candidate);
        emitEvent("candidate", { message: candidate.browserDraftMessage, candidateId: candidate.id });
      }
      browserDraftCommand = null;
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/settings/secrets") {
      const input = await body(req);
      const updates = {};
      if (input.j7Jwt) {
        if (!validSecret(input.j7Jwt)) return json(res, 400, { error: "J7 session token does not look valid" });
        updates.J7_JWT = input.j7Jwt;
      }
      if (input.openaiKey) {
        if (!validSecret(input.openaiKey) || !input.openaiKey.startsWith("sk-")) return json(res, 400, { error: "OpenAI API key does not look valid" });
        updates.AI_API_KEY = input.openaiKey;
      }
      if (input.aiApiKey) {
        if (!validSecret(input.aiApiKey) || !input.aiApiKey.startsWith("sk-")) return json(res, 400, { error: "AI API key does not look valid" });
        updates.AI_API_KEY = input.aiApiKey;
      }
      if (input.aiBaseUrl) {
        let parsed;
        try { parsed = new URL(input.aiBaseUrl); } catch { return json(res, 400, { error: "AI base URL is invalid" }); }
        if (parsed.protocol !== "https:" || !["api.openai.com", "vyceai.com"].includes(parsed.hostname)) return json(res, 400, { error: "Only the verified OpenAI or VyceAI HTTPS endpoint is allowed here" });
        updates.AI_BASE_URL = input.aiBaseUrl.replace(/\/$/, "");
        updates.AI_PROVIDER = parsed.hostname === "api.openai.com" ? "OpenAI" : "VyceAI";
      }
      if (input.aiModel) {
        if (!/^[a-zA-Z0-9._:-]{2,80}$/.test(input.aiModel)) return json(res, 400, { error: "AI model ID is invalid" });
        updates.AI_MODEL = input.aiModel;
        if (!updates.AI_PROVIDER) updates.AI_PROVIDER = config.aiProvider;
      }
      if (!Object.keys(updates).length) return json(res, 400, { error: "Enter at least one credential" });
      await persistSecrets(updates);
      if (updates.J7_JWT) config.j7Jwt = updates.J7_JWT;
      if (updates.AI_API_KEY) config.aiKey = updates.AI_API_KEY;
      if (updates.AI_BASE_URL) config.aiBaseUrl = updates.AI_BASE_URL;
      if (updates.AI_MODEL) config.aiModel = updates.AI_MODEL;
      if (updates.AI_PROVIDER) config.aiProvider = updates.AI_PROVIDER;
      emitEvent("settings", { message: "Connection settings updated", configured: safeConfigured() });
      return json(res, 200, { ok: true, configured: safeConfigured() });
    }
    if (req.method === "POST" && url.pathname === "/api/settings/phone-alerts") {
      const input = await body(req);
      const topic = String(input.topic || "").trim();
      if (topic && !validNtfyTopic(topic)) return json(res, 400, { error: "Use a 12–64 character topic with letters, numbers, underscores, or hyphens." });
      await persistSecrets({ NTFY_TOPIC: topic });
      config.ntfyTopic = topic;
      emitEvent("settings", { message: topic ? "Phone alerts enabled for shortlisted news" : "Phone alerts disabled" });
      return json(res, 200, { ok: true, configured: Boolean(config.ntfyTopic) });
    }
    if (req.method === "POST" && url.pathname === "/api/notifications/test") {
      if (!validNtfyTopic(config.ntfyTopic)) return json(res, 409, { error: "Save your ntfy topic first." });
      try {
        const response = await fetch(`https://ntfy.sh/${encodeURIComponent(config.ntfyTopic)}`, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8", "Title": "Launch Guard connected", "Priority": "default" },
          body: "Phone alerts are connected. Only low or medium risk AI shortlists will send an alert.",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`ntfy returned ${response.status}`);
        return json(res, 200, { ok: true });
      } catch (error) { return json(res, 502, { error: String(error.message || "Phone alert failed").slice(0, 180) }); }
    }
    if (req.method === "POST" && url.pathname === "/api/settings/automation") {
      const origin = req.headers.origin;
      if (!origin || origin !== `http://${req.headers.host}`) return json(res, 403, { error: "Automation settings must be changed from this local dashboard" });
      const input = await body(req);
      if (input.confirm !== "I UNDERSTAND") return json(res, 400, { error: "Confirm the live-launch warning in the dashboard" });
      const liveDeployEnabled = input.liveDeployEnabled === true;
      const autoLaunchEnabled = liveDeployEnabled && input.autoLaunchEnabled === true;
      if (liveDeployEnabled && (!config.j7Jwt || !config.j7EncryptedKey)) return json(res, 409, { error: "Add the J7 session token and encrypted wallet credential before enabling live launches" });
      if (autoLaunchEnabled && !config.aiKey) return json(res, 409, { error: "Add and test an AI provider key before enabling autopilot" });
      await persistSecrets({ LIVE_DEPLOY_ENABLED: liveDeployEnabled, AUTO_LAUNCH_ENABLED: autoLaunchEnabled });
      config.liveDeployEnabled = liveDeployEnabled;
      config.autoLaunchEnabled = autoLaunchEnabled;
      emitEvent("settings", { message: autoLaunchEnabled ? "Autopilot settings enabled" : liveDeployEnabled ? "Manual live-launch setting enabled" : "Live launches disabled" });
      return json(res, 200, { ok: true, mode: liveDeployEnabled ? "live-enabled" : "dry-run", configured: safeConfigured() });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/test") {
      if (!aiConfigured()) return json(res, 409, { error: "An AI provider is not configured" });
      try {
        const result = await requestJson(
          "Return JSON only with ok=true and message='connected'. Do not add other fields.",
          { task: "health_check" },
        );
        return json(res, 200, { ok: result.value?.ok === true, provider: config.aiProvider, model: result.model, usage: result.usage || null });
      } catch (error) {
        return json(res, 502, { error: error.message, provider: config.aiProvider, model: config.aiModel });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/candidates") return json(res, 200, getState());
    if (req.method === "GET" && url.pathname === "/api/research") {
      const learning = marketOutcomeExamples(getState().candidates);
      const feedback = getState().research.filter((item) => item.userFeedback && item.sourceType === "news").length;
      return json(res, 200, { items: getState().research.slice(0, 100), learning: { sampleCount: learning.sampleCount, minimumForCalibration: learning.minimumForCalibration, newsFeedbackCount: feedback } });
    }
    if (req.method === "GET" && url.pathname === "/api/news/status") {
      const recentResearch = getState().research.filter((item) => Date.now() - Date.parse(item.checkedAt || 0) < 86_400_000);
      const availableIdeas = getState().research.filter((item) => ["watching", "shortlisted"].includes(item.verdict) && item.proposedName);
      return json(res, 200, { lastScanAt: lastNewsScanAt, scanning: newsScanInProgress, error: newsScanError, feedErrors: newsFeedErrors, ...newsLastStats, conceptsAvailable: availableIdeas.length, researchReviewedToday: recentResearch.filter((item) => item.verdict !== "queued" && item.verdict !== "error").length, pollIntervalMs: config.newsPollIntervalMs, aiRemainingThisHour: pruneAiReviewTimes(), phoneAlertsConfigured: validNtfyTopic(config.ntfyTopic) });
    }
    if (req.method === "POST" && url.pathname === "/api/news/scan") {
      const result = await scanNews();
      return json(res, result.error ? 502 : 200, result);
    }
    const feedbackMatch = url.pathname.match(/^\/api\/research\/([^/]+)\/feedback$/);
    if (req.method === "POST" && feedbackMatch) {
      const input = await body(req);
      if (!["good", "skip"].includes(input.value)) return json(res, 400, { error: "Feedback must be good or skip." });
      const item = await saveResearchFeedback(decodeURIComponent(feedbackMatch[1]), input.value);
      if (!item) return json(res, 404, { error: "Research item not found" });
      emitEvent("research", { message: `Feedback saved for ${item.proposedName || item.author}` });
      return json(res, 200, { ok: true, feedback: item.userFeedback });
    }
    const sendPhoneMatch = url.pathname.match(/^\/api\/research\/([^/]+)\/send-phone$/);
    if (req.method === "POST" && sendPhoneMatch) {
      if (origin !== `http://127.0.0.1:${config.port}`) return json(res, 403, { error: "Send ideas from the local dashboard" });
      const item = getState().research.find((entry) => entry.id === decodeURIComponent(sendPhoneMatch[1]));
      if (!item) return json(res, 404, { error: "Idea not found. Refresh the dashboard." });
      if (!["watching", "shortlisted"].includes(item.verdict) || !item.proposedName || !item.proposedTicker) return json(res, 409, { error: "Choose a complete concept from the idea board." });
      if (!validNtfyTopic(config.ntfyTopic)) return json(res, 409, { error: "Set up phone alerts first." });
      try {
        const outcome = await sendNewsAlert(config.ntfyTopic, item);
        return json(res, outcome.sent ? 200 : 502, outcome);
      } catch (error) { return json(res, 502, { error: String(error.message || "Phone alert failed").slice(0, 180) }); }
    }
    if (req.method === "POST" && url.pathname === "/api/research/batch") {
      if (isResearchPaused()) return json(res, 503, { error: "AI research is stopped" });
      const input = await body(req);
      if (!Array.isArray(input.items) || input.items.length === 0) return json(res, 400, { error: "items must be a non-empty array" });
      const items = input.items.slice(0, 30);
      const reviewed = [];
      let aiCalls = 0;
      const outcomeLearning = marketOutcomeExamples(getState().candidates);
      for (const raw of items) {
        const item = {
          id: crypto.randomUUID(),
          checkedAt: new Date().toISOString(),
          author: String(raw.author || "Unknown").slice(0, 80),
          text: String(raw.text || "").slice(0, 2400),
          sourceUrl: String(raw.sourceUrl || "").replace(/^https:\/\/twitter\.com\//i, "https://x.com/").slice(0, 500),
          postedAt: String(raw.postedAt || ""),
          eventType: String(raw.eventType || "post"),
          authorVerified: raw.authorVerified === true,
          authorFollowers: Math.max(0, Number(raw.authorFollowers || 0)),
          imageUrl: /^https:\/\//i.test(raw.imageUrl || "") ? String(raw.imageUrl).slice(0, 1000) : "",
          originalMedia: raw.originalMedia === true,
          views: Math.max(0, Number(raw.views || 0)),
          likes: Math.max(0, Number(raw.likes || 0)),
          reposts: Math.max(0, Number(raw.reposts || 0)),
          replies: Math.max(0, Number(raw.replies || 0)),
          sourceType: "social",
        };
        const previous = getState().research.find((entry) => entry.sourceUrl === item.sourceUrl);
        if (previous && (!["error", "queued"].includes(previous.verdict)
          || (previous.verdict === "error" && Date.now() - Date.parse(previous.checkedAt) < 60_000))) {
          reviewed.push(previous);
          continue;
        }
        if (researchInProgress.has(item.sourceUrl)) {
          reviewed.push({ ...item, verdict: "queued", reason: "This post is already being reviewed", aiUsed: false });
          continue;
        }
        researchInProgress.add(item.sourceUrl);
        try {
          let review;
          const ruleFailure = item.eventType !== "post" ? "Not an original post"
            : !/^https:\/\/x\.com\/[^/]+\/status\/\d+/i.test(item.sourceUrl) ? "No direct X post permalink was available"
              : !item.text.trim() ? "Post text was empty"
                : "";
          if (ruleFailure) {
            review = { aiUsed: false, verdict: "dismissed", reason: ruleFailure, risk: "medium", memeAngle: "none", proposedName: "", proposedTicker: "", usage: null, model: "rules" };
          } else if (!aiConfigured()) {
            review = { aiUsed: false, verdict: "queued", reason: "Waiting for an AI provider key", risk: "unknown", memeAngle: "pending", proposedName: "", proposedTicker: "", usage: null, model: config.aiModel };
          } else if (aiCalls >= config.maxAiResearchPerBatch || pruneAiReviewTimes() <= 0) {
            review = { aiUsed: false, verdict: "queued", reason: "Queued behind the hourly AI review limit", risk: "unknown", memeAngle: "pending", proposedName: "", proposedTicker: "", usage: null, model: config.aiModel };
          } else {
            aiCalls += 1;
            aiReviewTimes.push(Date.now());
            try { review = await reviewResearchItem(item, outcomeLearning, getState().research.filter((entry) => entry.userFeedback).slice(0, 12).map((entry) => ({ headline: entry.articleTitle || entry.text.slice(0, 160), angle: entry.memeAngle || "", feedback: entry.userFeedback }))); }
            catch (error) { review = { aiUsed: false, verdict: "error", reason: error.message, risk: "unknown", memeAngle: "none", proposedName: "", proposedTicker: "", usage: null, model: config.aiModel }; }
          }
          const result = { ...item, ...review };
          result.checkedAt = new Date().toISOString();
          await saveResearch([result]);
          reviewed.push(result);
          emitEvent("research", { message: `${item.author}: ${review.verdict}`, item: { id: item.id, sourceUrl: item.sourceUrl, verdict: review.verdict, reason: review.reason } });
          if (review.verdict === "shortlisted" && review.risk !== "high" && review.proposedName && review.proposedTicker && config.ntfyTopic) {
            try {
              const outcome = await sendNewsAlert(config.ntfyTopic, result);
              result.notificationSent = outcome.sent;
            } catch (error) {
              result.notificationError = String(error.message || "Phone alert failed").slice(0, 180);
            }
            await saveResearch([result]);
          }
          if (["watching", "shortlisted"].includes(review.verdict)) {
            let candidate = scoreSignal({ ...item, proposedName: review.proposedName, proposedTicker: review.proposedTicker });
            candidate.researchReview = review;
            candidate = applyDuplicateGate(candidate, getState().candidates);
            if (["watching", "needs_approval"].includes(candidate.status)) {
              candidate = await maybeAutoLaunch(candidate);
              await saveCandidate(candidate);
            }
          }
        } finally {
          researchInProgress.delete(item.sourceUrl);
        }
      }
      return json(res, 201, { reviewed: reviewed.length, aiCalls, items: reviewed });
    }
    if (req.method === "GET" && url.pathname === "/api/discovery") return json(res, 200, { lastScan: getState().lastScan });
    if (req.method === "POST" && url.pathname === "/api/discovery/report") {
      const lastScan = await saveScan(await body(req));
      emitEvent("scan", { message: `Scanned ${lastScan.postsSeen} posts; ${lastScan.shortlisted} shortlisted`, lastScan });
      return json(res, 201, { lastScan });
    }
    if (req.method === "GET" && url.pathname === "/api/coins") {
      const coins = await deployedCoinStats(getState().candidates);
      for (const coin of coins) if (coin.indexed) await recordMarketObservation(coin.candidateId, coin);
      return json(res, 200, { coins });
    }
    if (req.method === "GET" && url.pathname === "/api/analytics") {
      const coins = await deployedCoinStats(getState().candidates);
      const snapshot = {
        at: new Date().toISOString(),
        coinsLaunched: coins.length,
        estimatedFeesUsd: Number(coins.reduce((sum, coin) => sum + Number(coin.estimatedCreatorFees24hUsd || 0), 0).toFixed(6)),
      };
      const history = await recordPerformance(snapshot);
      return json(res, 200, { current: snapshot, history: history.slice(0, 288).reverse(), basis: "Estimated rolling 24h creator fees from indexed DEX volume; not confirmed wallet receipts." });
    }
    const statsMatch = url.pathname.match(/^\/api\/stats\/([^/]+)$/);
    if (req.method === "GET" && statsMatch) {
      const mint = decodeURIComponent(statsMatch[1]);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return json(res, 400, { error: "Invalid Solana mint address" });
      return json(res, 200, await getTokenStats(mint));
    }
    if (req.method === "POST" && url.pathname === "/api/signals") {
      const signal = await body(req);
      for (const required of ["text", "sourceUrl", "postedAt"]) {
        if (!signal[required]) return json(res, 400, { error: `Missing ${required}` });
      }
      let candidate = scoreSignal(signal);
      if (candidate.status !== "blocked" && aiConfigured()) {
        if (pruneAiReviewTimes() > 0) {
          aiReviewTimes.push(Date.now());
          try { candidate = (await aiReview(candidate)).candidate; }
          catch (error) { candidate.aiReviewError = error.message; }
        } else candidate.aiReviewDeferred = true;
      }
      candidate = applyDuplicateGate(candidate, getState().candidates);
      await saveCandidate(candidate);
      emitEvent("candidate", { message: `${candidate.name} scored ${candidate.score}`, candidate: { id: candidate.id, name: candidate.name, ticker: candidate.ticker, score: candidate.score, status: candidate.status } });
      return json(res, 201, candidate);
    }
    const dryRunMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)\/dry-run$/);
    if (req.method === "POST" && dryRunMatch) {
      if (config.liveDeployEnabled) return json(res, 409, { error: "Dashboard dry-run is disabled while live mode is enabled" });
      const candidate = findCandidate(decodeURIComponent(dryRunMatch[1]));
      if (!candidate) return json(res, 404, { error: "Candidate not found" });
      if (candidate.status !== "needs_approval") return json(res, 409, { error: `Candidate status is ${candidate.status}` });
      candidate.status = "approved";
      candidate.approvedAt = new Date().toISOString();
      const deployment = await deployCandidate(candidate);
      candidate.status = "dry_run_approved";
      candidate.deployment = deployment;
      await saveCandidate(candidate);
      emitEvent("dry-run", { message: `${candidate.name} dry-run prepared`, candidateId: candidate.id });
      return json(res, 200, candidate);
    }
    const browserDraftMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)\/prepare-browser$/);
    if (req.method === "POST" && browserDraftMatch) {
      if (!req.headers.origin || req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: "Browser drafts must be prepared from the local dashboard" });
      if (workerStatus.state !== "watching" || Date.now() - Date.parse(workerStatus.at) > 30_000) return json(res, 409, { error: "Open the signed-in J7 page in Firefox and wait for the watcher to connect" });
      if (browserDraftCommand) return json(res, 409, { error: "A J7 draft is already being prepared" });
      const candidate = findCandidate(decodeURIComponent(browserDraftMatch[1]));
      if (!candidate) return json(res, 404, { error: "Candidate not found" });
      if (candidate.status !== "needs_approval") return json(res, 409, { error: `Candidate status is ${candidate.status}` });
      browserDraftCommand = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        candidate: { id: candidate.id, name: candidate.name, ticker: candidate.ticker, sourceUrl: candidate.sourceUrl },
      };
      candidate.browserDraftStatus = "queued";
      candidate.browserDraftMessage = "Waiting for the signed-in J7 browser to prepare a draft";
      await saveCandidate(candidate);
      emitEvent("candidate", { message: candidate.browserDraftMessage, candidateId: candidate.id });
      return json(res, 202, { ok: true, status: "queued" });
    }
    const approveMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)\/approve$/);
    if (req.method === "POST" && approveMatch) {
      const sameOriginDashboard = Boolean(req.headers.origin) && req.headers.origin === `http://${req.headers.host}`;
      if ((!config.approvalKey || req.headers["x-approval-key"] !== config.approvalKey) && !sameOriginDashboard) return json(res, 401, { error: "Use the local dashboard or provide a valid x-approval-key" });
      const input = await body(req);
      if (input.confirm !== "DEPLOY LIVE") return json(res, 400, { error: "Body must contain confirm: DEPLOY LIVE" });
      const candidate = findCandidate(decodeURIComponent(approveMatch[1]));
      if (!candidate) return json(res, 404, { error: "Candidate not found" });
      if (candidate.status !== "needs_approval") return json(res, 409, { error: `Candidate status is ${candidate.status}` });
      if (config.liveDeployEnabled) {
        const guard = budgetStatus();
        if (!guard.allowed) return json(res, 429, { error: guard.blockers.join("; "), budget: guard });
      }
      candidate.status = "approved";
      candidate.approvedAt = new Date().toISOString();
      try {
        const deployment = await deployCandidate(candidate);
        candidate.status = deployment.dryRun ? "dry_run_approved" : "deployed";
        if (!deployment.dryRun) candidate.deployedAt = new Date().toISOString();
        candidate.deployment = deployment;
        delete candidate.lastDeploymentError;
        await saveCandidate(candidate);
        emitEvent(deployment.dryRun ? "dry-run" : "deployed", { message: deployment.dryRun ? `${candidate.name} dry-run prepared` : `${candidate.name} deployed`, candidateId: candidate.id, mint: deployment.mint || deployment.address || "" });
        return json(res, 200, candidate);
      } catch (error) {
        candidate.status = "needs_approval";
        candidate.lastDeploymentError = error.message;
        await saveCandidate(candidate);
        return json(res, 502, { error: error.message, candidate });
      }
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await fs.readFile(path.join(publicDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Launch Guard: http://127.0.0.1:${config.port} (${config.liveDeployEnabled ? "LIVE ENABLED" : "dry-run"})`);
  setTimeout(() => void scanNews(), 1500);
  setInterval(() => void scanNews(), config.newsPollIntervalMs).unref();
});
