import test from "node:test";
import assert from "node:assert/strict";
import { deriveMarketOutcome, marketOutcomeExamples } from "../src/learning.js";

const now = Date.parse("2026-09-25T12:00:00.000Z");
const candidate = { id: "coin-1", status: "deployed", deployedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() };

test("waits a full day before learning from a token's market activity", () => {
  assert.equal(deriveMarketOutcome({ ...candidate, deployedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString() }, { indexed: true }, now), null);
  assert.equal(deriveMarketOutcome(candidate, { indexed: false }, now), null);
});

test("labels observable activity from volume, trades, and liquidity", () => {
  const outcome = deriveMarketOutcome(candidate, {
    indexed: true,
    volume: { h24: 500 },
    trades: { h24: { buys: 4, sells: 3 } },
    liquidityUsd: 250,
  }, now);
  assert.equal(outcome.status, "active");
  assert.equal(outcome.trades24h, 7);
  assert.equal(deriveMarketOutcome(candidate, { indexed: true, volume: { h24: 0 }, trades: { h24: {} }, liquidityUsd: 0 }, now).status, "quiet");
});

test("shares bounded observed outcomes with the AI only as a small evidence set", () => {
  const learning = marketOutcomeExamples([{ ...candidate, marketOutcome: { status: "active" }, score: 90 }]);
  assert.equal(learning.sampleCount, 1);
  assert.equal(learning.minimumForCalibration, 5);
  assert.equal(learning.examples[0].initialSignal.score, 90);
  assert.equal("text" in learning.examples[0], false);
});
