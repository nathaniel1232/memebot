const DAY_MS = 24 * 60 * 60 * 1000;
const MINIMUM_EXAMPLES = 5;

export function deriveMarketOutcome(candidate, stats, now = Date.now()) {
  const launchedAt = Date.parse(candidate.deployedAt || "");
  if (!stats?.indexed || !Number.isFinite(launchedAt) || now - launchedAt < DAY_MS) return null;

  const volume24hUsd = Math.max(0, Number(stats.volume?.h24 || 0));
  const trades24h = Math.max(0, Number(stats.trades?.h24?.buys || 0) + Number(stats.trades?.h24?.sells || 0));
  const liquidityUsd = Math.max(0, Number(stats.liquidityUsd || 0));
  const active = volume24hUsd >= 100 && trades24h >= 5 && liquidityUsd >= 100;
  return {
    status: active ? "active" : "quiet",
    observedAt: new Date(now).toISOString(),
    ageHours: Math.round((now - launchedAt) / 3_600_000),
    volume24hUsd: Number(volume24hUsd.toFixed(2)),
    trades24h,
    liquidityUsd: Number(liquidityUsd.toFixed(2)),
  };
}

export function marketOutcomeExamples(candidates) {
  const examples = candidates
    .filter((candidate) => candidate.marketOutcome && candidate.status === "deployed")
    .sort((a, b) => Date.parse(b.deployedAt || 0) - Date.parse(a.deployedAt || 0))
    .slice(0, 12)
    .map((candidate) => ({
      initialSignal: {
        score: Number(candidate.score || 0),
        authorFollowers: Number(candidate.authorFollowers || 0),
        engagement: Number(candidate.engagement || 0),
        velocity: Number(candidate.velocity || 0),
        originalMedia: candidate.originalMedia === true,
        aiRisk: candidate.researchReview?.risk || "unknown",
        memeAngle: String(candidate.researchReview?.memeAngle || "").slice(0, 80),
      },
      observedMarket: candidate.marketOutcome,
    }));

  return { sampleCount: examples.length, minimumForCalibration: MINIMUM_EXAMPLES, examples };
}
