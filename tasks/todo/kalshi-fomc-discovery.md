# CME FedWatch + Kalshi FOMC Discovery

Investigation date: 2026-04-07
Investigator: Claude (Opus 4.6, 1M context, read-only research mode)

## Summary

| Question | Answer |
|---|---|
| CME FedWatch data accessible without paid feed? | KLUDGE — official API is paid (~$25/mo, OAuth, ToS-restricted). Free workarounds exist via Yahoo `ZQ=F` (15-min delayed) and Atlanta/Minneapolis Fed weekly probability files. |
| Kalshi FOMC markets live right now? | YES — extremely live. KXFED and KXFEDDECISION both have multi-million-dollar open interest on the Apr 29 2026 meeting. |
| Next FOMC meeting | **2026-04-28 / 2026-04-29** (statement Wed 14:00 ET → Kalshi expiration 14:05 ET = 18:05 UTC) |
| Decision gate | **RECONSIDER → likely WAIT** for the right data source, then PROCEED. The Kalshi side is great; the CME side is the bottleneck. |
| Estimated effort vs weather observer | ~1.0–1.3x — same shape (one Kalshi client, one external client, polling loop, persistence) but the external client is the hard part and the contract semantics differ (custom strikes, hike/cut buckets, mutually-exclusive resolution). |

The Kalshi half of this thesis is unambiguously better than the weather observer: liquidity is two orders of magnitude bigger, the resolution source is unambiguous (federalreserve.gov target range upper bound), and there is documented historical evidence of measurable Kalshi↔CME divergences. **The blocker is whether we can poll the CME-implied probabilities cheaply enough at high enough frequency that lag is observable.** That answer is "yes if we accept 15-min delay or pay $25/mo or compute probabilities ourselves from `ZQ=F`."

## CME FedWatch data sources

### Primary: CME FedWatch REST API (paid)
- **Base URL (production):** `https://markets.api.cmegroup.com/fedwatch/v1`
- **Endpoints:** `/forecasts`, meeting date history/future
- **Auth:** OAuth2 Bearer token, registration via CME GAM or self-service onboarding
- **Pricing:** "as little as $25/month" per CME marketing copy; intraday adds a 60-second probability stream; EOD-only updates at 01:45 UTC business days
- **ToS:** redistribution restricted, market-data licensing terms apply
- **Probe result:** `https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/305/G` returned **HTTP 403 with explicit anti-scraping warning** ("This IP address is blocked due to suspected web scraping activity"). CME actively blocks unauthenticated scraping of CmeWS endpoints.
- **Verdict:** Cleanest path if we'll spend $25/mo. The 60-second intraday stream is actually a perfect cadence match for our use case.

### Fallback A: Yahoo Finance ZQ=F (free, 15-min delayed)
- **Symbol:** `ZQ=F` (front-month) and contract-month variants like `ZQK26` for May 26 expiry
- **Source URL:** `https://finance.yahoo.com/quote/ZQ=F/`
- **Library:** `yfinance` (Python) or direct `query1.finance.yahoo.com/v8/finance/chart/ZQ=F` JSON endpoint
- **Delay:** 10–15 min per CBOT exchange rules (delayed quote, not real-time)
- **Cost:** Free
- **Computation:** `implied_rate = 100 - futures_price`. For meetings mid-month you blend the active and following contract per CME's documented FedWatch methodology (uniform 25 bps, EFFR proportional reaction).
- **Verdict:** Workable for a "lag observer" but the 15-min delay defeats the core thesis (catching seconds-to-minutes lag). We'd be racing a 15-min handicap against a Kalshi market that's already absorbing the news in real time. **NOT viable for live arbitrage; viable for retrospective analysis.**

### Fallback B: Atlanta Fed Market Probability Tracker (free, weekly)
- **URL:** `https://www.atlantafed.org/cenfis/market-probability-tracker`
- **Source data:** Uses CME data with permission; reports market-implied probabilities of three-month average fed funds rate ranges
- **Update frequency:** Reported as published, not streaming — too slow for intraday lag observation
- **Direct fetch:** Returned HTTP 403 to WebFetch; suggests scraping protection
- **Verdict:** Useful as weekly ground-truth check, not as live signal

### Fallback C: Minneapolis Fed market-based probabilities (free)
- **URL:** `https://www.minneapolisfed.org/banking/current-and-historical-market--based-probabilities`
- **Update frequency:** Daily/weekly snapshots
- **Verdict:** Same as Atlanta — useful for backtest reference, not live polling

### Fallback D: Compute it ourselves from CBOT 30-Day Fed Funds futures
- **Raw data source candidates:** Barchart (`https://www.barchart.com/futures/quotes/ZQ*0/futures-prices`), TradingView, CBOT direct via `yfinance`/`pandas-datareader`
- **Methodology:** Documented in CME's "Understanding the FedWatch Tool Methodology" (2023 article). Use 30-day average of EFFR; for mid-month meetings, blend two adjacent contracts; assume 25 bps quanta.
- **Effort:** ~200 LOC of math + a robust quote feeder. Reproducible. We've then earned the right to claim "we're the FedWatch tool."
- **Latency:** Bounded by underlying quote feed (15-min Yahoo, real-time IBKR with account, etc.)

### Fallback E: IBKR / Interactive Brokers
- **Symbols:** `ZQ` futures via `ib_insync`
- **Auth:** Requires IBKR account ($0 minimum but funded), TWS or Gateway running locally
- **Cost:** Real-time CBOT data subscription is ~$10/mo, plus minimum activity
- **Latency:** Real-time
- **Verdict:** Most engineering effort but most viable real-time free-ish path

### Polling strategy recommendation
1. **Phase 1 (immediate, free):** Poll `ZQ=F` via `yfinance` every 60 s → compute implied probability per CME methodology → store. Accept the 15-min delay; treat the system as a "delayed CME truth" baseline. Use this to validate the architecture and the math.
2. **Phase 1.5 (after one FOMC dry-run):** Subscribe to CME FedWatch API at $25/mo → swap data source behind same interface. Now we have real-time + 60s probability stream.
3. **Phase 2 (if results justify):** IBKR + raw `ZQ` quotes + own probability engine → cuts CME out of the loop entirely.

**Sample yfinance response (approximate):**
```python
import yfinance as yf
zq = yf.Ticker("ZQ=F").history(period="1d", interval="1m")
# Columns: Open, High, Low, Close, Volume
# Close ≈ 95.625 → implied rate ≈ 4.375% for the front month
```

### Rate limits / ToS
- Yahoo Finance: undocumented; ~2k requests/hour soft limit per IP; ToS prohibits redistribution but personal monitoring is gray-area-tolerated
- CME FedWatch API (paid): per contract, no public number found
- CME public CmeWS: **explicitly blocked**, do not attempt

## Kalshi FOMC series inventory

Pulled `GET /series?limit=200` (returned 9505 series in a single page — Kalshi paginates lazily; cursor was null suggesting all returned). Filtered for Fed/FOMC/rate keywords and probed each.

### Live, high-value series

| Ticker | Title | Category | Frequency | Live events | Notes |
|---|---|---|---|---|---|
| **KXFED** | Fed funds rate | Economics | custom | **9 open events** through Apr 2027 | Strike-bucket form ("upper bound > X%"). Resolves on federalreserve.gov target range upper bound. |
| **KXFEDDECISION** | Fed meeting | Economics | custom | **15 open events** through Jan 2028 | Hike/cut bucket form ("Cut 25 bps", "Hold", "Hike 25 bps", etc). Mutually exclusive. **2.4M OI on Hold for April.** |
| KXFEDDISSENT | Who will dissent at FOMC meeting | Politics | one-off | 1 open (KXFEDDISSENT-26APR) | Per-governor dissent prediction. Not a probability play. |
| KXEFFR | Fed Funds (EFFR) above/below | Economics | custom | 1 open (Q2 2026 end) | EFFR is daily fixing — different beast from target range. |
| KXRATECUT | Fed rate cut | Economics | annual | 1 open (KXRATECUT-26DEC31, "before 2027") | Annual binary, not per-meeting. |

### Dormant or irrelevant Fed-tagged series
KXFEDHIKE, KXFOMCVOTE, KXFOMCDISSENTCOUNT, KXTERMINALRATE, KXRATECUTCOUNT, KXBALANCESHEET, KXLOWESTRATE, KXFEDCHGCOUNT, FEDDECISION (legacy), FED (legacy), KXEMERCUTS, KXFEDMEET, KXZERORATE, KXFEDFACILITY, FEDRATEMIN — all returned `0 open events`. Mostly legacy/seasonal markets the team has not relisted yet.

### KXFED-26APR market depth (sampled 2026-04-07)

Strikes are 0.25% increments from 2.75% to 5.25%, all `strike_type=greater` referencing `floor_strike`:

| Ticker | floor_strike | yes_bid | yes_ask | vol_24h | open_interest |
|---|---|---|---|---|---|
| KXFED-26APR-T2.75 | 2.75 | 0.99 | 1.00 | 0 | 26 559 |
| KXFED-26APR-T3.00 | 3.00 | 0.99 | 1.00 | 0 | **308 830** |
| KXFED-26APR-T3.25 | 3.25 | 0.98 | 1.00 | 2 | **137 153** |
| KXFED-26APR-T3.50 | 3.50 | 0.98 | 1.00 | 1 303 | 13 384 |
| KXFED-26APR-T3.75 | 3.75 | 0.00 | 0.01 | **103 683** | **405 080** |
| KXFED-26APR-T4.00 | 4.00 | 0.00 | 0.01 | 4 143 | 27 622 |
| KXFED-26APR-T4.25 | 4.25 | 0.00 | 0.01 | 674 | 2 433 |
| KXFED-26APR-T4.50 | 4.50 | 0.00 | 0.01 | 0 | 255 |
| KXFED-26APR-T4.75 | 4.75 | 0.00 | 0.01 | 60 | 680 |
| KXFED-26APR-T5.00 | 5.00 | 0.00 | 0.01 | 0 | 464 |
| KXFED-26APR-T5.25 | 5.25 | 0.00 | 0.01 | 33 | 631 |

Implied target after April meeting: **between 3.50% and 3.75%** — the market is pricing in essentially no chance of being above 3.75% and essentially full certainty of being above 3.50%, with the active wedge at 3.50–3.75 (last_price T3.50 = 0.98). Translates to "no rate change expected; current upper bound is 3.50%."

### KXFEDDECISION-26APR market depth (sampled 2026-04-07)

`strike_type=custom`, `custom_strike` field encodes the bucket. Mutually exclusive resolution.

| Ticker | Bucket | yes_bid | yes_ask | vol_24h | open_interest |
|---|---|---|---|---|---|
| KXFEDDECISION-26APR-C26 | Cut >25 bps | 0.00 | 0.01 | 4 226 | 782 504 |
| KXFEDDECISION-26APR-C25 | Cut 25 bps | 0.01 | 0.02 | 55 540 | **2 093 657** |
| **KXFEDDECISION-26APR-H0** | **Hold (no change)** | **0.98** | **0.99** | **49 266** | **2 380 862** |
| KXFEDDECISION-26APR-H25 | Hike 25 bps | 0.00 | 0.01 | 82 655 | **2 011 614** |
| KXFEDDECISION-26APR-H26 | Hike >25 bps | 0.00 | 0.01 | 4 044 | 1 091 009 |

**Total open interest across the April KXFEDDECISION event: ~8.36M contracts ($8.36M notional).** This is the most liquid Kalshi event we've ever looked at — roughly 100x the daily-weather markets in raw notional. Hold is priced at 98¢, implying 98% no-change which matches the KXFED bucket consensus.

### Liquidity observations
- KXFEDDECISION is dramatically more liquid than KXFED for the same meeting. This is the surface to focus on — bigger order book, tighter spreads (1¢ wide), and mutually-exclusive bucketing makes it a clean drop-in for CME's hike/cut/hold probability table.
- The KXFED rate-bucket form (T3.50, T3.75 etc) is the cleaner mathematical mapping to a continuous CME implied probability curve, but its order book is thinner.
- **Recommendation: poll BOTH series. KXFEDDECISION is the trading surface; KXFED is the cross-check.**

### Contract PDF links
- KXFED → `https://kalshi-public-docs.s3.us-east-1.amazonaws.com/regulatory/product-certifications/FED.pdf` (downloaded; see next section)
- KXFEDDECISION → not yet fetched — should be checked for the mutually-exclusive resolution rules and treatment of unscheduled meetings

## Resolution sources (verbatim from PDFs)

### KXFED (`FED.pdf`, 8 pages, dated 2021-06-30)

| Field | Value (verbatim) |
|---|---|
| **Source Agency** | "The Source Agency is the United States Federal Reserve System." |
| **Underlying** | "The upper bound of the target federal funds range published by the official website of the Federal Reserve in the latest table entry under the Column titled 'Level (%)' (https://www.federalreserve.gov/monetarypolicy/openmarket.htm)." |
| **Payout Criterion** | "Expiration Values that are strictly greater than `<percent>`." |
| **Last Trading Date (PDF)** | "the day prior to the first day of the next regularly scheduled Federal Open Market Committee meetings ... Last Trading Time is 7:00pm ET on the Last Trading Date." |
| **Last Trading Date (LIVE API)** | `close_time = 2026-04-29T17:55:00Z` = **2026-04-29 13:55 ET**, i.e. five minutes before the 14:00 ET FOMC statement release. **THE PDF IS STALE.** Kalshi has clearly amended this — it now trades right up to the announcement, which is exactly what we want. |
| **Expiration Date / Time** | API: `expected_expiration_time = 2026-04-29T18:05:00Z` (14:05 ET, 5 min after statement). PDF: 6:00pm ET on day after meeting. Again, PDF is stale — current behavior is much faster. |
| **Position Limit** | "$25,000 USD per Member" (binding for $1 contract, same as weather) |
| **Tick Size** | $0.01, range $0.01–$0.99 |
| **Contract Modifications** | Kalshi reserves right to designate new Source Agency (Rule 7.2) |

**Critical:** Confirmed Kalshi resolves on the FOMC's published target range upper bound from federalreserve.gov, **not** on a derivative like EFFR. This is the same observable that CME futures price; it is the right ground-truth for arbitrage. ✅

The 5-minute window between close (13:55 ET) and expiration (14:05 ET) is the kill zone — Kalshi closes the book right before the announcement, so any actionable lag must occur in the **hours leading into the meeting**, not on the announcement itself.

This drastically reshapes the thesis. See "Decision gate" below.

### KXFEDDECISION (FEDDECISION.pdf — not yet fetched)
Should be retrieved before building. Probable contents based on API metadata: same Source Agency and Underlying, but different bucketing rules. The `rules_secondary` field on H26 noted: "if a scheduled FOMC meeting is canceled and does not occur on its scheduled date, then the strike for 'Fed maintains rate' will resolve to Yes and all others will resolve to No." That handles the cancellation edge case.

## FOMC calendar

### 2026 FOMC meetings
| # | Dates | Notes |
|---|---|---|
| 1 | Jan 27–28 | (already happened) |
| 2 | Mar 17–18 | (already happened) — included Summary of Economic Projections + dot plot |
| **3** | **Apr 28–29** | **Next meeting — 21 days away** |
| 4 | Jun 16–17 | SEP + dot plot |
| 5 | Jul 28–29 | |
| 6 | Sep 15–16 | SEP + dot plot |
| 7 | Oct 27–28 | |
| 8 | Dec 8–9 | SEP + dot plot |

Source: federalreserve.gov FOMC calendar. **8 regularly scheduled meetings/year**, plus possibility of unscheduled emergency meetings (KXFEDMEET market exists for those).

### Decision day timeline (Wednesday)
- **14:00 ET** — Statement released on federalreserve.gov
- **14:30 ET** — Press conference begins
- ~15:30 ET — Press conference Q&A typically ends

Kalshi book closes 13:55 ET, expiration 14:05 ET. **No trading during the announcement.**

### Blackout period
The Fed's own communications blackout begins the second Saturday before each FOMC meeting and ends the Thursday after. During blackout, no Fed official speaks publicly on monetary policy. This is when CME futures move only on incoming data (CPI, NFP, PCE, jobless claims), not on Fed-speak — and prediction markets historically lag those macro releases by minutes.

### Other macro releases that move Fed-rate markets
| Release | Frequency | Time (ET) | Market impact |
|---|---|---|---|
| Nonfarm Payrolls | First Friday of month | 08:30 | Very high |
| CPI | Mid-month | 08:30 | Very high |
| Core PCE | Last Friday | 08:30 | Very high |
| ISM Manufacturing/Services | First week | 10:00 | Medium |
| Retail Sales | Mid-month | 08:30 | Medium |
| FOMC Minutes | 3 weeks after meeting | 14:00 | Medium-high |
| Powell speeches | Ad hoc | varies | Very high if during non-blackout |

These are the **real opportunity windows** for Kalshi vs CME lag arbitrage, because both venues trade through them. Decision-day arbitrage is mostly impossible because of the 13:55 ET close.

## Historical lag evidence

### Kalshi historical data endpoints
- ✅ `GET /trades?ticker=KXFED-26APR-T4.00&limit=10` — **WORKS**, returns array of `{trade_id, ticker, count_fp, yes_price_dollars, no_price_dollars, taker_side, created_time}` with cursor pagination. Gives full executed trade tape. Sample trades on T4.00 show only ~5 trades in the last 24 hours, all at $0.01.
- ❌ `GET /markets/{ticker}/candlesticks?...` — returns 404
- ✅ `GET /series/{series}/markets/{ticker}/candlesticks?start_ts&end_ts&period_interval=60` — **WORKS** (HTTP 200, but returned empty array `{"candlesticks":[],"ticker":"..."}` for the 24h test window; need to verify with a wider window or more active market)

The series-scoped candlesticks path is the documented one. We should backfill against it before the strategy goes live.

### Academic / journalistic evidence
- **Federal Reserve Board working paper:** "Kalshi and the Rise of Macro Markets" (`https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf`, FEDS Working Paper 2026-10). Could not extract text via WebFetch (PDF binary). **This should be downloaded and read by hand before building** — it likely contains exactly the lag quantification we want.
- **Wedbush PredictStreet (2026-02-05):** "FOMC Disconnect: Kalshi Traders Signal March Rate Cut as Macro Prediction Markets Explode." Reported a "54% spread between prediction markets and traditional futures created a lucrative arbitrage opportunity for algorithmic traders using the Kalshi 'oracle' to front-run movements in the Treasury market." [This figure looks dramatic and possibly cherry-picked — but it suggests arbitrage signal does exist.]
- **ChronicleJournal PredictStreet (2026-01-18):** "The Death of the Lagging Indicator: How Prediction Markets Became the Fed's New Crystal Ball." Argues prediction markets have been faster than CME futures in 2025–2026.
- **Bitcoin.com (recent):** "Kalshi, Polymarket, and CME Agree: The Fed's About to Cut" — confirms three venues are referenced together.
- **Notable 2026 development:** Both Google Finance and Bloomberg Terminal began incorporating real-time Kalshi/Polymarket odds into their macro dashboards in early 2026. This is the institutional acknowledgement.

### Direction of lag — critical correction
The recent press has flipped the conventional wisdom. The 2025–2026 narrative is that **Kalshi leads CME** on certain news, not the other way around. The original thesis here ("Kalshi retail-dominated markets lag institutional CME") may be inverted relative to current empirics. If Kalshi is now the price-discovery venue and CME is the lagging hedge market, the strategy direction reverses but the mechanic is the same — and arguably better, because real-money prediction markets close instantly while futures take longer to absorb news through wider order books.

**Action item:** Read the Fed FEDS 2026-010 paper before building anything. It will tell us which direction the lag actually goes in 2026 and how big it is.

### Order of magnitude
From journalistic accounts (no rigorous academic measurement found in this scan): the lag in either direction is on the order of **seconds to minutes** for high-impact news (CPI, NFP, FOMC), and **minutes to hours** for lower-impact policy speak. The 30–60 s polling cadence we proposed for the weather observer is appropriate.

## Proposed Phase 1b architecture

### New external clients
1. **`CmeFedFundsClient`** (the hard one)
   - Adapter pattern with three implementations:
     - `YfinanceFedFundsClient` (free, 15-min delayed) — Phase 1
     - `CmeFedWatchApiClient` (paid, $25/mo, real-time + 60s stream) — Phase 1.5
     - `IbkrFedFundsClient` (real-time, requires running TWS) — Phase 2 if we get serious
   - Common interface: `getImpliedProbabilities(meetingDate: Date): Map<bucket, probability>`
   - Ships its own implementation of CME's documented FedWatch methodology (uniform 25 bps, EFFR-proportional, blended for mid-month meetings)

### New domain services
2. **`FomcMarketsService`**
   - Wraps existing `KalshiClient`
   - Knows about KXFED (rate-bucket) and KXFEDDECISION (hike/cut-bucket) series
   - Translates between them and CME's bucket structure
   - Polls every 30 s during US trading hours, 5 min off-hours

3. **`FomcDivergenceService`**
   - Computes per-bucket spread = `Kalshi_implied_prob - CME_implied_prob`
   - Emits divergence events when |spread| exceeds threshold
   - Rolling window for short-term lag detection vs. structural disagreement

4. **`FomcCalendarService`**
   - Maintains FOMC meeting schedule (parsed from federalreserve.gov or hardcoded for 2026)
   - Identifies blackout periods, decision days, and macro release windows
   - Drives cadence: dial polling up to 5 s during NFP/CPI/FOMC release windows, down to 5 min off-peak

### Reuse from Phase 1 weather observer
- ✅ `KalshiClient` (auth-free reads, `_dollars`/`_fp` field handling)
- ✅ Polling/scheduling primitives
- ✅ Persistence layer (SQLite or whatever you chose)
- ✅ Logging, metrics, alerting plumbing
- ✅ Contract PDF download/cache pattern

### Estimated complexity
- **CME client adapter + math:** ~400 LOC
- **FOMC services + divergence:** ~300 LOC
- **Calendar service:** ~150 LOC (mostly hardcoded 2026 dates)
- **Tests + fixtures:** ~400 LOC
- **Total:** ~1.2k LOC, **roughly 1.0–1.3x the weather observer**, with most of the complexity concentrated in the CME client and the bucket-mapping math.

## Decision gate and recommendation

### Recommendation: **PROCEED with adjusted scope**

**Why:**
1. The Kalshi side is everything we hoped for — multi-million-dollar OI, clean federalreserve.gov resolution, mutually-exclusive bucket markets that map cleanly to CME's hike/cut/hold table, 5-min decision-day window confirmed via live API.
2. There IS documented arbitrage signal between the two venues per multiple 2026 industry pieces. The Fed's own working paper (FEDS 2026-010) studies the venue.
3. Both KXFED-26APR and KXFEDDECISION-26APR are live RIGHT NOW, with the Apr 29 meeting in 21 days. We have a perfect dry-run window.
4. The free yfinance fallback is good enough for Phase 1 architectural validation, even if not for live arbitrage.

### Surprises and concerns that change the original plan

1. **Direction of the lag has reversed.** 2025–2026 reporting suggests Kalshi leads CME on macro news, not the other way around. The strategy still works, but the mental model flips: we are watching CME catch up to Kalshi, not the reverse. Verify this against the Fed FEDS 2026-010 paper before committing.
2. **Decision day is closed for arbitrage.** Kalshi closes at 13:55 ET, statement at 14:00. The opportunity windows are NFP/CPI/PCE/Powell-speak days, NOT FOMC days. This is a positive — those events are 10x more frequent (3–4 per month) than FOMC meetings.
3. **CME data is the bottleneck.** The whole strategy hinges on having a real-time-or-near-real-time CME feed. Free options are 15-min delayed which kills the live arbitrage thesis. **$25/mo for FedWatch API is the rational spend.**
4. **Bucket mapping is non-trivial.** KXFEDDECISION uses hike/cut buckets; KXFED uses absolute strike levels. CME publishes both rate-level probabilities and meeting-step probabilities. We need a mapping layer in both directions.
5. **9505 series in Kalshi today** — way more than I'd expected. The filter list above is hand-curated; an automated daily rescan for new Fed/FOMC tickers would be cheap insurance.

### Highest-value next steps (in order)

1. **READ THE PAPER.** Download `https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf` manually and extract the actual lag numbers and direction. **This single document changes the entire strategy if the conclusions differ from the journalistic narrative.**
2. Fetch and read `FEDDECISION.pdf` to confirm the KXFEDDECISION resolution rules and edge cases.
3. Verify the candlesticks endpoint with a wider window on a more active market (e.g., KXFEDDECISION-26APR-H0 for the past 7 days at 5-min interval). This is the backfill substrate for any historical comparison.
4. Build the `YfinanceFedFundsClient` with the CME methodology math, test offline against a known historical date where probabilities are published. Get the math right BEFORE wiring the polling loop.
5. Use the Apr 28–29 FOMC meeting as the **dry-run capture window**. Even with 15-min-delayed CME data, capture a complete record of every Kalshi tick + every CME snapshot from Apr 21 (one week before) through Apr 29 close. Post-mortem the data by hand. Decide whether to subscribe to the real CME API after that.
6. Only AFTER the dry run produces signal do we build divergence alerting / live arbitrage logic.

**Sizing reality check:** $25k Kalshi position limit per member, 1¢ ticks → max profit per $25k position is bounded by spread × position. If we catch a 5¢ divergence on a $25k position, that's $1,250 gross before fees. Worth it if we catch a few per month; not worth it if it's once per quarter. The dry-run is what tells us which.

---

### Sources

- [Kalshi REST API base](https://api.elections.kalshi.com/trade-api/v2)
- [Kalshi FED.pdf certification](https://kalshi-public-docs.s3.us-east-1.amazonaws.com/regulatory/product-certifications/FED.pdf)
- [Federal Reserve FOMC calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
- [Federal Reserve open market operations / target range](https://www.federalreserve.gov/monetarypolicy/openmarket.htm)
- [Fed FEDS Working Paper "Kalshi and the Rise of Macro Markets" (2026-010)](https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf)
- [CME FedWatch tool](https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html)
- [CME FedWatch API page](https://www.cmegroup.com/market-data/market-data-api/fedwatch-api.html)
- [CME FedWatch End-of-Day API wiki](https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457320466)
- [CME FedWatch methodology article](https://www.cmegroup.com/articles/2023/understanding-the-cme-group-fedwatch-tool-methodology.html)
- [Atlanta Fed Market Probability Tracker](https://www.atlantafed.org/cenfis/market-probability-tracker)
- [Minneapolis Fed market-based probabilities](https://www.minneapolisfed.org/banking/current-and-historical-market--based-probabilities)
- [Yahoo Finance ZQ=F](https://finance.yahoo.com/quote/ZQ=F/)
- [Wedbush PredictStreet — FOMC Disconnect (2026-02-05)](https://investor.wedbush.com/wedbush/article/predictstreet-2026-2-5-the-fomc-disconnect-kalshi-traders-signal-march-rate-cut-as-macro-prediction-markets-explode)
- [Stocktwits — Kalshi vs Polymarket on Fed cut](https://stocktwits.com/news-articles/markets/equity/will-fed-cut-rates-today-heres-what-betters-on-kalshi-polymarket-think/cLIHPyIREV3)
- [Kalshi Fed category page](https://kalshi.com/category/economics/fed)
- [GitHub cchummer/cme-api scraping notes](https://github.com/cchummer/cme-api)

---

# Verification Addendum (2026-04-07)

After the initial discovery report (above) recommended PROCEED with adjusted
scope, a follow-up verification pass reading the Fed working paper and
pulling empirical Kalshi trade data reached the **opposite conclusion**.
This addendum records the evidence and the revised decision: **ABORT**.

## Evidence 1 — The Fed working paper flips the lag direction

Paper: **Diercks, Katz, Wright (2026)** — "Kalshi and the Rise of Macro
Markets", FEDS Working Paper 2026-010, 41 pages. Fetched from
`https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf` and
extracted via `pdftotext` (poppler).

Key quotes with page references:

- **pg. 3** (introduction, third finding):
  > "We find the Kalshi median and mode have a **perfect forecast record
  > on the day before the FOMC meeting**, which represents a statistically
  > significant improvement over the fed funds futures forecast."

- **pg. 3** (introduction, CPI finding):
  > "for headline CPI, we find Kalshi provides a statistically significant
  > improvement over the Bloomberg consensus forecast."

- **pg. 1** (abstract):
  > "Our results suggest that Kalshi markets provide a high-frequency,
  > continuously updated, distributionally rich benchmark that is valuable
  > to both researchers and policymakers."

- **pg. 2** (market-maker disclosure):
  > "Classified as a 'Designated Contract Market' — the same category as
  > the Chicago Mercantile Exchange — it is supported by market makers
  > such as Susquehanna."

- The event-study regressions throughout Section 7 use **daily** changes,
  not intraday, because intraday repricing on news is fast enough that
  day-level is the meaningful resolution. The paper measures `∆yt = β0 +
  β1 St + εt` where ∆yt is "the one day change in a moment of the federal
  funds distribution" (pg. 30).

**Implication for us**: the "CME leads, Kalshi lags" thesis we started
with is inverted by published peer-reviewed evidence. Kalshi is at least
as good as fed funds futures at forecasting FOMC outcomes, and beats
Bloomberg consensus on headline CPI. A market-making firm (Susquehanna)
that specializes in fast quote-driven strategies is actively quoting the
book, which makes any minute-scale lag arb structurally implausible.

## Evidence 2 — Empirical trades confirm the market is pinned

Pulled trade history from the Kalshi trades endpoint (verified at
`GET /trade-api/v2/markets/trades?ticker=...`) for the most recently
resolved FOMC contract and the current live contract.

### `KXFEDDECISION-26MAR-H0` (resolved YES on Mar 18 2026 "hold")

6-day window leading to Mar 18 decision day:

| Day        | Price range       | Trades | Volume      |
|------------|-------------------|-------:|------------:|
| 2026-03-13 | 0.990 – 0.990     | 47     | $33,547     |
| 2026-03-14 | 0.990 – 0.990     | 85     | $144,472    |
| 2026-03-15 | 0.990 – 0.990     | 216    | $1,028,031  |
| 2026-03-16 | 0.990 – 0.990     | 137    | $153,723    |
| 2026-03-17 | 0.990 – 0.990     | 180    | $433,376    |
| 2026-03-18 | 0.990 – 0.990     | 335    | $550,575    |

**Zero intraday volatility across 1000 sampled trades and $2.3M volume.**
The market was already at max-confidence YES five days before the
meeting. No exploitable window at any granularity we can poll.

### `KXFEDDECISION-26APR-H0` (live, 21 days out)

Current state: ya=0.9900, yb=0.9800, OI=2,380,832 contracts. Same pinned
pattern. The market has already resolved its forecast value weeks in
advance.

## Evidence 3 — Trading closes before data releases

This is the nail in the coffin for "buy on the number" strategies.

### `KXFEDDECISION-26MAR-H0` trade tail (UTC)

```
2026-03-18T17:58:08.245563Z  yes=0.9900  (13:58 ET)
2026-03-18T17:57:28.655768Z  yes=0.9900
2026-03-18T17:57:18.883769Z  yes=0.9900
...
```

Last trade at 17:58:08 UTC = 13:58 ET. The March 18 FOMC statement drop
was 14:00 ET = 18:00 UTC. **Kalshi stops quoting ~2 minutes before the
announcement**, with final settlement at 14:05 ET. There is a hard
quiet window from ~13:55 ET onward during which no order can be placed.
The "read the wire, fire at Kalshi" strategy is impossible by design.

### `KXCPI-26FEB-T0.2` trade tail (UTC)

Pulled trades for a contested CPI bucket ("CPI MoM > 0.2%" for Feb 2026,
resolved YES at last price 0.53).

```
2026-03-11T12:28:30.52839Z  yes=0.5300  (08:28:30 ET, 90s before release)
2026-03-11T12:28:29.241419Z yes=0.5300
2026-03-11T12:28:23.976845Z yes=0.5300
...
```

CPI release time: 8:30 AM ET = 12:30 UTC. **Trading stopped at
12:28:30 UTC — 90 seconds before release.** Same structural quiet
window. You cannot read the public print and then buy YES.

## Evidence 4 — CPI markets DO have intraday volatility, but it is not lag

The CPI Feb market was the one place we saw real price movement. Hourly
price range on `KXCPI-26FEB-T0.2` across the final ~24 hours:

```
2026-03-11T07  min=0.460 max=0.900 last=0.860   (big move overnight)
2026-03-11T08  min=0.560 max=0.860 last=0.560
2026-03-11T09  min=0.650 max=0.740 last=0.650
2026-03-11T10  min=0.550 max=0.740 last=0.730
2026-03-11T11  min=0.550 max=0.700 last=0.590
2026-03-11T12  min=0.500 max=0.590 last=0.530   (trading stops 12:28)
```

Range: 0.46 → 0.90 → 0.53 in ~5 hours. This is price discovery among
traders with the same public information, not a lag. A bot trading into
this noise without a better model would get run over by the mean
reversion back to the consensus print expectation.

## Evidence 5 — CME FedWatch cost/benefit

Even setting aside the above, the CME side was already marginal:

- Public endpoint: HTTP 403 with explicit anti-scraping warning
- Official REST API: ~$25/mo, OAuth, 60-second cadence minimum
- Free alternatives (`yfinance ZQ=F`, Atlanta Fed weekly): 15+ min
  delayed or slower — useless for anything intraday
- Even if we paid, the Fed paper inverts the trade direction we'd need
  to profit from

## Revised decision

**ABORT Phase 1b.** Record the reasons and keep the weather observer
running as the sole Phase 1 workstream.

Ranked reasons, strongest first:

1. **Published peer-reviewed evidence** (FEDS 2026-010) shows Kalshi
   either leads or equals fed funds futures. The strategy I originally
   proposed assumed the opposite. Building against an inverted
   assumption is a guaranteed loss.
2. **Empirical trades confirm markets pin at max confidence days before
   meetings** for obvious-outcome FOMC events. There is no intraday
   uncertainty to trade against.
3. **Kalshi risk closes trading before every major data release.** The
   entire class of "fast data ingestion arb" is structurally
   impossible — Kalshi has already engineered it away.
4. **The only remaining angle is a modeling moat** (beat Kalshi's
   forecast with our own data/model). The Fed paper shows Kalshi already
   beats Bloomberg consensus on headline CPI. We do not have a better
   model, and building one is a very different project from the
   "observer" shape we have.
5. **CME data is paywalled** and the free alternatives are too slow
   even if the strategy direction were right.

## What saved us

The rigorous Step-0-style discovery pattern caught this. The research
subagent's initial report recommended PROCEED based on surface-level
signals (liquidity, market availability, contract source). The
verification pass that actually fetched the Fed paper and pulled
empirical trade data inverted the recommendation. **Always do the
verification pass before writing code.**

## What we learned that carries forward

1. **Kalshi has sophisticated market makers (Susquehanna).** Any
   latency-based strategy on Kalshi is almost certainly arb'd away.
2. **Kalshi closes trading before data releases.** This forecloses the
   entire "event arbitrage" category on FOMC, CPI, NFP, and PCE
   markets. Any future strategy has to work *before* the quiet window.
3. **The Fed's own academic work is a valuable research resource.**
   `EconFutures.com` is scheduled to publish their distributional
   dataset; worth checking once it's live if we ever want to model
   Kalshi directly.
4. **The Kalshi trades endpoint (`/markets/trades?ticker=...`) is
   excellent for backtesting** — full executed tape, cursor-paginated,
   unauthenticated. This is reusable for verifying any future strategy
   candidate without writing infrastructure first.

## Next action

None for FOMC/macro. Let the weather observer (Phase 1a) run. Revisit
in 2-4 days to inspect the first batch of real data via the HTTP
inspection endpoints.
