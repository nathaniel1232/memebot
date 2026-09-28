const CACHE_MS = 15_000;
const cache = new Map();

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function summarizePair(pair, mint) {
  const tx = pair.txns || {};
  const volume = pair.volume || {};
  const change = pair.priceChange || {};
  const baseIsMint = pair.baseToken?.address === mint;
  return {
    mint,
    dex: pair.dexId || "unknown",
    pairAddress: pair.pairAddress || "",
    url: pair.url || "",
    name: baseIsMint ? pair.baseToken?.name : pair.quoteToken?.name,
    ticker: baseIsMint ? pair.baseToken?.symbol : pair.quoteToken?.symbol,
    priceUsd: number(pair.priceUsd),
    marketCapUsd: number(pair.marketCap || pair.fdv),
    liquidityUsd: number(pair.liquidity?.usd),
    volume: {
      m5: number(volume.m5),
      h1: number(volume.h1),
      h24: number(volume.h24),
    },
    trades: {
      m5: { buys: number(tx.m5?.buys), sells: number(tx.m5?.sells) },
      h1: { buys: number(tx.h1?.buys), sells: number(tx.h1?.sells) },
      h24: { buys: number(tx.h24?.buys), sells: number(tx.h24?.sells) },
    },
    priceChange: {
      m5: number(change.m5),
      h1: number(change.h1),
      h24: number(change.h24),
    },
    estimatedCreatorFees24hUsd: number(volume.h24) * 0.003,
    updatedAt: new Date().toISOString(),
  };
}

export async function getTokenStats(mint) {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.value;

  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mint)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Market data failed (${response.status})`);
  const pairs = await response.json();
  if (!Array.isArray(pairs) || pairs.length === 0) {
    const empty = { mint, indexed: false, updatedAt: new Date().toISOString() };
    cache.set(mint, { savedAt: Date.now(), value: empty });
    return empty;
  }
  const best = [...pairs].sort((a, b) => number(b.liquidity?.usd) - number(a.liquidity?.usd))[0];
  const value = { indexed: true, ...summarizePair(best, mint) };
  cache.set(mint, { savedAt: Date.now(), value });
  return value;
}

export async function deployedCoinStats(candidates) {
  const deployed = candidates.filter((candidate) => candidate.status === "deployed" && candidate.deployment?.mint_address);
  return Promise.all(deployed.slice(0, 30).map(async (candidate) => {
    try {
      return { candidateId: candidate.id, launchedAt: candidate.deployedAt, sourceUrl: candidate.sourceUrl, ...await getTokenStats(candidate.deployment.mint_address) };
    } catch (error) {
      return { candidateId: candidate.id, mint: candidate.deployment.mint_address, indexed: false, error: error.message };
    }
  }));
}
