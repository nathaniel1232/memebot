# Research and economics (20 September 2026)

## What the linked $57 video actually shows

The X post says, in Chinese, “A demonstration for everyone. Earned $57 in less than a minute.” The 1:52 phone recording does **not** show J7 Tracker or Pump.fun. It shows `ponsfamily.com` / Pons on Robinhood Chain:

1. The user enters `SANTA HOLDER` / `$SANTA` and a description.
2. They choose a pair asset (the menu includes ETH and tokenized stocks).
3. The token profile shows a **2.00% creator tax**.
4. The final screen shows **0.023436 ETH** in creator fees “earned … across 1 swap,” then claimed.

At the current ETH reference price used for this report ($2,596.28), 0.023436 ETH is about **$60.85**. At a 2% creator tax, that one swap implies about **1.1718 ETH / $3,042** of eligible volume. Using the post's $57 headline instead gives roughly **$2,850** of volume. The clip does not identify the buyer, prove the trade was unrelated, show acquisition cost/slippage/gas, or demonstrate repeatability. It is evidence of one fee claim, not a profit record.

Pons' documented flow allows up to a 10% creator tax and can route it to the deployer or to holders: <https://docs.j7tracker.io/docs/create-token/pons>.

## Pump.fun fee math

Pump.fun currently lists:

- Coin creation: **0 SOL**.
- Graduation to PumpSwap: **0.015 SOL** (about **$1.62** at SOL = $108.18).
- Bonding-curve creator fee: **0.300%** of eligible trade volume.
- Canonical PumpSwap creator fee: tiered by market cap, from **0.95%** in an early graduated band down toward **0.05%** at very high market caps.

Source: <https://pump.fun/docs/fees>. Solana's base network fee is currently 5,000 lamports per signature plus any optional priority fee: <https://solana.com/docs/core/fees/fee-structure>.

At the 0.30% bonding-curve creator rate:

| Eligible volume | Gross creator fees |
|---:|---:|
| $1,000 | $3 |
| $10,000 | $30 |
| $19,000 | $57 |
| $100,000 | $300 |
| $1,000,000 | $3,000 |

These are gross fees before J7 fees, network/priority fees, image/AI/hosting costs, tax, dev-buy losses, refunds, or legal costs.

## Cost estimate

| Item | Lean setup |
|---|---:|
| Software in this folder | $0 recurring |
| Pump.fun creation fee | $0 per coin |
| Pump.fun graduation fee | 0.015 SOL, paid only on graduation |
| Solana base transaction fee | 0.000005 SOL per signature, plus priority fees |
| Dev buy | $0 by default here; entirely capital-at-risk if enabled |
| J7 credentials | Site currently says to join Discord for free credentials |
| J7 deploy/relay charge | **Unknown publicly**; measure from the first dry-run/test transaction before budgeting |
| Optional hosting | $0 locally; typically $5–$20/month for a small always-on service |
| Optional AI review | With GPT-5.4 Mini, $0.75/M input tokens and $4.50/M output tokens; a compact ~1,000-input/200-output review is about $0.00165 |
| X data | Not included; J7's tracker UI/feed access and any X API plan may add cost |

OpenAI pricing source: <https://developers.openai.com/api/docs/models/gpt-5.4-mini>. The optional AI layer uses Structured Outputs and `store:false`; the deterministic rules work without an OpenAI key.

## Plausible earnings, not a promise

There is no defensible “this bot will earn X” number without the distribution of real third-party volume. Pump.fun graduation has often been around or below 1%; a cited April 2026 dataset reports 0.84%, while other periods have ranged from roughly 0.5% to around 2%. See <https://pumpfundata.com/blog/pumpfun-graduation-rate-analysis> and <https://www.theblock.co/news/web3/2025-02-27-pump-fun-rapid-decline-graduating-tokens-memecoin-frenzy-fizzles-out-343742>.

Illustrative 100-launch scenarios from `npm run costs`:

| Scenario | Assumptions | Gross creator fees |
|---|---|---:|
| Bear | 0.5% graduate; failed coins average $100 volume; graduates $25k; 0.30% fee | ~$67 |
| Base | 0.84% graduate; failed coins $250; graduates $100k; blended 0.50% post-graduation fee | ~$494 |
| Bull | 2% graduate; failed coins $500; graduates $500k; blended 0.75% fee | ~$7,647 |

These are sensitivity cases, not forecasts. If each launch included a 0.05 SOL dev buy and that capital were fully lost, 100 launches would risk about **$541**, enough to make the illustrative base case negative before other costs. The lowest-risk configuration is therefore zero dev buy, strict filtering, and measuring gross fees against every cost.

## Successful “internet moment → Pump.fun coin” cases

- **CHILLGUY**: a viral TikTok meme became a Pump.fun coin and reportedly touched roughly $488–500M market cap within days. The original artist objected, demonstrating the IP risk. <https://decrypt.co/292627/chill-guy-tiktok-meme-crypto-millions>
- **GOAT**: a human launched it on Pump.fun, then the Truth Terminal X persona endorsed the narrative; a research note reported more than $540M market cap after ten days. <https://assets.ctfassets.net/i0qyt2j9snzb/79OhuKP2wYiE0NZaRH3NL8/890e891c21162035131f9df2daa3c2c6/AI_Memecoins_-_Next_Gen_Memes_or_Next_Grift.pdf>
- **MOODENG, PNUT, CHILLGUY, GOAT and FARTCOIN** appear among the standout 2024 Pump.fun launches in CoinGecko's annual report; 5.3M tokens were deployed that year, showing how extreme the survivor bias is. <https://assets.coingecko.com/reports/2024/CoinGecko-2024-Annual-Crypto-Industry-Report.pdf>
- Broader research covering 15.2M Pump.fun coins identifies wash trading, copycats, coordinated selling, creator-address obfuscation, and social manipulation as common strategies. That is why this implementation excludes bundling/sniping/wash-volume features. <https://arxiv.org/abs/2609.10246>

The recurring success pattern is not simply “be first.” It is a rare combination of a genuinely viral, legible story; timing; an existing community or endorsement; exchange/liquidity follow-through; and luck. Copying people, brands, artwork, or tragic news introduces legal and ethical exposure, even when the token briefly succeeds.

## Decision

This system automates alert normalization, scoring, safety review, candidate generation, and J7 payload construction. It intentionally stops before the irreversible on-chain step and requires explicit per-launch approval. It contains no bundled wallets, sniping, fake engagement, self-trading, wash-volume, or automatic dumping logic.
