# Alpaca Iron Condor Observer (Phase 1, Paper Trading)

## Goal

Build a NestJS module that mechanically paper-trades monthly SPY iron condors
via the Alpaca paper-trading API, on a virtual $5,000 bankroll. The module
mirrors the architecture of `kalshi-observer/` so we reuse patterns: SQLite
storage, scheduled sampling, read-only HTTP inspection endpoints, kill-switch
env flag, and a static safety-rails test.

The Phase 1 success criterion is **NOT** "make money on paper." It is:
**collect 3-6 cycles of real Alpaca fills and compare them to our
Black-Scholes-synthetic backtest predictions**, so we can calibrate the
credit-haircut assumption against reality before any real-money deployment.

## Strategy spec (locked from Step 0 discovery)

- **Underlying**: SPY (single underlying — no XSP yet, defer until real-money phase)
- **Structure**: short iron condor, 4 legs as one combo order
- **DTE at entry**: 30-45 days (target ~35)
- **Wing deltas**: short put ~0.20, short call ~0.20
- **Wing widths**: 5 points each side
- **Entry cadence**: monthly, on the first trading day of each calendar month
  AND only when current VIX is between 12 and 35 (avoid both vol-too-cheap and
  vol-blowup regimes)
- **Exit policy**: hold to expiration. The discovery showed the 50%-profit-take
  variant turns negative under realistic credit haircuts, so we explicitly do
  NOT use it.
- **Hard stop**: close immediately if mark-to-market loss exceeds 2× the credit
  received on entry. (Tail-event circuit breaker — losing 2× credit is the
  signal that the trade is going to max loss.)
- **Sizing**: 1 contract per cycle on the virtual $5k account. Conservative.
  Re-evaluate at end of paper phase based on observed P&L distribution.

## Non-goals (deferred to later phases)

- No live (real-money) trading. Paper only.
- No XSP (mini-SPX). SPY only for Phase 1 simplicity.
- No multi-cycle laddering. One position open at a time.
- No 0DTE. Period.
- No profit-target exit. Hold to expiration.
- No automatic rolling. If a position is at risk we close it; we don't roll.
- No machine learning regime filter. The VIX 12-35 gate is the only filter.
- No Schwab. Alpaca only — Schwab's 7-day OAuth refresh treadmill is
  operationally hostile to autonomous bots and we don't need it.

## Architecture

New NestJS module: `src/alpaca-observer/`

```
src/alpaca-observer/
├── alpaca-observer.module.ts
├── alpaca-observer.controller.ts          # read-only inspection endpoints
├── safety-rails.spec.ts                   # static no-live-trading guard
├── clients/
│   ├── alpaca.client.ts                   # Alpaca paper API wrapper
│   ├── alpaca.client.spec.ts
│   ├── market-data.client.ts              # yfinance/VIX for signal layer
│   └── market-data.client.spec.ts
├── services/
│   ├── signal.service.ts                  # VRP regime + entry decision
│   ├── signal.service.spec.ts
│   ├── chain-selector.service.ts          # pick 0.20-delta strikes from chain
│   ├── chain-selector.service.spec.ts
│   ├── execution.service.ts               # place / mark / close iron condor
│   ├── execution.service.spec.ts
│   ├── sampling.service.ts                # @Interval cron loop
│   ├── sampling.service.spec.ts
│   └── reporting.service.ts               # query layer for HTTP endpoints
├── storage/
│   ├── alpaca-observer.repository.ts      # SQLite schema + queries
│   └── alpaca-observer.repository.spec.ts
└── dto/
    └── reports.dto.ts
```

## Data model

- **`condor_position`**: id, opened_at, expiration_date, status (`open`,
  `closed`, `expired`, `errored`), short_put_strike, long_put_strike,
  short_call_strike, long_call_strike, credit_received, max_loss, alpaca_order_id
- **`condor_leg`**: position_id, side, strike, expiration, contract_symbol,
  fill_price, fill_qty, alpaca_leg_id
- **`mark_to_market`**: position_id, sampled_at, spy_spot, vix, mid_value,
  unrealized_pnl
- **`signal_sample`**: sampled_at, spy_spot, vix, rv30, vrp, regime
  (`favorable`, `vol_too_low`, `vol_too_high`), entry_eligible (bool)
- **`entry_decision`**: cycle_month, decided_at, decision (`open`, `skip`),
  reason, position_id (nullable)
- **`account_snapshot`**: sampled_at, cash, equity, buying_power, open_positions
- **`closed_position_pnl`**: position_id, closed_at, exit_reason
  (`expired_in_box`, `expired_with_breach`, `stop_loss`), realized_pnl,
  realized_pnl_pct

## Implementation plan

### Step 0 — Alpaca API verification (DONE 2026-04-07)

Full report at `tasks/todo/alpaca-api-discovery.md`. Critical findings:

**API surface confirmed**:
- Paper base URL: `https://paper-api.alpaca.markets`
- Live base URL: `https://api.alpaca.markets` (kill-switch must refuse)
- Data URL: `https://data.alpaca.markets`
- Auth: `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers
- Rate limit: 200 req/min free tier
- Multi-leg iron condor: SUPPORTED via `order_class: "mleg"` with `legs[]` array
- Options chain with Greeks: SUPPORTED via `/v1beta1/options/snapshots/{underlying}`
- Free `indicative` market data feed works for paper; paid `opra` needed for live

**Field-name traps to avoid (these are the kind that bit us with Kalshi)**:
1. **Greeks fields are camelCase**: `impliedVolatility`, not `implied_volatility`. Most other Alpaca fields are snake_case. Easy to mismatch.
2. **Credit spreads use NEGATIVE `limit_price`**: an iron condor sold for $1.80 credit is submitted as `limit_price: "-1.80"` (string, with minus sign). This is the highest-risk gotcha.
3. **0DTE options have no Greeks** (Black-Scholes degeneracy at T=0). We're 30-45 DTE so this won't bite us, but the code should treat `greeks` as optional anyway.
4. **No paper/live discriminator field in `/account` response**. The kill switch MUST enforce paper-vs-live at the base URL level in the HTTP client constructor — there is no runtime check we can do later.
5. **SPY is equity-settled**, not cash-settled. Always close condors at least 1 day before expiration to avoid pin-risk assignment to 100 shares of SPY (which we couldn't afford on a $5k account).

**SDK decision**: `@alpacahq/alpaca-trade-api` is the official Node SDK but its last commit is 2025-01-16 and it has ZERO multi-leg awareness (grepping for `mleg` / `legs` returns nothing). It would just passthrough an opaque object to a generic POST. We get no type safety. **Roll our own thin REST wrapper, same as Kalshi.** ~6 endpoints, ~200 LOC.

**Build approach**: dry-run mode from day one. The `ExecutionService` should support a `dryRun: true` flag that logs orders to the database WITHOUT submitting them to Alpaca. We flip to live submission only after we've verified the full condor lifecycle in dry-run.

### Step 1 — Module scaffolding & clients
- [ ] Create `alpaca-observer` module wired into `app.module.ts`
- [ ] `alpaca.client.ts`: REST wrapper around Alpaca paper API. Hard
      assertion at construction time that the base URL is the paper endpoint.
- [ ] `market-data.client.ts`: VIX + SPY history (reuse yfinance approach
      from backtest, or use Alpaca's market data endpoints if simpler)
- [ ] Unit tests with mocked HTTP

### Step 2 — Signal service + chain selector
- [ ] `signal.service.ts`: compute current VRP, decide if regime is favorable
      for entry. Returns `{eligible, reason, vrp, vix, rv}`.
- [ ] `chain-selector.service.ts`: given a target DTE and target delta, walk
      the option chain and pick the appropriate strikes. Handle edge cases
      where exact 0.20 delta isn't available (snap to nearest).
- [ ] Tests against captured fixture chains

### Step 3 — Execution service
- [ ] `execution.service.ts`:
  - `openCondor(strikes, expiration)` — places the 4-leg combo order
  - `markPosition(positionId)` — pulls current chain, computes mid value,
    persists `mark_to_market` row
  - `closePosition(positionId, reason)` — places closing combo order
  - `expireSweep()` — at end of day, finalize any positions that expired
    today
- [ ] All Alpaca writes go through this single service so the safety-rails
      test can grep for the boundary
- [ ] Tests with mocked Alpaca client

### Step 4 — Sampling loop
- [ ] `sampling.service.ts` with `@Interval` ticks:
  - **Hourly during market hours** — sample signal, persist `signal_sample`
  - **Hourly during market hours** — mark all open positions to market
  - **Daily at market open** — entry decision (open new condor if it's
    cycle-start day AND signal is eligible AND no position currently open)
  - **Daily at market close** — expire sweep, persist closed_position_pnl
  - **Daily at market open** — account snapshot
- [ ] Each tick guarded against overlap and gated by env flag

### Step 5 — Reporting service + endpoints
- [ ] `reporting.service.ts` query methods
- [ ] HTTP endpoints under `/alpaca-observer`:
  - `GET /health`
  - `GET /summary` — bankroll, open positions, lifetime P&L, win rate
  - `GET /positions` — open + closed positions with full leg details
  - `GET /signals?since=` — recent signal samples
  - `GET /decisions?since=` — entry-decision audit log
- [ ] Swagger annotations

### Step 6 — Safety rails
- [ ] `safety-rails.spec.ts`: static test that greps the module for any live
      Alpaca endpoints, hardcoded real-money API URLs, or order construction
      outside `execution.service.ts`
- [ ] Boot-time banner identical in shape to kalshi-observer (PAPER ONLY,
      kill switch state, account ID, etc.)
- [ ] `ALPACA_OBSERVER_ENABLED` env flag, default `false` (opposite of kalshi
      observer because this module places actual orders, even in paper mode)
- [ ] Boot assertion: `ALPACA_BASE_URL` MUST contain `paper-api` or the module
      refuses to start

### Step 7 — First live paper cycle
- [ ] User generates Alpaca paper API keys, sets env vars
- [ ] Manual smoke test: hit `/alpaca-observer/health`, then trigger one
      forced entry decision via a debug endpoint or by waiting for the next
      cycle
- [ ] Verify the 4-leg combo order actually placed and is visible in the
      Alpaca paper dashboard
- [ ] Verify mark-to-market is computing reasonable values
- [ ] Verify the position closes correctly at expiration

## Decision gate after 3-6 cycles

Success criteria for "advance to live $5k":
1. Realized P&L distribution from paper roughly matches backtest predictions
   (within 1σ on both mean and stdev)
2. The Alpaca fill prices are not catastrophically worse than the
   BS-synthetic theoreticals (slippage <30% of credit on average)
3. No operational issues — the cron loop ran without manual intervention,
   orders placed cleanly, no failed mark-to-market days
4. At least one cycle saw a vol move (>20% intraday VIX spike) and the stop
   loss either fired correctly or the strategy correctly held through it

If any of these fail → **WAIT longer** and collect more data, OR pivot.

If all pass → user funds Alpaca live with $5k, we set `ALPACA_BASE_URL` to
the live endpoint, run with same code path. The level 3 options approval
is needed at this point.

## Open questions to confirm before Step 0

1. **API key timing**: user can generate Alpaca paper keys in ~5 min. Should
   we wait for keys before any code, or scaffold first and add keys at Step 7?
   → Recommend: scaffold first, keys at Step 7. Lets us move in parallel.

2. **First entry timing**: today is 2026-04-07. April monthlies expire Apr 17
   (10 DTE, too short). May monthlies expire May 15 (38 DTE, perfect). The
   first paper trade would be entered on or around the May cycle start
   (~April 15-20). If we want to start collecting data sooner, we could
   accept a slightly-shorter-DTE April trade as a one-off "warm-up cycle" —
   the discovery agent's backtest used 30-45 DTE so 10 DTE is too far out
   of spec.
   → Recommend: wait for proper May cycle. Use the 1-2 week build window
   to get the module shipped.

3. **Storage path**: Kalshi observer uses `data/kalshi-observer.sqlite`.
   This module would use `data/alpaca-observer.sqlite` (separate file, same
   pattern). OK?

4. **Position reconciliation**: do we trust our DB or trust Alpaca's
   positions endpoint as source of truth? If we restart the bot mid-cycle,
   we need to reload open positions from Alpaca and resume tracking.
   → Recommend: Alpaca is the source of truth for open positions. On boot,
   reload any open positions from Alpaca into our DB before resuming the
   cron loop.

5. **Single-broker risk**: if Alpaca's paper API has an outage during a
   critical day (e.g. expiration), we miss the close. This is fine for
   paper trading (we can manually reconcile), but worth noting for the
   eventual live phase.

## Review / results

_(filled in after Phase 1 paper-trading completes — actual P&L
distribution, calibration vs backtest, recommendation on live deployment)_
