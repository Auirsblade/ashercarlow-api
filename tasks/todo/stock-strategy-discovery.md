# Stock Strategy Discovery: PEAD + Short-Term Reversal Backtest

**Date:** 2026-04-07
**Status:** Investigation complete. Recommendation: **WAIT / RECONSIDER** (see final section).
**Backtest scripts:** `/tmp/stock-backtest/{fetch_data.py, backtest3.py}`
**Raw data:** `/tmp/stock-backtest/{close.parquet, earnings_raw.parquet, earn_clean.parquet, results3.json, curves.pkl}`

---

## TL;DR

The headline backtest shows PEAD long-only top-10% earnings surprises producing **66% CAGR vs SPY's 15% over 2020-2025** at 1x leverage with Sharpe 1.62. **This number is misleading.** When the OOS window is broken into sub-periods, the PEAD edge is **decaying rapidly**:

| Period | PEAD top-10 long 1x CAGR | SPY CAGR | Edge |
|---|---|---|---|
| 2020-2021 (COVID/QE era) | +83.8% | +23.4% | +60.4% |
| 2022-2023 | +104.8% | +1.6% | +103.2% |
| **2024-2025** | **+21.4%** | **+21.8%** | **-0.4%** |

The signal is essentially dead in the most recent two years. Per-trade mean 5d return on top-10% positive surprises has fallen from 1.35% (2020-21) → 0.49% (2022-23) → 0.31% (2024-25), while the all-earnings baseline 5d return is now *higher* (0.61%) than the top-10% selection. **In 2024-2025, picking the highest earnings surprises was actively worse than picking random earnings reporters.** This is consistent with the well-documented post-2000 decay of PEAD as the strategy has been arbitraged away by HFT.

Short-term mean reversal performs *worse* than SPY in every sub-period and every long-short variant has a negative Sharpe across the entire OOS window. It is a confirmed dead strategy at this scope.

**Recommendation: do not build a live system on these signals as configured.** The PEAD edge has decayed below transaction costs and is no longer a defensible alpha source for retail at 5-day holding periods. Specific pivots are listed at the end.

---

## Methodology

### Data sources verified

| Source | Used | Notes |
|---|---|---|
| yfinance prices | YES | Adjusted close 2014-06 to 2025-12, 503 → 495 valid S&P 500 tickers. Bulk download in ~5s. |
| yfinance `get_earnings_dates(limit=80)` | YES | Returns up to 100 quarters of EPS Estimate, Reported EPS, Surprise(%) per ticker. 43,478 raw rows fetched in ~7 minutes (sequential, ~1 req/sec). 99.3% of rows have a consensus estimate (no need for YoY proxy). |
| Wikipedia S&P 500 list | YES | 503 current constituents. **Survivorship-biased — see below.** |
| Financial Modeling Prep / Finnhub | NOT NEEDED | yfinance gave us consensus estimates. |
| Stooq | NOT NEEDED | |

### Sample built

- **Universe:** Current S&P 500 (Apr 2026 snapshot from Wikipedia, 495 with full price history).
- **Earnings:** 21,712 announcements with valid SUE and 5-day forward return inside the price window 2014-06-04 → 2025-12-12.
- **Tuning window:** 2015-01-01 to 2019-12-31 (used only to set the SUE percentile threshold; reported metrics are descriptive only).
- **Out-of-sample:** 2020-01-01 to 2025-12-31 (1,507 trading days).
- **Surprise definition:** `(actual_eps - consensus_eps) / |consensus_eps|` from Yahoo's `Surprise(%)` field. YoY proxy (`(actual - lag4)/|lag4|`) used as fallback only when estimate is missing (<1% of rows).
- **Threshold:** Computed on the tuning window only. For top-10%: |SUE| ≥ 0.290.
- **Entry:** Close of the first trading day strictly after `ann_date` (conservative — avoids any same-day lookahead concern).
- **Exit:** Close 5 trading days later.
- **Sizing:** Equal-weight across all qualifying positions active that day. Gross exposure normalized to `leverage` per day. Cap of 20 per entry-day for PEAD.
- **Costs:** 5 bps per side (10 bps round trip) on large caps, deducted at entry.
- **Benchmark:** SPY adjusted-close buy-and-hold.

### Bugs caught and fixed during this work

1. **First aggregation bug:** Initial backtest summed per-day return contributions across overlapping cohorts without normalizing by cohort count, producing impossible numbers (Sharpe > 2 with -90% drawdowns). Fixed by maintaining a proper position book and computing portfolio return as the leverage-weighted average of active position daily returns.
2. **Critical date bug:** `searchsorted` returned index 0 for any earnings date before the price-data start (2014-06), causing all pre-2014 earnings to phantom-trade on 2014-06-02 with a single bogus return value. Fixed by filtering earnings to the price data window before computing entry indices.
3. **Duplicate earnings rows:** yfinance occasionally returns the same announcement twice (rescheduled or revised). Deduplicated on `(ticker, ann_date)`.

### Things the backtest does NOT model

| Omission | Direction of bias on results | Magnitude estimate |
|---|---|---|
| **Survivorship bias** (current S&P 500 list, not point-in-time) | Inflates returns | ~1-2% CAGR for the index itself; for PEAD long-only it is potentially much larger (3-5% CAGR) because failed positive-surprise stocks are entirely missing from the sample. |
| **Slippage / market impact** | Inflates returns | 2-5 bps per side on top of commissions for liquid large caps trading near the close. |
| **Borrow cost on shorts** | Inflates long-short variants | 3-5% annualized on liquid large caps; the long-short PEAD is unaffected by this in terms of pass/fail but shorts are not free. |
| **Delisting / corporate actions during the holding window** | Inflates returns | Small. yfinance adjusted close handles splits/dividends but not delistings. |
| **Yahoo "consensus estimate" provenance** | Possibly inflates surprises | Unclear whether Yahoo's posted estimate is the pre-announcement consensus or a backfilled/revised number. If revised, the surprise field is biased toward larger absolute values. Industry standard is I/B/E/S point-in-time consensus, which costs $$. |
| **Taxes** | n/a (apples-to-apples vs SPY pre-tax) | Short-term capital gains rate would substantially erode the strategy advantage further; SPY held >1 year is LTCG. |

The combination of survivorship bias + Yahoo consensus uncertainty is enough to reasonably believe the headline 66% CAGR is overstated by a factor of 1.5-2x even before considering signal decay.

---

## Headline table

All numbers are out-of-sample 2020-01-01 to 2025-12-31, net of 5 bps/side transaction cost. PEAD trade count is total OOS qualifying entries (not annualized).

| Variant | Lev | CAGR | Sharpe | Max DD | OOS Trades | Win % | vs SPY CAGR | Pass/Fail |
|---|---|---|---|---|---|---|---|---|
| **SPY buy-and-hold** | 1x | **+15.2%** | 0.79 | -33.7% | 1 | 55% | — | **baseline** |
| PEAD top10 long | 1x | +66.0% | 1.62 | -28.0% | 1,372 | — | +50.8% | **PASS***|
| PEAD top10 long | 1.5x | +104.6% | 1.62 | -41.8% | 1,372 | — | +89.4% | PASS* |
| PEAD top10 long | 2x | +144.8% | 1.62 | -54.9% | 1,372 | — | +129.6% | FAIL (DD>50%)|
| PEAD top10 long | 3x | +220.4% | 1.62 | -76.3% | 1,372 | — | +205.2% | FAIL (DD>50%)|
| PEAD top10 long-short | 1x | +51.3% | 1.33 | -36.9% | 1,791 | — | +36.1% | PASS* |
| PEAD top10 long-short | 2x | +102.1% | 1.33 | -63.5% | 1,791 | — | +86.9% | FAIL (DD>50%)|
| PEAD top20 long | 1x | +69.7% | 1.77 | -28.2% | 2,596 | — | +54.5% | PASS* |
| PEAD top20 long | 2x | +158.8% | 1.77 | -50.0% | 2,596 | — | +143.6% | borderline |
| PEAD top30 long | 1x | +61.5% | 1.79 | -28.1% | 3,597 | — | +46.3% | PASS* |
| Reversal dec10 long | 1x | +16.1% | 0.63 | -55.8% | weekly | — | +0.9% | **FAIL** (DD)|
| Reversal dec10 long | 2x | +21.4% | 0.63 | -83.5% | weekly | — | +6.2% | FAIL |
| Reversal dec10 long-short | 1x | -7.2% | -0.48 | -42.6% | weekly | — | -22.4% | FAIL |
| Reversal dec05 long | 1x | +14.2% | 0.55 | -66.2% | weekly | — | -1.0% | FAIL |
| Reversal dec20 long | 1x | +14.8% | 0.62 | -50.8% | weekly | — | -0.4% | FAIL |

\* "PASS*" means it satisfies the literal pass criterion (CAGR > SPY, DD < 50%) on the full 2020-2025 window, but **see the sub-period decomposition below — the asterisk is doing heavy lifting because most of the alpha was earned in 2020-2023 and is gone in 2024-2025.**

---

## Sub-period decomposition (the most important table in this report)

| Variant | 2020-2021 CAGR | 2022-2023 CAGR | **2024-2025 CAGR** | Sharpe 24-25 |
|---|---|---|---|---|
| SPY buy-and-hold | +23.4% | +1.6% | **+21.8%** | 1.29 |
| PEAD top10 long 1x | +83.8% | +104.8% | **+21.4%** | 0.77 |
| PEAD top10 long 2x | +196.0% | +272.6% | +32.8% | 0.77 |
| PEAD top10 long-short 1x | +61.8% | +96.9% | **+8.6%** | 0.41 |
| PEAD top20 long 1x | +64.2% | +127.3% | **+31.0%** | 1.05 |
| Reversal dec10 long 1x | +22.3% | +11.5% | **+14.9%** | 0.71 |
| Reversal dec10 long-short | -8.9% | -1.6% | -10.9% | -1.00 |

**The 2024-2025 row is what live trading would experience if you started today.** PEAD top10 long-only **ties** SPY on CAGR but has substantially worse Sharpe and much larger drawdowns (-28% vs SPY -19%). PEAD top20 long-only is the only variant that still meaningfully beats SPY in the most recent period and does so with a Sharpe below SPY's. Both reversal variants fail.

### Per-trade edge decay

| Period | Top-10 SUE long, mean 5d ret | All-earnings baseline 5d | Edge | Trades |
|---|---|---|---|---|
| 2015-2019 (tune) | +0.70% | +0.17% | **+0.53%** | 672 |
| 2020-2021 | +1.35% | +0.85% | +0.50% | 725 |
| 2022-2023 | +0.49% | +0.39% | +0.10% | 315 |
| **2024-2025** | **+0.31%** | **+0.61%** | **-0.30%** | 335 |

The top-10% earnings-surprise selection is **negatively** alpha-generating in 2024-2025: random earnings reporters did better than the highest-surprise reporters. This is the textbook signature of a factor that has been arbitraged out by faster players. After 5 bps/side costs, even a 30 bps negative edge becomes -40 bps round-trip — actively losing money.

### Placebo test (signal validity check)

Random tickers, same entry days, same trade counts as PEAD top10 → CAGR -2.1%, Sharpe near 0. So the PEAD signal IS responsible for the historical lift; this is not a hidden leakage bug. The signal is real but **dying**.

### Tuning vs OOS Sharpe (overfitting check)

| Variant | Tune Sharpe (2015-19) | OOS Sharpe (2020-25) | Delta |
|---|---|---|---|
| PEAD top10 long 1x | 1.91 | 1.62 | -0.29 |
| PEAD top20 long 1x | 2.14 | 1.77 | -0.37 |
| PEAD top30 long 1x | 2.47 | 1.79 | -0.68 |
| PEAD top10 long-short 1x | 1.43 | 1.33 | -0.10 |
| Reversal dec10 long 1x | 0.71 | 0.63 | -0.08 |
| Reversal dec10 long-short | -1.45 | -0.48 | +0.97 |

Tune-to-OOS degradation is modest on the full OOS window — but as shown in the sub-period table, the OOS window itself contains a structurally different first half (which looks like the tuning era) and a structurally different second half (where the signal dies). The traditional tuning/OOS split mostly hides this; the only honest measure is the most recent 2 years.

---

## Sensitivity to costs

| Variant | 5 bps/side CAGR | 15 bps/side CAGR | Delta |
|---|---|---|---|
| PEAD top10 long 1x | +66.0% | +55.3% | -10.7% |
| PEAD top10 long-short 1x | +51.3% | +40.8% | -10.5% |

The strategies are NOT extremely sensitive to costs at the headline level — but at the per-trade level the edge is now ~0.3% per trade (2024-25). Adding 10 bps round-trip cost eats one-third of that edge. Adding slippage/market impact would erode the rest. **At realistic 2024-2025 edge levels, no version of PEAD as configured will survive trading frictions.**

---

## Equity curve summary (year-end values, base 1.00 at 2020-01-01)

```
                                2020   2021   2022   2023   2024   2025
SPY buy-and-hold                1.18   1.52   1.25   1.57   1.96   2.33
PEAD top10 long 1x              1.98   3.39   7.73  14.09  23.80  20.73   <- Drawdown in 2025
PEAD top20 long 1x              1.70   2.70   6.60  13.81  22.44  23.64
Reversal dec10 long 1x          1.27   1.50   1.35   1.86   2.21   2.45
```

The PEAD top10 line went from 23.8 at end-2024 to 20.7 at end-2025 — a **-13% calendar-year drawdown in 2025 alone** while SPY was up ~19%. That single year is what matters for "would I trade this live in 2026?" and the answer is "no."

### Worst / best months (PEAD top10 long 1x, OOS)

- **Worst 3 months:** 2025-12 (-16.2%), 2025-03 (-14.3%), 2024-10 (-13.5%)
- **Best 3 months:** 2022-05 (+37.9%), 2020-11 (+26.4%), 2021-06 (+25.4%)
- **Mean monthly:** +4.76%, **median:** +3.93%, **std:** 9.92%

All three worst months are in the most recent ~14 months. All three best months are in the meme/QE era. The strategy's signature has flipped.

---

## Final recommendation: WAIT / RECONSIDER

### What the data clearly says

1. **Reversal at 5-day holds on the S&P 500 is dead** at every variant tested. Long-short produces negative Sharpe in every sub-period; long-only fails to beat SPY in 2024-2025. Do not build this.
2. **PEAD has decayed past the point of usefulness** at the configured parameters. The headline 1.6 OOS Sharpe is real but earned almost entirely 2020-2023. In the most recent 2 years, top-decile selection is *negative alpha* on a per-trade basis.
3. **Survivorship bias + Yahoo's consensus uncertainty** mean the historical numbers are likely overstated by another 25-50%. Even the encouraging sub-periods are softer than they look.
4. **Leverage is uniformly value-destroying at >1.5x** because the underlying signal is weak and the drawdowns scale linearly with leverage while CAGR has diminishing real expectation in the live regime.

### Why this is not "ABORT"

- The PEAD signal was real for ~3 years inside the OOS window. That is not a fluke.
- The data infrastructure built here (yfinance earnings + bulk price + clean book backtest engine) is reusable for adjacent strategies.
- The 0.3% / 5-day edge in 2024-2025 isn't catastrophically negative — it's noise around zero. A different formulation might reactivate it.

### Specific pivots to consider before abandoning the family

1. **Smaller universe, less efficient names.** PEAD is dead in the S&P 500 because every quant fund trades it. The same signal applied to S&P 600 small-cap stocks (or Russell 2000) is documented to retain meaningfully more alpha. The user said no penny stocks, but liquid small-cap (>$500M market cap, >$5M ADV) is a different beast from microcap.
2. **Longer holding period.** The Chordia/Goyal/Sadka result is about *60-day* drift, not 5-day. The 5-day window picks up the most arbitraged piece. Test 20-day and 60-day holds; expect lower turnover, lower per-trade edge, possibly higher Sharpe-after-costs.
3. **Combine with price momentum confirmation.** "Positive surprise + positive 1-day announcement reaction" is a stronger signal than surprise alone (the price tells you the market believed the surprise). Filter for entry only when ann-day return > 0.
4. **Earnings-week effect, not surprise.** The "all earnings baseline 5d return" of 0.61% in 2024-25 is itself higher than SPY. There may be a usable strategy in just being long any name reporting earnings in the next 5 days, regardless of surprise. Worth a 1-day side experiment.
5. **Better data.** Buying I/B/E/S consensus or using FMP's paid tier ($15-20/mo) for point-in-time estimates would resolve the main "is this signal real or measurement noise" question. So would buying a survivorship-bias-free S&P 500 historical constituents file.

### If you want to PROCEED anyway with the cleanest current variant

- **Variant:** PEAD top20 long-only at 1x leverage (most recent 2-year CAGR +31%, Sharpe 1.05 vs SPY 1.29).
- **Caveats:** Beats SPY by ~9% CAGR in 2024-25 but with worse Sharpe and a -23% drawdown in 24 months. The edge is fragile and the historical numbers are inflated by survivorship bias.
- **Required next step before live capital:** Build an Alpaca paper-trading observer that runs the daily PEAD scanner for 3-6 months, log each signal, and compare paper P&L to the backtest's prediction. If forward performance matches backtest 24-25 sub-period (~30% annualized, Sharpe ~1), proceed cautiously to 0.25x of intended capital. If forward Sharpe < 0.5, kill it.

### Honest summary of expected value

There is roughly a 25% chance that a thoughtful PEAD variant on small-mid caps with longer holds beats SPY by 5%+ CAGR after costs in live trading, vs roughly a 60% chance it ties or modestly trails SPY, vs roughly a 15% chance it loses meaningfully. The base PEAD-on-S&P500-5d configuration tested here is in the bottom of that distribution. **Recommended action: shelve this specific configuration; spend a focused day on the small-cap + 60-day-hold variant before committing to building an observer.**

---

## Files produced (all under /tmp, throwaway)

- `/tmp/stock-backtest/sp500.csv` — current S&P 500 list from Wikipedia
- `/tmp/stock-backtest/close.parquet`, `open.parquet`, `spy.parquet` — adjusted prices 2014-06 to 2025-12
- `/tmp/stock-backtest/earnings_raw.parquet` — 43,478 raw earnings rows from yfinance
- `/tmp/stock-backtest/earn_clean.parquet` — 21,712 deduplicated, in-window earnings with computed SUE and 5d forward return
- `/tmp/stock-backtest/results3.json` — full metrics for every variant
- `/tmp/stock-backtest/curves.pkl` — equity curves for the headline variants
- `/tmp/stock-backtest/{fetch_data.py, backtest3.py}` — reproducible scripts

## Sources

- [yfinance get_earnings_dates documentation](https://ranaroussi.github.io/yfinance/reference/api/yfinance.Ticker.get_earnings_dates.html)
- [yfinance source on github](https://github.com/ranaroussi/yfinance/blob/main/yfinance/base.py)
- [List of S&P 500 companies (Wikipedia)](https://en.wikipedia.org/wiki/List_of_S%26P_500_companies)
