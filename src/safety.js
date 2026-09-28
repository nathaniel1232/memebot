const BLOCK_RULES = [
  ["tragedy/exploitation", /\b(death|died|killed|murder|suicide|shooting|victim|hostage|disaster)\b/i],
  ["minor", /\b(child|kid|minor|teen|schoolboy|schoolgirl)\b/i],
  ["impersonation", /\b(official|endorsed by|partnership with|backed by)\b/i],
  ["financial promise", /\b(guaranteed|risk[- ]?free|100x|profit guaranteed|can't lose)\b/i],
  ["medical claim", /\b(cures?|treats?|vaccine|cancer|disease)\b/i],
  ["political solicitation", /\b(vote for|campaign donation|political fundraiser)\b/i],
];

const BRAND_RULE = /\b(apple|tesla|nvidia|nike|disney|pokemon|marvel|coca[- ]?cola|openai)\b/i;

export function safetyReview(signal) {
  const text = `${signal.text || ""} ${signal.proposedName || ""} ${signal.description || ""}`;
  const reasons = BLOCK_RULES.filter(([, rule]) => rule.test(text)).map(([reason]) => reason);
  if (BRAND_RULE.test(text)) reasons.push("brand/trademark reference requires rights review");
  if (signal.sourceType === "news") {
    if (!signal.sourceUrl?.startsWith("https://")) reasons.push("article source is not HTTPS");
  } else {
    if (!/^https:\/\/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(signal.sourceUrl || "")) reasons.push("source URL is not a direct X post");
    if (signal.authorVerified !== true) reasons.push("source identity is not verified by the input adapter");
  }

  const hardBlock = reasons.some((reason) => reason !== "source identity is not verified by the input adapter");
  return { hardBlock, reasons };
}
