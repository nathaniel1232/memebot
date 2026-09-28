import { scoreSignal } from "./scorer.js";
import { deploymentPayload } from "./j7.js";

const signal = {
  id: "demo-fresh-meme",
  text: "A tiny capybara learns to ring a bicycle bell and the clip is spreading fast",
  sourceUrl: "https://x.com/example/status/123",
  imageUrl: "https://images.example/bellbara.jpg",
  eventType: "post",
  postedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  authorVerified: true,
  authorFollowers: 185_000,
  likes: 14_200,
  reposts: 3_900,
  replies: 640,
  views: 780_000,
  originalMedia: true,
  proposedName: "Bellbara",
  proposedTicker: "BELL",
};

const candidate = scoreSignal(signal);
console.log(JSON.stringify({ candidate, dryRunDeployment: deploymentPayload(candidate) }, null, 2));
