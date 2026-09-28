import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const envPath = path.resolve(".env");
const approvalKey = crypto.randomBytes(24).toString("hex");
const starter = `# Launch Guard local configuration
PORT=8787
APPROVAL_KEY=${approvalKey}

# Leave false during the dry-run trial.
LIVE_DEPLOY_ENABLED=false
AUTO_LAUNCH_ENABLED=false
J7_REGION=eu
J7_JWT=
J7_ENCRYPTED_SOLANA_KEY=
# Public Solana address only. If set, receives 100% of Pump creator fees.
CREATOR_FEE_WALLET=
DEV_BUY_SOL=0

# VyceAI research and review (OpenAI-compatible gateway)
AI_PROVIDER=VyceAI
AI_BASE_URL=https://vyceai.com/v1
AI_API_KEY=
AI_MODEL=deepseek-v4-flash
MAX_AI_RESEARCH_PER_BATCH=2
MAX_AI_REVIEWS_PER_HOUR=6
MAX_NEWS_AI_PER_HOUR=6
J7_BROWSER_WORKER_ENABLED=true
J7_BROWSER_SCAN_INTERVAL_MS=1000
J7_BROWSER_ENGINE=extension

MIN_SCORE=84
MAX_SIGNAL_AGE_MINUTES=12
MIN_AUTHOR_FOLLOWERS=50000
MIN_VIEWS=25000
MIN_ENGAGEMENT=500
MIN_ENGAGEMENTS_PER_MINUTE=35

# Hard budget guard. Update WALLET_BALANCE_SOL after deposits or launches.
WALLET_BALANCE_SOL=0
RESERVE_SOL=0.015
ESTIMATED_LAUNCH_COST_SOL=0.0025
MAX_LIVE_LAUNCHES_PER_DAY=2
LIVE_LAUNCH_COOLDOWN_MINUTES=120
`;

try {
  await fs.writeFile(envPath, starter, { flag: "wx", mode: 0o600 });
  console.log("Created .env with safe dry-run defaults and a random approval key.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const current = await fs.readFile(envPath, "utf8");
  const additions = [];
  if (!/^AUTO_LAUNCH_ENABLED=/m.test(current)) additions.push("AUTO_LAUNCH_ENABLED=false");
  if (!/^CREATOR_FEE_WALLET=/m.test(current)) additions.push("# Public Solana address only. If set, receives 100% of Pump creator fees.\nCREATOR_FEE_WALLET=");
  if (!/^AI_PROVIDER=/m.test(current)) additions.push("# VyceAI research and review\nAI_PROVIDER=VyceAI");
  if (!/^AI_BASE_URL=/m.test(current)) additions.push("AI_BASE_URL=https://vyceai.com/v1");
  if (!/^AI_API_KEY=/m.test(current)) additions.push("AI_API_KEY=");
  if (!/^AI_MODEL=/m.test(current)) additions.push("AI_MODEL=deepseek-v4-flash");
  if (!/^MAX_AI_RESEARCH_PER_BATCH=/m.test(current)) additions.push("MAX_AI_RESEARCH_PER_BATCH=2");
  if (!/^MAX_AI_REVIEWS_PER_HOUR=/m.test(current)) additions.push("MAX_AI_REVIEWS_PER_HOUR=6");
  if (!/^MAX_NEWS_AI_PER_HOUR=/m.test(current)) additions.push("MAX_NEWS_AI_PER_HOUR=6");
  if (!/^J7_BROWSER_WORKER_ENABLED=/m.test(current)) additions.push("J7_BROWSER_WORKER_ENABLED=true");
  if (!/^J7_BROWSER_SCAN_INTERVAL_MS=/m.test(current)) additions.push("J7_BROWSER_SCAN_INTERVAL_MS=1000");
  if (!/^J7_BROWSER_ENGINE=/m.test(current)) additions.push("J7_BROWSER_ENGINE=firefox");
  if (additions.length) {
    await fs.appendFile(envPath, `\n${additions.join("\n")}\n`, { mode: 0o600 });
    console.log("Added missing Launch Guard settings to the existing .env.");
  } else console.log(".env already exists; it was not changed.");
}
console.log("Next: add your J7 JWT and J7 encrypted Solana key to .env. Add only a public address to CREATOR_FEE_WALLET. Never add a raw private key or seed phrase.");
console.log("Run npm start, then open http://127.0.0.1:8787");
