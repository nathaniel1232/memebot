const FEEDS = [
  { label: "Viral & internet culture", query: '"viral" OR "internet meme" OR "online trend" when:1h' },
  { label: "Technology & AI", query: '"artificial intelligence" OR "technology" when:1h' },
  { label: "Crypto & Solana", query: '"crypto" OR "Solana" OR "pump.fun" when:1h' },
];

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

export function parseRss(xml, feedLabel, now = Date.now()) {
  const items = [...String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  return items.map(([_, block]) => {
    const title = tag(block, "title");
    const sourceUrl = tag(block, "link");
    const publishedAt = tag(block, "pubDate");
    const description = tag(block, "description");
    const sourceMatch = block.match(/<source(?:\s[^>]*)?>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeXml(sourceMatch[1]) : feedLabel;
    const ageMs = now - Date.parse(publishedAt);
    if (!title || !/^https:\/\//i.test(sourceUrl) || !Number.isFinite(ageMs) || ageMs < -5 * 60_000 || ageMs > 3 * 60 * 60_000) return null;
    const cleanDescription = description.replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-|–—:]?\\s*`, "i"), "").replace(new RegExp(`\\s*[-|–—:]?\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "").trim();
    const text = [title, cleanDescription].filter(Boolean).join(" — ").slice(0, 2400);
    return { author: source.slice(0, 120), text, sourceUrl, postedAt: new Date(Date.parse(publishedAt)).toISOString(), eventType: "news", sourceType: "news", articleTitle: title.slice(0, 400), feedLabel };
  }).filter(Boolean);
}

export async function fetchFreshArticles({ now = Date.now() } = {}) {
  const responses = await Promise.allSettled(FEEDS.map(async (feed) => {
    const query = encodeURIComponent(feed.query);
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, { headers: { "User-Agent": "LaunchGuard/1.0 (news research)" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`News feed returned ${response.status}`);
    return { label: feed.label, articles: parseRss(await response.text(), feed.label, now) };
  }));
  const articles = responses.flatMap((result) => result.status === "fulfilled" ? result.value.articles : []);
  const feedErrors = responses.flatMap((result, index) => result.status === "rejected" ? [`${FEEDS[index].label}: ${String(result.reason?.message || "feed failed").slice(0, 120)}`] : []);
  const unique = new Map();
  for (const article of articles) {
    const existing = unique.get(article.sourceUrl);
    if (!existing || Date.parse(article.postedAt) > Date.parse(existing.postedAt)) unique.set(article.sourceUrl, article);
  }
  const relevance = /viral|meme|internet|online|creator|robot|artificial intelligence|\bai\b|trend|slang|mascot|crypto|solana|launch|absurd|weird|bizarre|unexpected|gadget|app|animal|game|software|science/i;
  const conceptHooks = [/internet culture|internet trend|online trend|meme|slang|mascot/i, /robot|artificial intelligence|\bai\b|gadget|app|software|technology/i, /animal|weird|bizarre|absurd|unexpected|odd|strange/i, /game|creator|viral challenge|social media/i];
  const sensitiveTopics = /\b(politic|president|election|war|terror|attack|death|died|killed|crime|murder|victim|hostage|disaster|illness|surgery|cancer|religio|sermon|celebrity|lawsuit|court|protest)\b/i;
  const conceptPriority = (article) => conceptHooks.reduce((score, pattern) => score + (pattern.test(`${article.articleTitle} ${article.text}`) ? 2 : 0), 0) - (sensitiveTopics.test(`${article.articleTitle} ${article.text}`) ? 5 : 0);
  const fresh = [...unique.values()]
    .filter((article) => relevance.test(article.text))
    .sort((a, b) => conceptPriority(b) - conceptPriority(a) || Date.parse(b.postedAt) - Date.parse(a.postedAt));
  return { articles: fresh, feedErrors, feedsChecked: FEEDS.length };
}

export function validNtfyTopic(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,64}$/.test(value);
}

export async function sendNewsAlert(topic, item) {
  if (!validNtfyTopic(topic)) return { sent: false, reason: "Phone notifications are not configured" };
  const message = `Coin idea: ${item.proposedName || "New idea"}\nTicker: $${item.proposedTicker || "IDEA"}\nDescription: ${item.narrative || item.memeAngle || item.reason}\nCopy this into Pump.fun: https://pump.fun/create\nSource: ${item.sourceUrl}`.slice(0, 900);
  const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Title": "New meme narrative to review",
      "Priority": "high",
      "Tags": "newspaper,bulb",
      "Click": "https://pump.fun/create",
    },
    body: message,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ntfy returned ${response.status}`);
  return { sent: true };
}
