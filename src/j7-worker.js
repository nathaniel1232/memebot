import path from "node:path";
import { chromium, firefox } from "playwright-core";
import { config } from "./config.js";

const appBase = `http://127.0.0.1:${config.port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const seen = new Set();
let context;
let timer;
let scanning = false;
let lastStatusKey = "";
let lastStatusAt = 0;

async function post(pathname, value) {
  const response = await fetch(`${appBase}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Local service returned ${response.status}`);
  return response.json();
}

async function status(state, message, extra = {}) {
  const key = `${state}|${message}`;
  if (key === lastStatusKey && Date.now() - lastStatusAt < 10_000) return;
  lastStatusKey = key;
  lastStatusAt = Date.now();
  try { await post("/api/worker/status", { state, message, ...extra }); } catch {}
}

async function scan(page) {
  if (scanning) return;
  scanning = true;
  try {
    const cards = await page.locator(".tweet-card").evaluateAll((nodes) => nodes.slice(0, 30).map((card) => {
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
        replies: 0,
      };
    }));
    const valid = cards.filter((item) => item.sourceUrl && item.text);
    const fresh = valid.filter((item) => !seen.has(item.sourceUrl));
    for (const item of valid) seen.add(item.sourceUrl);
    if (seen.size > 5000) {
      const keep = [...seen].slice(-2500);
      seen.clear();
      keep.forEach((url) => seen.add(url));
    }
    if (!fresh.length) return;
    const result = await post("/api/research/batch", { items: fresh.slice(0, 30) });
    const shortlisted = (result.items || []).filter((item) => ["watching", "shortlisted"].includes(item.verdict)).length;
    const originalPosts = fresh.filter((item) => item.eventType === "post").length;
    await post("/api/discovery/report", {
      postsSeen: fresh.length,
      originalPosts,
      shortlisted,
      source: "J7Tracker continuous browser worker",
      note: `One-second watcher processed ${fresh.length} new J7 item${fresh.length === 1 ? "" : "s"}; ${result.aiCalls || 0} AI review${result.aiCalls === 1 ? "" : "s"}.`,
    });
    await status("watching", "J7 connected · checking for new cards every second", { postsSeen: fresh.length, lastBatch: new Date().toISOString() });
  } catch (error) {
    await status("error", `Watcher error: ${String(error.message || error).slice(0, 180)}`);
  } finally {
    scanning = false;
  }
}

export async function startJ7Worker() {
  const useFirefox = config.j7BrowserEngine === "firefox";
  const browserType = useFirefox ? firefox : chromium;
  const profileDir = path.resolve(useFirefox ? "data/j7-firefox-profile" : "data/j7-chrome-profile");
  await status("starting", `Opening the dedicated J7 watcher in ${useFirefox ? "Firefox" : "Chrome"}`);
  context = await browserType.launchPersistentContext(profileDir, {
    ...(useFirefox ? {} : { executablePath: chromePath }),
    headless: false,
    viewport: { width: 1280, height: 850 },
    ...(useFirefox ? {} : { args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] }),
  });
  let page = context.pages().find((item) => item.url().startsWith("https://j7tracker.io"));
  if (!page) page = await context.newPage();
  if (!page.url().startsWith("https://j7tracker.io")) await page.goto("https://j7tracker.io/", { waitUntil: "domcontentloaded" });
  await status("needs_login", `Sign into J7 once in the dedicated ${useFirefox ? "Firefox" : "Chrome"} window`);
  timer = setInterval(async () => {
    const cardCount = await page.locator(".tweet-card").count().catch(() => 0);
    if (!cardCount) {
      await status("needs_login", `Sign into J7 once in the dedicated ${useFirefox ? "Firefox" : "Chrome"} window`);
      return;
    }
    await scan(page);
  }, config.j7BrowserScanIntervalMs);
  const stop = async () => {
    clearInterval(timer);
    await status("stopped", "J7 watcher stopped");
    await context?.close().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { stop };
}
