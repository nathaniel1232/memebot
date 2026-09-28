import crypto from "node:crypto";
import { config } from "./config.js";
import { safetyReview } from "./safety.js";
import { aiConfigured, reviewCandidateWithAi } from "./ai.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const logScore = (value, ceiling, points) => clamp(Math.log10(Math.max(1, value)) / Math.log10(ceiling), 0, 1) * points;

const MEME_SIGNAL = /\b(meme|viral|mascot|nickname|funny|bizarre|absurd|tiny|cute|animal|dog|cat|frog|duck|goat|monkey|capybara|raccoon|hippo|penguin|internet moment)\b/i;
const GENERIC_NEWS = /\b(reuters|report says|according to|stock|shares|earnings|security council|election|war|killed|injured)\b/i;

function candidateMetadata(signal) {
  const words = (signal.text || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && word.length <= 14)
    .slice(0, 3);
  const seed = words.join(" ") || "Fresh Internet Moment";
  const name = signal.proposedName || seed.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 32);
  const ticker = (signal.proposedTicker || words.map((w) => w[0]).join("") || "MEME")
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return { name, ticker, description: signal.description || `Community meme inspired by a fresh public internet moment. No affiliation or endorsement claimed.` };
}

export function scoreSignal(raw, now = Date.now()) {
  const signal = {
    ...raw,
    id: raw.id || crypto.randomUUID(),
    receivedAt: raw.receivedAt || new Date(now).toISOString(),
  };
  const postedAtMs = Date.parse(signal.postedAt || signal.receivedAt);
  const ageMinutes = Math.max(0, (now - postedAtMs) / 60_000);
  const engagement = Number(signal.likes || 0) + 2 * Number(signal.reposts || 0) + Number(signal.replies || 0);
  const velocity = engagement / Math.max(1, ageMinutes);

  const freshness = clamp(1 - ageMinutes / config.maxSignalAgeMinutes, 0, 1) * 20;
  const velocityScore = logScore(velocity, 250, 30);
  const reachScore = logScore(Number(signal.views || engagement), 1_000_000, 15);
  const authorScore = logScore(Number(signal.authorFollowers || 0), 5_000_000, 10);
  const engagementScore = logScore(engagement, 100_000, 10);
  const originality = signal.originalMedia === true ? 10 : 0;
  const memeability = MEME_SIGNAL.test(signal.text || "") ? 5 : 0;
  const genericNewsPenalty = GENERIC_NEWS.test(signal.text || "") ? 8 : 0;
  const review = safetyReview(signal);
  const qualityChecks = [
    { key: "original_post", label: "Original post (not a reply, repost, quote, or follow)", pass: (signal.eventType || "post") === "post" },
    { key: "verified_source", label: "Verified source account", pass: signal.authorVerified === true },
    { key: "original_media", label: "Original or licensed media", pass: signal.originalMedia === true },
    { key: "image_url", label: "Direct image URL supplied for the launch", pass: /^https:\/\/.+/i.test(signal.imageUrl || "") },
    { key: "meme_angle", label: "Clear standalone meme or character angle", pass: memeability > 0 },
    { key: "author_reach", label: `At least ${config.minAuthorFollowers.toLocaleString()} followers`, pass: Number(signal.authorFollowers || 0) >= config.minAuthorFollowers },
    { key: "views", label: `At least ${config.minViews.toLocaleString()} views`, pass: Number(signal.views || 0) >= config.minViews },
    { key: "engagement", label: `At least ${config.minEngagement.toLocaleString()} weighted engagements`, pass: engagement >= config.minEngagement },
    { key: "velocity", label: `At least ${config.minVelocity} engagements/min`, pass: velocity >= config.minVelocity },
    { key: "freshness", label: `No more than ${config.maxSignalAgeMinutes} minutes old`, pass: ageMinutes <= config.maxSignalAgeMinutes },
  ];
  const failedChecks = qualityChecks.filter((check) => !check.pass).map((check) => check.label);
  let score = Math.round(freshness + velocityScore + reachScore + authorScore + engagementScore + originality + memeability - genericNewsPenalty);
  if (review.reasons.includes("source identity is not verified by the input adapter")) score -= 12;
  if (review.hardBlock) score = 0;
  score = clamp(score, 0, 100);
  const qualityGate = failedChecks.length === 0;
  const check = Object.fromEntries(qualityChecks.map((item) => [item.key, item.pass]));
  const discoveryGate = check.original_post && check.verified_source && check.image_url && check.meme_angle && check.author_reach && check.freshness;
  const status = review.hardBlock
    ? "blocked"
    : qualityGate && score >= config.minScore
      ? "needs_approval"
      : discoveryGate
        ? "watching"
        : "rejected";

  return {
    ...signal,
    ...candidateMetadata(signal),
    ageMinutes: Number(ageMinutes.toFixed(2)),
    engagement,
    velocity: Number(velocity.toFixed(2)),
    score,
    safety: review,
    qualityGate: { pass: qualityGate, discoveryPass: discoveryGate, checks: qualityChecks, failed: failedChecks },
    status,
  };
}

export function applyDuplicateGate(candidate, existing = []) {
  const normalize = (value) => String(value || "").trim().toLowerCase();
  const duplicate = existing.find((item) => item.id !== candidate.id && (
    normalize(item.sourceUrl) === normalize(candidate.sourceUrl)
    || (normalize(item.ticker) && normalize(item.ticker) === normalize(candidate.ticker))
    || (normalize(item.name) && normalize(item.name) === normalize(candidate.name))
  ));
  if (!duplicate) return candidate;
  return {
    ...candidate,
    score: 0,
    status: "blocked",
    duplicateOf: duplicate.id,
    safety: {
      ...candidate.safety,
      hardBlock: true,
      reasons: [...new Set([...(candidate.safety?.reasons || []), "duplicate source, name, or ticker"])],
    },
  };
}

export async function aiReview(candidate) {
  if (!aiConfigured()) return { used: false, candidate };
  const { review: parsed, usage, model } = await reviewCandidateWithAi(candidate);
  const score = clamp(candidate.score + parsed.score_adjustment, 0, 100);
  const blocked = !parsed.safe || parsed.originality_risk === "high" || parsed.saturated_topic_risk === "high";
  return {
    used: true,
    candidate: {
      ...candidate,
      score,
      aiReview: parsed,
      aiUsage: usage,
      aiModel: model,
      status: blocked ? "blocked" : candidate.qualityGate?.pass && score >= config.minScore ? "needs_approval" : candidate.qualityGate?.discoveryPass ? "watching" : "rejected",
    },
  };
}
