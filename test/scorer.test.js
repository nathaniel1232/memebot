import test from "node:test";
import assert from "node:assert/strict";
import { scoreSignal, applyDuplicateGate } from "../src/scorer.js";

test("fresh high-velocity original signal reaches approval queue", () => {
  const now = Date.now();
  const result = scoreSignal({ text: "A viral dancing capybara rings a bell", sourceUrl: "https://x.com/a/status/1", imageUrl: "https://images.example/capybara.jpg", eventType: "post", postedAt: new Date(now - 120000).toISOString(), authorVerified: true, authorFollowers: 500000, likes: 20000, reposts: 5000, replies: 1000, views: 900000, originalMedia: true }, now);
  assert.equal(result.status, "needs_approval");
  assert.ok(result.score >= 72);
});

test("tragedy exploitation is hard blocked", () => {
  const result = scoreSignal({ text: "Token about a shooting victim", sourceUrl: "https://x.com/a/status/2", postedAt: new Date().toISOString(), authorVerified: true, likes: 999999, reposts: 999999, views: 9999999 });
  assert.equal(result.status, "blocked");
  assert.equal(result.score, 0);
});

test("unverified low-engagement signal is rejected", () => {
  const result = scoreSignal({ text: "ordinary post", sourceUrl: "https://x.com/a/status/3", postedAt: new Date(Date.now() - 60 * 60000).toISOString(), authorVerified: false });
  assert.equal(result.status, "rejected");
});

test("reply is rejected even with large reach", () => {
  const now = Date.now();
  const result = scoreSignal({ text: "A viral funny animal", sourceUrl: "https://x.com/a/status/4", imageUrl: "https://images.example/animal.jpg", eventType: "reply", postedAt: new Date(now - 60000).toISOString(), authorVerified: true, authorFollowers: 900000, likes: 40000, reposts: 10000, replies: 2000, views: 2000000, originalMedia: true }, now);
  assert.equal(result.status, "rejected");
  assert.ok(result.qualityGate.failed.some((reason) => reason.startsWith("Original post")));
});

test("early meme-shaped post enters watchlist without becoming launchable", () => {
  const now = Date.now();
  const result = scoreSignal({ text: "A tiny funny hippo refuses to leave the pond", sourceUrl: "https://x.com/a/status/early", imageUrl: "https://images.example/hippo.jpg", eventType: "post", postedAt: new Date(now - 60000).toISOString(), authorVerified: true, authorFollowers: 90000, views: 1000, likes: 20, reposts: 2, replies: 4, originalMedia: false }, now);
  assert.equal(result.status, "watching");
  assert.equal(result.qualityGate.discoveryPass, true);
  assert.equal(result.qualityGate.pass, false);
});

test("duplicate ticker is blocked", () => {
  const candidate = { id: "new", ticker: "BELL", name: "Bellbara", sourceUrl: "https://x.com/a/status/5", score: 90, status: "needs_approval", safety: { hardBlock: false, reasons: [] } };
  const result = applyDuplicateGate(candidate, [{ id: "old", ticker: "BELL", name: "Other", sourceUrl: "https://x.com/b/status/9" }]);
  assert.equal(result.status, "blocked");
  assert.equal(result.score, 0);
});
