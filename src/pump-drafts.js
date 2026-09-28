import crypto from "node:crypto";
import { originalArtFor, wantsOriginalArt } from "./idea-images.js";

let job = null;
let companionSeenAt = 0;
const activeStates = new Set(["preparing", "queued"]);

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

async function sourceImage(value) {
  const url = safeUrl(value);
  // Only public image CDN URLs are fetched. Never follow a redirect to an arbitrary host.
  if (!url || new URL(url).hostname !== "pbs.twimg.com") return "";
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Source image was unavailable");
  const type = response.headers.get("content-type")?.split(";")[0].toLowerCase();
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type)) throw new Error("Unsupported source image");
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) throw new Error("Source image was too large");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > limit) throw new Error("Source image was too large");
      chunks.push(Buffer.from(chunk));
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error("Source image was empty");
  return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
}

function expireJob() {
  if (job && activeStates.has(job.status) && Date.now() - job.createdAt > 240_000) {
    job.status = "error";
    job.message = "Firefox did not finish preparing this draft. Keep Firefox open and try again.";
    delete job.draft;
  }
}

export function pumpDraftStatus() {
  expireJob();
  const { draft, ...summary } = job || {};
  return { connected: Date.now() - companionSeenAt < 15_000, job: job ? summary : null };
}

export function pumpDraftCommand() {
  companionSeenAt = Date.now();
  expireJob();
  return { command: job?.status === "queued" ? { id: job.id, createdAt: job.createdAt, draft: job.draft } : null };
}

export function completePumpDraft(input) {
  expireJob();
  if (!job || job.id !== input.id || job.status !== "queued") return false;
  job.status = input.success === true ? "ready" : "error";
  job.message = String(input.message || (input.success ? "Draft filled in Firefox. Review it on Pump.fun." : "Firefox could not finish filling the draft.")).slice(0, 800);
  job.finishedAt = new Date().toISOString();
  // Store status only, never arbitrary HTML or credentials returned by a page.
  job.fields = Object.fromEntries(Object.entries(input.fields || {}).slice(0, 12).map(([key, value]) => [key.slice(0, 40), {
    ok: value?.ok === true,
    error: String(value?.error || "").slice(0, 200),
    filename: String(value?.filename || "").slice(0, 100),
    source: String(value?.source || "").slice(0, 40),
  }]));
  delete job.draft;
  return true;
}

export function preparePumpDraft(item, onChange = () => {}) {
  expireJob();
  if (job && activeStates.has(job.status)) throw new Error("A Pump.fun draft is already being prepared. Wait for its result.");
  if (Date.now() - companionSeenAt > 15_000) throw new Error("Open Firefox with the updated Launch Guard companion to fill Pump.fun automatically.");
  const name = String(item.proposedName || "").trim().slice(0, 32);
  const ticker = String(item.proposedTicker || "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
  if (!name || !ticker) throw new Error("This idea is missing a coin name or ticker.");
  const sourceUrl = safeUrl(item.sourceUrl);
  if (!sourceUrl) throw new Error("This idea has no valid source link.");
  const isX = /^(www\.)?(x\.com|twitter\.com)$/.test(new URL(sourceUrl).hostname);
  const draft = {
    name, ticker, sourceUrl,
    description: `${String(item.narrative || item.memeAngle || name).trim().slice(0, 500)}\n\nUnofficial meme concept. Inspired by: ${sourceUrl}`,
    xUrl: isX ? sourceUrl.replace("https://twitter.com/", "https://x.com/") : "",
    websiteUrl: isX ? "" : sourceUrl,
    imageDataUrl: "", imageKind: "generated-logo",
  };
  const current = job = { id: crypto.randomUUID(), itemId: item.id, name, ticker, createdAt: Date.now(), status: "preparing", message: `Preparing ${name} and its image for Firefox…`, draft };
  void (async () => {
    let artNote = "";
    try { draft.imageDataUrl = await sourceImage(item.imageUrl); }
    catch { /* Try original art only after confirming the source image is unavailable. */ }
    if (draft.imageDataUrl) {
      draft.imageKind = "source-image";
    } else if (wantsOriginalArt(item)) {
      try {
        const result = await originalArtFor(item);
        if (result?.dataUrl) { draft.imageDataUrl = result.dataUrl; draft.imageKind = "ai-original"; }
        else if (result?.error) artNote = result.error;
      } catch (error) { artNote = String(error.message || "Original art was unavailable").slice(0, 180); }
    }
    if (job !== current || current.status !== "preparing") return;
    current.status = "queued";
    const imageLabel = draft.imageKind === "ai-original" ? "original AI art" : draft.imageDataUrl ? "its source image" : "a simple local logo";
    current.message = `Opening ${name} in Firefox with ${imageLabel}…${artNote ? ` Original art unavailable: ${artNote}` : ""}`;
    onChange(pumpDraftStatus());
  })();
  return pumpDraftStatus();
}
