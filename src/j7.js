import { config, J7_BASES } from "./config.js";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function isSolanaAddress(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  const bytes = [0];
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let index = 0; index < value.length - 1 && value[index] === "1"; index += 1) bytes.push(0);
  return bytes.length === 32;
}

export function deploymentPayload(candidate, { redactApiKey = false } = {}) {
  if (config.creatorFeeWallet && !isSolanaAddress(config.creatorFeeWallet)) {
    throw new Error("CREATOR_FEE_WALLET must be a valid public Solana wallet address");
  }
  const payload = {
    type: "create_token",
    external: true,
    mode: "pump",
    api_key: redactApiKey
      ? "<redacted:J7_ENCRYPTED_SOLANA_KEY>"
      : (config.j7EncryptedKey || "<J7_ENCRYPTED_SOLANA_KEY>"),
    name: candidate.name,
    ticker: candidate.ticker,
    description: candidate.description,
    twitter: candidate.sourceUrl,
    image_url: candidate.imageUrl || "",
    buy_amount: config.devBuySol,
  };
  if (config.creatorFeeWallet) {
    payload.pump_fee_shareholders = [{ address: config.creatorFeeWallet, share_bps: 10000 }];
  }
  return payload;
}

export async function deployCandidate(candidate) {
  if (!config.liveDeployEnabled) {
    return { dryRun: true, payload: deploymentPayload(candidate, { redactApiKey: true }) };
  }
  if (!config.j7Jwt || !config.j7EncryptedKey) throw new Error("J7_JWT and J7_ENCRYPTED_SOLANA_KEY are required for live deploy");
  if (candidate.status !== "approved") throw new Error("Candidate must be explicitly approved before deployment");
  const base = J7_BASES[config.j7Region];
  if (!base) throw new Error(`Unsupported J7_REGION: ${config.j7Region}`);

  const response = await fetch(`${base}/submit`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.j7Jwt}`,
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(deploymentPayload(candidate)),
    signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.type !== "token_create_success") {
    throw new Error(data.error || `J7 deployment failed (${response.status})`);
  }
  return { dryRun: false, ...data };
}
