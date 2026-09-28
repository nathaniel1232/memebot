const seen = new Set();
const inFlight = new Set();
const retryAt = new Map();
let scanTimer = null;
let lastConnectedNotice = 0;

function visible(element) {
  return Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(getElement, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const element = getElement();
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function prepareJ7Draft(candidate) {
  const nameInput = await waitFor(() => [...document.querySelectorAll("input")].find((input) => visible(input) && /token name/i.test(input.placeholder || "")), 250);
  if (!nameInput) {
    const createButton = [...document.querySelectorAll("button,a")].find((element) => visible(element) && element.textContent.trim().toLowerCase() === "create");
    if (!createButton) return { ok: false, message: "Could not find J7's Create form. Open Create in J7 and retry." };
    createButton.click();
  }
  const name = nameInput || await waitFor(() => [...document.querySelectorAll("input")].find((input) => visible(input) && /token name/i.test(input.placeholder || "")));
  const symbol = await waitFor(() => [...document.querySelectorAll("input")].find((input) => visible(input) && /symbol/i.test(`${input.placeholder} ${input.getAttribute("aria-label") || ""}`)));
  const postUrl = [...document.querySelectorAll("input")].find((input) => visible(input) && /x\.com|twitter\.com/i.test(input.placeholder || ""));
  if (!name || !symbol || !postUrl) return { ok: false, message: "J7's create form fields were not available. Open the form and retry." };
  if (!/^https:\/\//i.test(candidate.sourceUrl || "")) return { ok: false, message: "The source post link was missing or invalid; no fields were changed." };
  setInputValue(name, String(candidate.name || "").slice(0, 32));
  setInputValue(symbol, String(candidate.ticker || "").replace(/[^a-z0-9]/gi, "").slice(0, 13).toUpperCase());
  setInputValue(postUrl, candidate.sourceUrl);
  return { ok: true, message: "Draft filled in J7. Add an image and review all details, wallet, and fees in J7. No launch was submitted." };
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "prepare_j7_draft") return prepareJ7Draft(message.candidate || {});
  return undefined;
});

function extractCard(card) {
  const q = (selector) => card.querySelector(selector);
  const context = q(".context-link")?.textContent?.trim() || "";
  const sourceUrl = q(".context-link")?.href || "";
  const time = (q(".time-full") || q(".tweet-time"))?.textContent?.trim() || "";
  const match = time.match(/(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})/);
  const postedAt = match
    ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])).toISOString()
    : new Date().toISOString();
  const followers = Number((q(".follower-count-badge")?.getAttribute("title") || q(".follower-count-badge")?.textContent || "0").replace(/\D/g, ""));
  const media = q('.tweet-media img[alt="Media"], .tweet-media img');
  const eventType = /replied/i.test(context) ? "reply"
    : /retweeted/i.test(context) ? "repost"
      : /quoted/i.test(context) ? "quote"
        : /followed/i.test(context) ? "follow" : "post";
  return {
    author: q(".name")?.textContent?.trim() || "Unknown",
    text: (q(".tweet-content-left > .tweet-content")?.innerText || "").trim().slice(0, 1800),
    sourceUrl,
    postedAt,
    eventType,
    authorVerified: Boolean(q(".verified-badge,.business-badge")),
    authorFollowers: followers,
    imageUrl: media?.src || "",
    originalMedia: Boolean(media),
    views: 0,
    likes: 0,
    reposts: 0,
    replies: 0
  };
}

async function scanFeed() {
  const cards = [...document.querySelectorAll(".tweet-card")].slice(0, 30).map(extractCard).filter((item) => item.sourceUrl && item.text);
  if (Date.now() - lastConnectedNotice > 10_000) {
    lastConnectedNotice = Date.now();
    browser.runtime.sendMessage({ type: "status", value: {
      state: cards.length ? "watching" : "needs_login",
      message: cards.length ? "J7 feed connected" : "No readable J7 posts; open the feed and check its connection",
    } }).catch(() => {});
  }
  if (!cards.length) return;
  const now = Date.now();
  const fresh = cards.filter((item) => !seen.has(item.sourceUrl) && !inFlight.has(item.sourceUrl) && (retryAt.get(item.sourceUrl) || 0) <= now);
  if (!fresh.length) return;
  fresh.forEach((item) => inFlight.add(item.sourceUrl));
  try {
    const response = await browser.runtime.sendMessage({ type: "batch", items: fresh });
    const results = new Map((response?.results || []).map((result) => [result.sourceUrl, result]));
    fresh.forEach((item) => {
      const result = results.get(item.sourceUrl);
      inFlight.delete(item.sourceUrl);
      if (result?.ok && result.accepted) {
        seen.add(item.sourceUrl);
        retryAt.delete(item.sourceUrl);
      } else {
        const previous = retryAt.get(item.sourceUrl) || 0;
        retryAt.set(item.sourceUrl, Math.max(previous, Date.now() + (result?.full ? 10_000 : 30_000)));
      }
    });
  } catch (_) {
    fresh.forEach((item) => {
      inFlight.delete(item.sourceUrl);
      retryAt.set(item.sourceUrl, Date.now() + 10_000);
    });
  }
  if (seen.size > 5000) {
    const keep = [...seen].slice(-2500);
    seen.clear();
    keep.forEach((url) => seen.add(url));
  }
}

function scheduleScan() {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scanFeed();
  }, 100);
}

// React to new feed cards quickly while retaining the one-second safety scan.
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(scanFeed, 1000);
scheduleScan();
