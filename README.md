# Meme Operations

Meme Operations watches a signed-in J7 feed, filters public X posts, asks AI to review eligible ideas, and tracks launched coins and estimated creator fees. It automatically learns from measured market activity on launched coins and can use your optional ratings as hints about idea style.

Live launches remain off by default. An optional autopilot can deploy only low-risk, AI-shortlisted ideas with verified original-media rights, a passing quality gate, complete J7 credentials, and available daily budget. It stops and logs a manual-review item when a guard or deployment fails. Estimated market fees are not confirmed wallet receipts, and the app does not automatically reinvest them.

Market-outcome learning starts after each tracked token has been live for 24 hours and has indexed market data. It labels observed activity from rolling 24-hour volume, trades, and liquidity, then shares at most five compact examples with later AI reviews. Five observed outcomes are required before the AI may use them for calibration. These noisy activity labels do not change hard safety rules or establish profitability.

## Fast news ideas and phone alerts

The dashboard checks Google News RSS searches for viral/internet culture, technology/AI, and crypto/Solana headlines every minute. It keeps articles published within the last three hours, reviews at most two new headlines per scan, and caps all X/news concept reviews at six AI calls per hour by default. The AI sees the headline and RSS excerpt, not a full article paywall or page. Ideas are suggestions only; they do not become launch candidates or trigger transactions. A shortlisted idea includes its source, proposed name/ticker, short narrative, and a Pump.fun link for your manual review.

The concept reviewer looks for a specific source hook, an understandable one-line joke, and a visual metaphor that works at thumbnail size. Clicking **Open Pump.fun** first tries to use the source post's image. Only if no usable source image can be loaded will a shortlisted, low- or medium-risk, high-visual-potential idea request original AI art. No image is generated before that click. Images are cached locally in `data/generated-ideas` and limited to three new images per UTC day. If art generation is skipped or fails, the draft uses a simple local logo and shows the reason in its status. **Stop AI** cancels image requests as well as text research. This is a creative filter, not a forecast of buyers or fees.

For phone alerts, install the ntfy app on your phone, generate a long random topic in the dashboard, subscribe to that topic in ntfy, then save it in the dashboard and send a test alert. ntfy topic names are public, so use a random topic only for this app. When a low- or medium-risk concept is shortlisted, the app sends its headline, name, ticker, narrative, and source URL to that topic. Leave the topic blank to keep alerts off. The app server must remain running on this Mac for scans and alerts to continue.

Give a shortlisted idea a Good idea or Skip this style rating in the dashboard. Future AI reviews use a small sample of those ratings as preference hints; ratings do not change safety rules or claim that a coin will perform well.

The `eu` region uses J7's current Frankfurt deploy host (`tx-fra.j7tracker.io`). J7 retired the older regional deploy hosts.

## What it does

- Accepts normalized social signals at `POST /api/signals`.
- Scores freshness, engagement velocity, reach, source size, original media, and meme clarity.
- Rejects replies, quotes, reposts, follows, weak engagement, missing images, and duplicate names/tickers before they can enter the approval queue.
- Enforces a daily live-launch cap, a cooldown, and a wallet reserve estimate.
- Hard-blocks exploitation, impersonation, tragedies, minors, medical/financial deception, and obvious brand copying.
- Adds a visible decision log and conservative AI review through the configured OpenAI-compatible provider.
- Shows only real deployed coins in the launch graph and a clearly labelled estimate of rolling 24-hour creator fees.
- Uses the Firefox companion to read visible J7 feed cards and send new items to the local research pipeline.
- Produces the documented J7 `create_token` payload for Pump.fun.
- Defaults to dry-run, uses no raw private key, makes no dev buy by default, and keeps an append-style local candidate record.

## Fastest way to run on this Mac

Double-click **Launch Guard.command**. It creates a private `.env` file with safe dry-run defaults, starts the local service, and opens the correct dashboard URL. Keep its Terminal window open.

The recommended watcher is the small Firefox companion in `firefox-companion/`. It runs inside normal Firefox, observes only public J7 feed cards, and forwards new items to localhost once per second. It does not read cookies or credentials and cannot click Deploy. Set `J7_BROWSER_WORKER_ENABLED=false` to disable browser ingestion, change `J7_BROWSER_SCAN_INTERVAL_MS` to adjust the interval, or set `J7_BROWSER_ENGINE=chrome` to use the dedicated Playwright Chrome fallback.

Do not open `public/index.html` directly. A `file://` page cannot communicate with the local service.

## Terminal setup

```bash
npm run setup
npm test
npm run demo
npm start
```

Open `http://127.0.0.1:8787`.

## Send a signal

J7's public documentation covers deployment but does not document a social-feed API. Configure J7/your alert bridge to POST this normalized shape:

```bash
curl -X POST http://127.0.0.1:8787/api/signals \
  -H 'content-type: application/json' \
  -d '{
    "text":"A tiny capybara learns to ring a bicycle bell",
    "sourceUrl":"https://x.com/example/status/123",
    "imageUrl":"https://images.example/bellbara.jpg",
    "eventType":"post",
    "postedAt":"2026-09-20T10:00:00Z",
    "authorVerified":true,
    "authorFollowers":185000,
    "likes":14200,
    "reposts":3900,
    "replies":640,
    "views":780000,
    "originalMedia":true,
    "proposedName":"Bellbara",
    "proposedTicker":"BELL"
  }'
```

## Live deployment and optional autopilot

1. Sign into the official J7 app at `https://j7tracker.io`. For the wallet key, open **Deploy Settings → Wallets → key icon** beside your Solana wallet and copy the encrypted key J7 shows. Never paste a raw seed phrase into this service or into chat.
2. Add your VyceAI key through the dashboard's **Connection setup** panel. It is stored only in the local `.env`, never returned by the API, and becomes active without a restart. The default endpoint is `https://vyceai.com/v1` and the configured model route is `deepseek-v4-flash`.
3. Add `J7_JWT` in the same panel only if J7 supplies an official session token. It is needed for unattended API deployment, but not for read-only browser research. Set `J7_ENCRYPTED_SOLANA_KEY` to the encrypted wallet key J7 shows; never use a raw private key. The setup command already generated a long `APPROVAL_KEY`.
4. Optional: set `CREATOR_FEE_WALLET` to a public Solana wallet address. Launch Guard then sends J7 `pump_fee_shareholders` with a 10,000-basis-point share, routing 100% of that coin's Pump creator fees to the address. Leave it blank to use Pump/J7's default creator-fee destination.
5. Keep both `LIVE_DEPLOY_ENABLED=false` and `AUTO_LAUNCH_ENABLED=false` while testing. Restart Launch Guard after changing `.env`.
6. Use the Firefox companion for J7 discovery. A signal bridge can also post normalized signals to `/api/signals`.
7. After a measured dry-run trial, set `LIVE_DEPLOY_ENABLED=true` to permit live deployments. Leave `AUTO_LAUNCH_ENABLED=false` for manual approval.
8. To use autopilot, also set `AUTO_LAUNCH_ENABLED=true`. Autopilot runs only on the J7 research pipeline and only for a low-risk AI shortlist with original-media rights marked verified and every deterministic quality check passing. The existing per-day cap, cooldown, wallet reserve, and launch-cost estimate still apply. It does not buy tokens or reinvest estimated fees.
9. Restart Launch Guard after configuration changes. Review each `needs_approval` candidate when autopilot is off.
10. Manual approval remains available through the local API:

```bash
curl -X POST http://127.0.0.1:8787/api/candidates/CANDIDATE_ID/approve \
  -H 'content-type: application/json' \
  -H 'x-approval-key: YOUR_APPROVAL_KEY' \
  -d '{"confirm":"DEPLOY LIVE"}'
```

If live mode is false, this returns and stores the exact dry-run payload. Test that first.

In dry-run mode, the dashboard's **Prepare dry-run** action creates the exact prospective J7 payload without contacting J7 or sending a transaction.

## J7 adapter contract

The adapter should verify the source itself, fill `authorVerified`, and forward only direct `x.com/.../status/...` URLs. Do not screen-scrape J7 credentials. If J7 adds an official feed/webhook API, connect it to `/api/signals`; the rest of the pipeline does not change.

## Economics

Run `npm run costs`. Edit `src/costs.js` with your measured launch count, graduation rate, and volume distribution. Revenue is `eligible trading volume × creator-fee rate`; it is not market cap and not buyer inflow. See [RESEARCH.md](./RESEARCH.md).

Pump currently lists its platform charge to create a coin as 0 SOL, but Solana network fees and third-party interface fees can still apply. J7 is the supported automated route in this project because its deploy endpoint accepts Pump launches; Pump's public site does not document an equivalent unattended creation API. Set `WALLET_BALANCE_SOL` to the latest observed J7 wallet balance and replace `ESTIMATED_LAUNCH_COST_SOL` with the measured balance change after one controlled launch.

## Production checklist

- Put the service behind authentication/TLS; it currently binds only to localhost.
- Keep `DEV_BUY_SOL=0` until paper results justify risking capital.
- Record real J7 service/relay fees; its public docs mention a J7 fee but do not publish the amount.
- Require rights/consent for people, brands, characters, images, and quoted text.
- Get local legal/tax advice before issuing tokens or receiving creator fees.
- Add rate limits, signed webhooks, backups, and monitoring before hosting.
