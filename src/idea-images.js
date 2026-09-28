import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { isResearchPaused, runAbortableAi } from "./ai.js";

const imageDir = path.resolve("data/generated-ideas");
const dailyLimit = 3;
const maxBytes = 8 * 1024 * 1024;

export function wantsOriginalArt(item) {
  return item.generateOriginalArt === true
    && item.verdict === "shortlisted"
    && item.risk !== "high"
    && Boolean(item.proposedName && item.proposedTicker && item.narrative)
    && (item.visualPotential === "high" || (!item.visualPotential && Boolean(item.memeAngle)));
}

function imagePrompt(item) {
  const concept = String(item.visualPrompt || item.memeAngle || item.narrative).slice(0, 300);
  return `Draw an original square mascot illustration for a playful internet meme concept called ${String(item.proposedName).slice(0, 32)}. The visual joke: ${concept}. Narrative context: ${String(item.narrative).slice(0, 180)}. Make the central character or object instantly readable as a small circular profile image. Bold silhouette, expressive face or action, simple high contrast background, polished digital illustration, visually funny, one strong focal point. No words, letters, ticker, currency symbols, charts, promises of money, existing logos, recognizable people, brands, copyrighted characters, or copied meme templates. Do not depict any source person's identity.`;
}

export async function originalArtFor(item) {
  if (!wantsOriginalArt(item)) return null;
  if (isResearchPaused()) return { error: "AI is stopped; original art was skipped." };
  if (!config.aiKey || new URL(config.aiBaseUrl).hostname !== "api.openai.com") return { error: "OpenAI image generation is not configured." };
  await fs.mkdir(imageDir, { recursive: true });
  const prompt = imagePrompt(item);
  const hash = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 24);
  const files = await fs.readdir(imageDir);
  const cached = files.find((file) => file.endsWith(`-${hash}.jpg`));
  if (cached) {
    const image = await fs.readFile(path.join(imageDir, cached));
    return { dataUrl: `data:image/jpeg;base64,${image.toString("base64")}`, cached: true };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (files.filter((file) => file.startsWith(`${today}-`) && file.endsWith(".jpg")).length >= dailyLimit) {
    return { error: `Daily original-art limit (${dailyLimit}) reached.` };
  }
  const response = await runAbortableAi((signal) => fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.aiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2.5-flare", prompt, size: "1024x1024", quality: "medium", output_format: "jpeg", output_compression: 72, n: 1 }),
    signal,
  }).then(async (result) => {
    const data = await result.json();
    if (!result.ok) throw new Error(`Image API ${result.status}: ${String(data.error?.message || "request failed").slice(0, 150)}`);
    return data;
  }), 135_000);
  if (isResearchPaused()) return { error: "AI was stopped before the image could be saved." };
  const encoded = response.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error("Image API returned no usable image");
  const image = Buffer.from(encoded, "base64");
  if (image.length < 1_000 || image.length > maxBytes || image[0] !== 0xff || image[1] !== 0xd8) throw new Error("Image API returned an invalid or oversized JPEG");
  await fs.writeFile(path.join(imageDir, `${today}-${hash}.jpg`), image, { flag: "wx", mode: 0o600 });
  return { dataUrl: `data:image/jpeg;base64,${encoded}`, cached: false };
}
