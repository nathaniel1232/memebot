import process from "node:process";

const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  port: num("PORT", 8787),
  approvalKey: process.env.APPROVAL_KEY || "",
  liveDeployEnabled: process.env.LIVE_DEPLOY_ENABLED === "true",
  autoLaunchEnabled: process.env.AUTO_LAUNCH_ENABLED === "true",
  j7Region: process.env.J7_REGION || "eu",
  j7Jwt: process.env.J7_JWT || "",
  j7EncryptedKey: process.env.J7_ENCRYPTED_SOLANA_KEY || "",
  creatorFeeWallet: (process.env.CREATOR_FEE_WALLET || "").trim(),
  devBuySol: Math.max(0, num("DEV_BUY_SOL", 0)),
  aiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
  aiBaseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
  aiProvider: process.env.AI_PROVIDER || "OpenAI",
  aiModel: process.env.AI_MODEL || "gpt-6-luna",
  researchPaused: process.env.RESEARCH_PAUSED === "true",
  maxAiResearchPerBatch: Math.max(1, Math.min(4, Math.floor(num("MAX_AI_RESEARCH_PER_BATCH", 2)))),
  maxAiReviewsPerHour: Math.max(1, Math.min(24, Math.floor(num("MAX_AI_REVIEWS_PER_HOUR", 6)))),
  newsPollIntervalMs: Math.max(30_000, num("NEWS_POLL_INTERVAL_MS", 60_000)),
  maxNewsAiPerHour: Math.max(1, Math.min(24, Math.floor(num("MAX_NEWS_AI_PER_HOUR", 6)))),
  ntfyTopic: process.env.NTFY_TOPIC || "",
  j7BrowserWorkerEnabled: process.env.J7_BROWSER_WORKER_ENABLED !== "false",
  j7BrowserScanIntervalMs: Math.max(500, num("J7_BROWSER_SCAN_INTERVAL_MS", 1000)),
  j7BrowserEngine: ["chrome", "firefox", "extension"].includes(process.env.J7_BROWSER_ENGINE) ? process.env.J7_BROWSER_ENGINE : "extension",
  minScore: Math.min(100, Math.max(0, num("MIN_SCORE", 84))),
  maxSignalAgeMinutes: Math.max(1, num("MAX_SIGNAL_AGE_MINUTES", 12)),
  minAuthorFollowers: Math.max(0, num("MIN_AUTHOR_FOLLOWERS", 50_000)),
  minViews: Math.max(0, num("MIN_VIEWS", 25_000)),
  minEngagement: Math.max(0, num("MIN_ENGAGEMENT", 500)),
  minVelocity: Math.max(0, num("MIN_ENGAGEMENTS_PER_MINUTE", 35)),
  maxLiveLaunchesPerDay: Math.max(0, Math.floor(num("MAX_LIVE_LAUNCHES_PER_DAY", 2))),
  liveLaunchCooldownMinutes: Math.max(0, num("LIVE_LAUNCH_COOLDOWN_MINUTES", 120)),
  walletBalanceSol: Math.max(0, num("WALLET_BALANCE_SOL", 0)),
  reserveSol: Math.max(0, num("RESERVE_SOL", 0.015)),
  estimatedLaunchCostSol: Math.max(0.000001, num("ESTIMATED_LAUNCH_COST_SOL", 0.0025)),
};

export const J7_BASES = {
  eu: "https://tx-fra.j7tracker.io/deploy",
  nyc: "https://tx-nyc.j7tracker.io/deploy",
  lax: "https://tx-lax.j7tracker.io/deploy",
  sgp: "https://tx-sgp.j7tracker.io/deploy",
};
