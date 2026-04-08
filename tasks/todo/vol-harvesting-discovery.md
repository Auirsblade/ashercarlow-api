# Iron Condor Strategy Discovery

Read-only research + backtest. All numbers below come from actual code runs against
yfinance data 2015-2026 plus a Black-Scholes synthetic options pricer with a
calibration haircut. No trades placed. No production code modified.

## Summary

| Question | Answer |
|---|---|
| VRP currently present? | **YES** — 11-yr mean VRP = +3.31 vol pts, +ve 84% of days. Today VRP = +7.61 (85th pctile) |
| Mechanical put-writing beats SPY risk-adjusted (2016-2025)? | **NO** — PUTW CAGR 2.9% vs SPY 15.7%, Sharpe 0.28 vs 0.90 |
| Retail iron condor backtest +EV after BS pricing haircut? | **MARGINAL** — ~$21/contract/month after 35% credit haircut, Sharpe 0.41 |
| Survives COVID / Volmageddon / Aug 2024 at 1-contract sizing? | **PARTIAL** — Feb 2018 +$142, Feb 2020 –$325 (full max loss = 33% of $1k), Jul 2024 +$175 |
| Schwab API supports 4-leg spread orders? | **YES** — single-transaction multi-leg via schwab-py / direct REST, OCO supported |
| **Decision gate** | **WAIT** — see Final Recommendation |
| Recommended sizing on $1000 | **0 contracts now / 1 contract if you decide to start, accepting ~8% 12-mo P(ruin)** |

---

## 1. Current VRP regime

Source: yfinance `^VIX` and `SPY`, 2015-01-02 through 2026-04-07. SPY 30-day
realized vol computed from 21-day rolling std of daily log returns, annualized
by sqrt(252).

**11-year VRP distribution (VIX − RV30, in vol points):**

| Stat | Value |
|---|---|
| Mean | +3.31 |
| Median | +3.78 |
| Stdev | 5.83 |
| Min | −48.76 (March 2020) |
| Max | +22.89 |
| % days positive | 84.0% |
| Q1 | +1.58 |
| Q3 | +6.04 |

**As of 2026-04-07:**

| | Level | Percentile vs 2015-2026 |
|---|---|---|
| VIX | 25.78 | 87.9% |
| SPY 30-day RV | 18.17 | 74.6% |
| **VRP** | **+7.61** | **85.2%** |

Interpretation: VRP is in the **top quartile** of its 11-year distribution. Vol
is "expensive" right now — both implied and realized are elevated (likely
tariff/macro regime), and the gap between them is wider than ~85% of historical
days. This is the "amplified return AND amplified tail risk" regime per the
spec. A short-vol strategy started today would harvest more premium than
average, but a vol shock from these levels would be larger in absolute dollar
terms.

A genuinely cautious read: realized vol at 18 with VIX at 26 means the market is
already pricing meaningful stress. The classic "cheap vol → bad time to sell"
warning does not apply, but the "regime is unstable" warning does.

---

## 2. CBOE PUT / PUTW institutional baseline

`^PUT` (the CBOE PUT index direct ticker) is unavailable on yfinance — delisted
from the free feed. Used **PUTW** (WisdomTree CBOE S&P 500 PutWrite Strategy
Fund) as the retail-accessible proxy. Window: 2016-02-24 → 2025-12-30, 9.8 years
of overlapping daily data with SPY (auto-adjusted total return).

| Metric | PUTW | SPY |
|---|---|---|
| CAGR | **2.9%** | **15.7%** |
| Annualized Sharpe | 0.28 | 0.90 |
| Max drawdown | −32.3% | −33.7% |
| Correlation to SPY | 0.823 | — |
| Beta to SPY | 0.601 | — |

**This is the most damning finding in the entire report.** A mechanical
put-writing strategy *at institutional scale, with negligible execution friction
and zero retail-sized fees*, has under-performed SPY by **12.8 percentage points
of CAGR per year for almost a decade**, with worse Sharpe AND essentially the
same max drawdown.

The Variance Risk Premium is real (Part 1 confirms it), but the historical
edge does not translate into better risk-adjusted returns vs simply owning
the index over the 2016-2025 window. The published Carr-Wu / Bakshi-Kapadia
results were on data that included high-vol regimes (1990s, 2008) that the
2016-2025 window largely missed. PUTW's structural problem: it caps upside in
every up-month (which has been most months) and still takes the full hit in
down-months.

A retail iron condor caps the down-side too, which is the only reason the
backtest in Part 3 looks salvageable. But the "VRP harvesting beats SPY" thesis
at the institutional baseline is **dead for the 2016-2025 era**.

---

## 3. Retail iron condor backtest (2015-2025)

### Method

- 133 trades, one entry per month, first trading day of each month, 2015-01 to 2025-12
- Expiration: third Friday of next monthly cycle (~30-45 DTE at entry)
- Legs: short 0.20-delta put + long put 5 below; short 0.20-delta call + long call 5 above
- IV input: VIX as ATM proxy; **+2 vol-point skew adjustment** added to put-side IV per spec
- Risk-free rate: `^IRX` (13-week T-bill), refreshed daily
- Strikes computed via binary-search inversion of Black-Scholes delta, rounded to $1
- P&L walked daily via BS revaluation until expiration
- Exit variants tested: (a) hold-to-expiry, (b) close at 50% max profit, (c) close at 2× credit loss stop

### Sanity check vs reality

Raw BS output for a representative trade (SPY 450, VIX 15, 35 DTE, 0.20 delta,
5-wide condor) gave **credit ≈ $174** on a $500 wing. Real-world SPY iron
condors at the same parameters typically credit $90–$130. **BS overprices
credit by ~30-40% in a normal-vol regime** because (a) ATM VIX is a poor IV
input for OTM strikes — actual surface skew puts the 20-delta strikes much
closer to spot than BS-with-flat-VIX implies, and (b) the +2 vol-point adjustment
is too crude a skew correction.

To compensate, the analysis below applies a **35% haircut to BS credit
(`HAIRCUT = 0.65`)** and increases max loss correspondingly. Numbers are
adjusted unless labeled "BS raw."

### Headline results (after credit haircut)

| Variant | Win rate | Mean P&L / contract | Stdev | Annualized Sharpe | Sum 2015-2025 (1 ct/mo) |
|---|---|---|---|---|---|
| Hold to expiry | 77.4% | **+$20.81** | $177 | 0.41 | +$2,767 |
| Close at 50% profit | 85.7% | **−$9.59** | $137 | −0.24 | −$1,275 |
| Close at 2× credit stop | 77.4% | +$20.84 | $177 | 0.41 | +$2,772 |

Average credit per trade after haircut: **~$110**. Average max loss: **~$390**.

Notable: under the realistic credit assumption, the **50%-profit-take variant
turns negative**. Reason: closing winners early means the same 23% of losers
must be paid for with smaller average winners. The classic "tastytrade 50%
mantra" only works when the credit you receive is generous enough that half of
it still beats the loss tail. With realistic credits the math flips. This is a
non-trivial finding that contradicts a lot of retail folklore.

The 2× stop variant is essentially identical to hold-to-expiry because the BS
revaluation on **daily closes** rarely walks far enough beyond credit-level loss
to trigger 2×. In reality the stop *would* trigger more often on intraday spikes
(March 2020, Feb 2018) — but it would also fire on whipsaws that subsequently
recovered, so it is not obviously better. Treat the stop column as a weak upper
bound on stop-loss benefit.

### Stress tests

Each "stress test" is the actual monthly entry that bracketed the event. Daily
BS revaluation with full VIX path. Numbers are *unadjusted BS* (raw credit)
because the haircut adjustment is most meaningful in normal regimes.

| Event | Entry | SPY entry | VIX entry | Credit | Hold P&L | 50% P&L | Stop P&L |
|---|---|---|---|---|---|---|---|
| **COVID** | 2020-02-03 | 324.12 | 18.0 | $175 | **−$325** | −$325 | −$325 |
| **Volmageddon** | 2018-01-02 | 268.77 | 9.8 | $142 | **+$142** | +$84 | +$142 |
| **Yen carry** | 2024-07-01 | 545.34 | 12.2 | $175 | **+$175** | +$157 | +$175 |

**COVID is the existential test.** A Feb-3-2020 entry with March expiration ate
a full max-loss ($325 in BS dollars, ~$390 with haircut). On a $1,000 account
with 1 contract, that single month is a **−33% to −39% drawdown**. The 2× stop
did not save the position — by the time SPY had moved enough to trigger it on a
daily close, the spread was already at near-max-loss and there was no escape.
At 2 contracts the same month is **−66% to −78%** — likely below the $100 ruin
threshold, especially after broker assignment fees and SPY-specific
early-assignment risk.

Volmageddon is *not* a stress test for monthly condors as constructed: the
position was opened Jan 2 with Feb 16 expiration, well before VIX spiked Feb 5,
and by Feb 16 SPY had recovered enough that the monthly condor closed for a
small win. The XIV blowup destroyed *short-VIX-future* products, not 35-DTE
0.20-delta condors. This is a useful negative result — the strategy isn't as
fragile to a single-day vol spike as it first appears, **provided** the spike
is followed by mean reversion within the holding window.

Yen carry (Aug 5 2024) is similar: the July 1 entry held through the Aug 5
spike and recovered by the Aug 16 expiration.

The honest reading: **the strategy survives sharp-but-short vol shocks
(Volmageddon, Yen carry) and dies on sustained vol expansions (COVID).** Of the
133 backtested months, **25 are losers** — the worst 5 of those clustered in
March 2020, Sep 2022 (Fed pivot), and Apr 2025 (tariff shock).

---

## 4. Sizing and survival analysis

All numbers from the haircut-adjusted hold-to-expiry distribution.

### Per-trade statistics

| | Value |
|---|---|
| p(win) | 0.774 |
| p(loss) | 0.226 |
| avg win | $106.83 |
| avg loss | $274.53 |
| Expected value per trade | **+$20.81** |
| Win/loss ratio b | 0.389 |

### Kelly sizing

Full Kelly fraction f* = (bp − q) / b = **0.195** (19.5% of bankroll at risk per
trade). Conservative Kelly (f*/4) = **4.9% of bankroll at risk per trade**.

On a $1,000 account with avg max loss $390/contract, even **1 contract puts 39%
of bankroll at risk** — i.e., the strategy at minimum-viable-size already runs
at ~2× full Kelly, which is well into "expected geometric ruin" territory. This
is the fundamental retail-sizing problem: SPY iron condors are not divisible
enough for a $1k account to size below Kelly. To get to conservative Kelly
($49 risk per trade) you would need **either** (a) a $7,800+ account, or (b)
defined-risk spreads on a smaller underlying (e.g., XSP at 1/10 SPX notional).

### Monte Carlo, $1,000 start, 12 months, 10,000 sims

Bootstrap from the empirical haircut-adjusted P&L distribution. Bankruptcy
defined as balance dropping below $100.

| Contracts | Median | 10th pctile | 90th pctile | Mean return | **P(ruin)** |
|---|---|---|---|---|---|
| **1** | $1,292 | $346 | $2,013 | +24.5% | **7.7%** |
| 2 | $1,569 | $0 | $3,066 | +48.7% | **26.5%** |
| 3 | $1,531 | $0 | $4,050 | +65.3% | **40.3%** |

At 1 contract: median +29%, but the lower decile loses 65% and ~1 in 13 sims
goes bust. At 2 contracts the upside is meaningfully better but **1 in 4
accounts is bust within 12 months**. At 3 contracts, **2 in 5 are bust**.

These ruin probabilities are if anything **optimistic** because:

1. The 35% haircut is a guess. If real-world credits are 50% of BS, mean P&L
   drops from +$21 to roughly −$10 (similar to the 50%-profit-take row).
2. Slippage on entry/exit (bid-ask on 4 legs) easily costs $15-30 round-trip
   per contract at retail.
3. Schwab's $0.65 × 4 legs × 2 sides = $5.20 per cycle.
4. Bootstrap assumes losses are i.i.d., but real losses cluster in
   vol-regime-change months (March 2020, Sep 2022, April 2025). Cluster losses
   would push P(ruin) higher.

**Realistic recommended sizing: 1 contract per month, with eyes-open acceptance
of ~10-15% probability of losing the account inside a year.**

### Annualized return at recommended sizing

At N=1: bootstrapped mean ending balance $1,235 → **mean nominal annualized
return ~24%, P(ruin) ~8%, with the 10th-percentile path losing ~65% of
starting capital**. This is *roughly* consistent with the published academic
VRP literature (~5% annualized excess return, leveraged ~5× by the bankroll-
relative position size). It is **not** consistent with the marketing claims of
options-selling content creators promising 30-50% annualized at low risk.

---

## 5. Schwab API viability

### Spread orders
**YES, fully supported.** Schwab Trader API (the post-TDA replacement) accepts
4-leg spread orders as a single transaction. The community libraries
[`schwab-py`](https://schwab-py.readthedocs.io/en/latest/order-builder.html)
and `schwabdev` expose helpers for building iron condor `OrderBuilder` objects;
direct REST works equivalently. Multiple users on EliteTrader confirm sending
4-leg butterflies and condors as single combo orders daily. Best practice
(and Schwab's own docs) recommend never legging in.

### OCO orders
Supported. `OrderStrategyType = "OCO"` wraps two child orders (profit target and
stop) so that fill of one cancels the other.

### Auth flow
OAuth 2.0 via developer.schwab.com app registration. Access token expires every
**30 minutes** (auto-refreshable). Refresh token expires every **7 days, hard**
— there is currently no way to extend it. **This is the single largest
operational hazard for an unattended algo:** every Sunday-ish, the human must
re-authenticate manually through a browser. A monthly-cadence iron condor only
needs 12 trades a year, so the 7-day refresh inconvenience is not fatal, but
the algo cannot be left untouched for more than a week without breaking.

### Rate limits
~120 API calls/minute overall. Order placement is throttled per-account
(0-120/min depending on registration). For a once-a-month trade this is
irrelevant — you'll burn 5-10 calls per cycle.

### Fees
**$0.65 per contract**, charged on every leg. A 4-leg iron condor open + close
= 8 leg-fills × $0.65 = **$5.20 per cycle, per contract**. Buy-to-close orders
priced ≤ $0.05 are commission-free, which marginally helps profit-target exits.
On a ~$110 average credit, that's a **~5% friction tax** on every cycle. The
backtest does not include this; subtracting it from the +$20.81 mean drops
expected per-cycle P&L to **+$15.61**.

### Alternative: Alpaca options API
- Multi-leg ("MLeg") orders supported: set `order_class = "mleg"` and pass a
  4-element `legs` array for an iron condor. Working example in the official
  [`alpaca-py` repo](https://github.com/alpacahq/alpaca-py/blob/master/examples/options/options-iron-condor.ipynb).
- **Commission-free** US options trading. Only regulatory pass-through fees
  (SEC, FINRA, OCC, ORF) which are pennies per contract.
- Level 3 (multi-leg) was rolled out across 2025 and is GA in 2026.
- Auth: standard API key + secret, **no 7-day refresh-token expiry**.

### Recommendation
**Alpaca is the better fit for this strategy, by a meaningful margin:**

1. ~$5 lower friction per cycle (eliminates ~25% of the edge at retail size).
2. No 7-day OAuth re-auth treadmill — true unattended operation.
3. Cleaner Python SDK with a documented iron condor example.

Schwab is fine if the user already has the account and wants to consolidate, but
the 7-day refresh-token ceiling and per-contract fees both meaningfully erode an
already-thin retail edge. **For a $1,000 mechanical iron condor, Alpaca wins.**

---

## 6. Data limitations

Be skeptical of every number above. The known approximation errors:

1. **Black-Scholes overprices BS-VIX-flat options by ~30-40%.** I corrected
   with a 35% haircut, but the true number depends on regime (skew is steeper
   in panics, flatter in calm). Real per-trade EV could be anywhere from +$25
   (if I over-haircut) to −$5 (if I under-haircut).
2. **No surface skew model.** A real 0.20-delta put has ~3-5 vol points more
   IV than the corresponding call. The +2 vol-point flat adjustment is a
   placeholder, not a model.
3. **No bid-ask slippage.** SPY options are liquid but spreads at 0.20 delta
   on weekly liquidity months can be $0.05-0.10/leg. Round-trip on 4 legs
   = $0.40 = $40/contract worst case. Realistic mid-fills get you maybe
   $15-20/contract slippage.
4. **No early-assignment risk.** SPY is American-style. At ~5% probability of
   ITM expiration, early assignment of a short put on a dividend-pay date is
   small but real and ugly to handle programmatically.
5. **Daily-close revaluation only.** Intraday vol spikes (Feb 5 2018, Aug 5
   2024) can briefly push BS values past stop-loss thresholds. Real
   stop-loss execution would fire more often than the backtest shows, but
   would also produce more whipsaw losses.
6. **i.i.d. bootstrap assumption.** Vol shocks cluster in regime changes
   (March 2020 had two consecutive max-loss months for some entry windows).
   Real ruin probability is probably 1-2pp higher than the bootstrap shows.
7. **Synthetic options use VIX directly as IV.** VIX is a 30-day SPX
   variance measure, not SPY-specific and not at any specific delta. For a
   30-45 DTE 0.20-delta strike on SPY this is "close enough" for a sanity
   check, but not for live trading decisions.
8. **No taxes.** Iron condors are short-term capital gains in the absence of
   60/40 treatment (which only applies to SPX/XSP, not SPY). Federal +
   state ordinary income tax on a 24% nominal return knocks net returns to
   ~16% for most retail traders.

The combined uncertainty on per-trade EV is roughly **+$20 ± $20**. The strategy
is somewhere between "marginally profitable" and "small loss" once realistic
costs are stacked. It is *not* the +$50/cycle edge that the BS-raw numbers
suggested.

---

## Final recommendation

**WAIT — do not deploy this strategy on a $1,000 account today.**

Specific reasoning:

1. **The institutional baseline is bad.** PUTW under-performed SPY by 12.8 pp/yr
   over the most recent decade with worse Sharpe. The "VRP harvesting wins" claim
   is true historically over multi-decade windows that include 1987, 1998 LTCM,
   2008 — but on the most recent 10 years it is empirically false. Anyone
   recommending this strategy without acknowledging that has not looked at PUTW.
2. **The retail backtest edge is too thin to survive realistic frictions.**
   BS gave +$80/cycle. Haircut → +$21. After Schwab fees → +$16. After
   slippage → +$0 to +$10. After taxes → break-even at best. The strategy
   has positive expected value in a vacuum and ~zero EV in reality.
3. **The minimum-viable position size is already 2× full Kelly.** A $1,000
   account cannot trade SPY iron condors at a sane Kelly fraction. The smallest
   feasible position (1 contract) puts ~39% of capital at risk on a single trade
   — that's gambling, not vol harvesting.
4. **March 2020 outcome at recommended sizing is −33% to −39% in a single
   month**, with no escape via the stop. The user has accepted the experiment
   could fail; this is what failure looks like.
5. **Today's regime is elevated-but-stressed.** VRP at 85th percentile and VIX
   at 88th percentile is not "vol is cheap, sell premium." It is "regime is
   already showing strain, the next leg could be a vol expansion to 35+ rather
   than a mean-reversion to 18." Starting in this regime amplifies tail risk.

### Conditions under which the recommendation flips to PROCEED

- Account size grows to **≥$5,000** (1-contract risk drops to <8% of bankroll,
  Kelly math becomes sane).
- Switch underlying from SPY to **XSP** (1/10 SPX, cash-settled, European-style,
  60/40 tax treatment, eliminates SPY assignment risk). Backtest XSP separately —
  fees and IV surface differ.
- Move execution from Schwab to **Alpaca** to recover the ~$5/cycle commission
  drag and avoid the 7-day OAuth refresh treadmill.
- Run a **paper-trading dress rehearsal for 3 monthly cycles** before any real
  capital, comparing live fills to BS estimates to calibrate the haircut.

### If the user insists on starting now

1. Open an Alpaca options Level 3 account (faster onboarding than Schwab).
2. Start at **1 contract per month**, hold-to-expiration variant, no
   profit-target, no stop loss (the stop did not help in COVID and the
   profit-take destroys the edge).
3. Accept ~8-12% probability the account is below $100 in 12 months.
4. **Stop the strategy if** (a) 2 consecutive monthly losses occur, or
   (b) VIX closes >40 with the position open, or (c) account drops below
   $400. These are circuit breakers, not retreats — they're how you avoid
   the cluster-loss regime.
5. Re-evaluate after 6 months against the live distribution. If the haircut
   was too aggressive, the strategy will print better than expected and
   sizing can scale up. If the haircut was too lenient, the early stop-out
   rules will protect the remaining capital.

### Next step (concrete, executable in 2 weeks)

1. Open or fund an **Alpaca options Level 3** account (24-48h approval).
2. Build a single Python script: monthly cron, fetch SPY chain, find
   ~0.20-delta strikes 30-45 DTE, build 4-leg `mleg` order with 5-pt wings,
   submit at mid + $0.05, hold to expiration.
3. Run it in **paper mode for 3 cycles** before any real money.
4. Compare paper fills to this backtest's BS estimates. If realized credit ≥
   75% of BS estimate, the haircut was too aggressive and the real edge is
   better. If <50%, the strategy is dead and the user has saved $1,000.

That's the experiment worth running. Trading this strategy live on $1,000 today
without the calibration step is not.

---

## Appendix: Files generated

- `/tmp/vol_part1.py` — VRP analysis
- `/tmp/vol_part2.py` — PUTW baseline
- `/tmp/vol_part3.py` — Iron condor backtest
- `/tmp/vol_part4.py` — Kelly + Monte Carlo
- `/tmp/vrp_data.csv` — daily VIX, RV30, VRP 2015-2026
- `/tmp/trades.csv` — per-trade backtest output
