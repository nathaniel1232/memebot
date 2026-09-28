import fs from "node:fs/promises";
import path from "node:path";
import { deriveMarketOutcome } from "./learning.js";

const dataDir = path.resolve("data");
const statePath = path.join(dataDir, "state.json");
let state = { candidates: [], lastScan: null, research: [], performance: [] };
let persistTail = Promise.resolve();

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  const write = persistTail.then(async () => {
    const temp = `${statePath}.tmp`;
    await fs.writeFile(temp, snapshot);
    await fs.rename(temp, statePath);
  });
  persistTail = write.catch(() => {});
  return write;
}

export async function loadState() {
  await fs.mkdir(dataDir, { recursive: true });
  try { state = JSON.parse(await fs.readFile(statePath, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  state.candidates ||= [];
  state.lastScan ||= null;
  state.research ||= [];
  state.performance ||= [];
  return state;
}

export function getState() { return state; }

export async function saveCandidate(candidate) {
  const index = state.candidates.findIndex((item) => item.id === candidate.id);
  if (index >= 0) state.candidates[index] = candidate;
  else state.candidates.unshift(candidate);
  state.candidates = state.candidates.slice(0, 500);
  await persist();
  return candidate;
}

export async function saveScan(report) {
  state.lastScan = {
    scannedAt: new Date().toISOString(),
    postsSeen: Math.max(0, Number(report.postsSeen || 0)),
    originalPosts: Math.max(0, Number(report.originalPosts || 0)),
    shortlisted: Math.max(0, Number(report.shortlisted || 0)),
    source: String(report.source || "J7Tracker").slice(0, 80),
    note: String(report.note || "").slice(0, 300),
  };
  await persist();
  return state.lastScan;
}

export async function saveResearch(items) {
  for (const item of items) {
    const index = state.research.findIndex((existing) => existing.sourceUrl === item.sourceUrl);
    if (index >= 0) state.research[index] = item;
    else state.research.unshift(item);
  }
  state.research = state.research
    .sort((a, b) => Date.parse(b.checkedAt || 0) - Date.parse(a.checkedAt || 0))
    .slice(0, 500);
  await persist();
  return items;
}

export async function saveResearchFeedback(id, value) {
  const item = state.research.find((entry) => entry.id === id);
  if (!item) return null;
  item.userFeedback = value;
  item.userFeedbackAt = new Date().toISOString();
  await persist();
  return item;
}

export async function recordMarketObservation(candidateId, stats, now = Date.now()) {
  const candidate = state.candidates.find((item) => item.id === candidateId);
  if (!candidate || candidate.status !== "deployed" || !stats?.indexed) return null;
  candidate.marketObservations ||= [];
  const previous = candidate.marketObservations.at(-1);
  if (previous && now - Date.parse(previous.at) < 300_000) return candidate;
  candidate.marketObservations.push({
    at: new Date(now).toISOString(),
    priceUsd: Number(stats.priceUsd || 0),
    marketCapUsd: Number(stats.marketCapUsd || 0),
    liquidityUsd: Number(stats.liquidityUsd || 0),
    volume24hUsd: Number(stats.volume?.h24 || 0),
    trades24h: Number(stats.trades?.h24?.buys || 0) + Number(stats.trades?.h24?.sells || 0),
  });
  candidate.marketObservations = candidate.marketObservations.slice(-288);
  candidate.marketOutcome = deriveMarketOutcome(candidate, stats, now) || candidate.marketOutcome || null;
  await persist();
  return candidate;
}

export async function recordPerformance(snapshot) {
  const previous = state.performance[0];
  const now = Date.parse(snapshot.at);
  const changed = !previous
    || previous.coinsLaunched !== snapshot.coinsLaunched
    || Math.abs(previous.estimatedFeesUsd - snapshot.estimatedFeesUsd) >= 0.01;
  const stale = !previous || now - Date.parse(previous.at) >= 300_000;
  if (changed || stale) {
    state.performance.unshift(snapshot);
    state.performance = state.performance.slice(0, 720);
    await persist();
  }
  return state.performance;
}

export function findCandidate(id) { return state.candidates.find((item) => item.id === id); }
