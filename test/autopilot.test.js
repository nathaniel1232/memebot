import test from "node:test";
import assert from "node:assert/strict";
import { canAutoLaunch } from "../src/autopilot.js";

const candidate = {
  status: "needs_approval",
  originalMedia: true,
  qualityGate: { pass: true },
  safety: { hardBlock: false },
  researchReview: { verdict: "shortlisted", risk: "low" },
};

const ready = { enabled: true, liveDeployEnabled: true, credentialsReady: true, budgetAllowed: true, candidate };

test("autopilot launches only an AI-shortlisted, low-risk candidate behind all spend guards", () => {
  assert.equal(canAutoLaunch(ready), true);
  assert.equal(canAutoLaunch({ ...ready, budgetAllowed: false }), false);
  assert.equal(canAutoLaunch({ ...ready, credentialsReady: false }), false);
  assert.equal(canAutoLaunch({ ...ready, liveDeployEnabled: false }), false);
  assert.equal(canAutoLaunch({ ...ready, enabled: false }), false);
});

test("autopilot rejects candidates without verified media rights or a passing review", () => {
  assert.equal(canAutoLaunch({ ...ready, candidate: { ...candidate, originalMedia: false } }), false);
  assert.equal(canAutoLaunch({ ...ready, candidate: { ...candidate, qualityGate: { pass: false } } }), false);
  assert.equal(canAutoLaunch({ ...ready, candidate: { ...candidate, safety: { hardBlock: true } } }), false);
  assert.equal(canAutoLaunch({ ...ready, candidate: { ...candidate, researchReview: { verdict: "watching", risk: "low" } } }), false);
  assert.equal(canAutoLaunch({ ...ready, candidate: { ...candidate, researchReview: { verdict: "shortlisted", risk: "high" } } }), false);
});
