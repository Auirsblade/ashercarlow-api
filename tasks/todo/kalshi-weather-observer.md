# Kalshi Weather Observer (Phase 1)

## Goal

Build a read-only observer that ingests **Kalshi daily weather markets** (high temp, low temp, snow, wind, precip — whichever are live) and **authoritative weather data** (METAR/TAF, NWS official observations and forecasts), detects discrepancies between the market price and what the weather data implies, and logs hypothetical PnL as if a paper bankroll had traded on it. **No real orders placed in this phase.**

The thesis: Kalshi weather markets resolve on official NWS observations at known stations, which closely track METAR data published by the same airport ASOS sensors. The naive arbitrage (current temp already past threshold) is almost certainly arb'd away in liquid major-city markets, but edge may persist in (a) less-trafficked cities, (b) overnight low markets, (c) snow / wind / precip markets, (d) repricing latency around new METAR or TAF releases. Phase 1 is a 2-week paper experiment to find out where, if anywhere, the edge actually lives.

If Phase 1 shows real, repeatable paper edge → Phase 2 wires in actual trading. If it doesn't → we abandon weather and move to a generalized Kalshi market scanner that watches multiple categories empirically.

## Success criteria

- [ ] Observer runs continuously and never places an order (no trading code path exists)
- [ ] For every tracked Kalshi weather market: persist airport/region, metric, threshold, op, resolves_at, current YES/NO mid + bid/ask + size, sampled every N minutes
- [ ] For every mapped weather station: persist METAR + TAF samples
- [ ] Discrepancy records persisted with: market-implied probability, weather-implied probability, edge, would_trade flag, simulated fill, reasoning
- [ ] Simulator maintains $1000 paper bankroll, opens hypothetical positions on detected edges, closes on resolution, records realized PnL
- [ ] After 2 weeks: report broken down by market category (high temp / low temp / snow / wind / precip), city, and time-of-day. Answers: "Where is the edge actually positive?"

## Non-goals (Phase 2 territory)

- No wallet, no signing for trade endpoints, no order placement
- No UI beyond read-only JSON inspection endpoints
- No ML — v0 logic is rule-based
- No WebSocket — REST polling only in Phase 1 (Kalshi WS requires RSA-PSS signing even for public-ish channels; defer the complexity until we know the edge exists)

## Data sources (verified live)

### Kalshi
- REST base: `https://api.elections.kalshi.com/trade-api/v2`
- **Reads require no auth** (verified): `/markets`, `/events`, `/series`, `/markets/{ticker}/orderbook`
- Weather series live as of research (2026-04-07): need to enumerate in Step 0. Pattern: tags include `Weather`. Likely series tickers along the lines of `KXHIGH*`, `KXLOW*`, `KXSNOW*`, `KXHURRICANE*`, etc.
- **Critical**: each series' resolution source is in the contract certification PDF, not in the API. Kalshi flight markets resolved on **FlightAware**, not FAA — so we cannot assume Kalshi weather markets resolve on METAR. They likely resolve on **NWS official daily climate reports** for a specific station, which may differ from METAR sensor readings at the same airport (NWS may use coop observers, may apply rounding/quality control, may publish at different cadences). Step 0 must read each weather series' contract terms PDF and document the exact resolution source.
- Rate limit (Basic tier): 20 reads/sec. We are nowhere near that.
- Auth credentials (already in env): `KALSHI_KEY_ID`, `KALSHI_PRIVATE_KEY`. Not needed for Phase 1 reads but will be loaded with a hard assertion that no trading scope is exercised.

### Weather data
- **METAR/TAF**: `https://aviationweather.gov/api/data/metar` and `/api/data/taf`. JSON, no auth, free. Poll every ~5 min for tracked stations.
- **NWS API**: `https://api.weather.gov` — official forecasts, hourly observations, daily climate reports. No auth, attribution required. This may be the actual resolution source for many Kalshi weather markets.
- **NWS LCD (Local Climatological Data)**: daily summaries with official high/low. Probably the resolution source for high/low temp markets.
- **FAA NAS Status** (`https://nasstatus.faa.gov/api/airport-events`): bonus signal for snow/extreme weather markets — if the FAA has issued a deicing program or weather GDP at an airport, that's strong correlated evidence of severe conditions.

## Architecture

New NestJS module: `src/kalshi-observer/`. Built with venue + market-type as pluggable interfaces so a future generalized scanner (Option 2 from the discussion) can reuse the same plumbing.

```
src/kalshi-observer/
  kalshi-observer.module.ts
  kalshi-observer.controller.ts        # read-only inspection endpoints
  clients/
    kalshi.client.ts                   # REST reads, RSA-PSS signing helper for future use
    metar.client.ts                    # aviationweather.gov METAR + TAF
    nws.client.ts                      # api.weather.gov forecasts + observations + LCD
    faa-nas-status.client.ts           # bonus signal for severe weather
  services/
    market-scanner.service.ts          # finds + curates Kalshi weather markets
    station-mapper.service.ts          # market -> NWS station / METAR ICAO
    weather-signal.service.ts          # current + forecast weather -> implied probability
    discrepancy.service.ts             # market price vs weather signal
    simulator.service.ts               # paper bankroll, hypothetical fills, PnL
    resolution-tracker.service.ts      # records real outcomes, closes positions
  storage/
    observer.repository.ts             # SQLite via better-sqlite3
  config/
    curated-markets.json               # hand-picked tickers for Phase 1
    station-map.json                   # market region -> NWS station + METAR ICAO
  dto/
    *.dto.ts
```

## Data model

- **`kalshi_market`**: ticker, event_ticker, series_ticker, title, category (`high_temp`/`low_temp`/`snow`/`wind`/`precip`), region, threshold, op, resolves_at, resolution_source_text, mapped_nws_station, mapped_metar_icao, mapping_confidence, status
- **`kalshi_price_sample`**: ticker, sampled_at, yes_mid, yes_bid, yes_ask, yes_bid_size, yes_ask_size, last_trade_price, volume_24h
- **`metar_sample`**: icao, observed_at, temp_c, dewpoint_c, wind_kt, gust_kt, vis_sm, ceiling_ft, wx_phenomena, raw
- **`nws_sample`**: station_id, sampled_at, observation_type (`current`/`forecast`/`lcd_daily`), temp_c, high_c, low_c, precip_in, snow_in, wind_kt, raw_json
- **`discrepancy`**: id, market_ticker, sampled_at, market_implied_p, weather_implied_p, edge, would_trade, simulated_side, simulated_size_usd, simulated_fill_price, reasoning
- **`simulated_position`**: id, market_ticker, opened_at, side, size_usd, entry_price, closed_at, resolution_outcome, realized_pnl_usd

Storage: SQLite via `better-sqlite3`. Simplest thing that works.

## Implementation plan

### Step 0 — discovery (research subagent, before any code)
- [ ] Enumerate all currently-live Kalshi weather series and events. Filter `/series?tags=Weather` (or whatever the actual tag is) and `/markets` for keywords (`temperature`, `high`, `low`, `snow`, `rain`, `wind`).
- [ ] For each weather series found: fetch the contract certification PDF from the series metadata (`series.contract_url`) and **document the exact resolution source** — name of source agency, station/location, exact metric definition, expiration timing, position limit.
- [ ] Identify which series have markets currently open (with non-trivial liquidity) vs which are dormant.
- [ ] Build the initial `curated-markets.json` and `station-map.json` from this research.
- [ ] Save findings to `tasks/todo/kalshi-weather-discovery.md`.
- [ ] **Decision point**: if fewer than 5 weather markets are currently live with meaningful liquidity, stop and reconsider scope before writing code.

### Step 1 — scaffolding & clients
- [ ] Create `kalshi-observer` NestJS module, wire into `app.module.ts`
- [ ] Add `better-sqlite3` dependency
- [ ] `kalshi.client.ts`: REST wrapper for `/markets`, `/events`, `/series`, `/markets/{ticker}/orderbook`. RSA-PSS signing helper (for future use), but Phase 1 only calls unauthenticated read endpoints. Hard assertion that no trade-scope endpoints are exercised. Reads `KALSHI_KEY_ID` and `KALSHI_PRIVATE_KEY` from env but does not require them for read calls.
- [ ] `metar.client.ts`: METAR + TAF fetcher
- [ ] `nws.client.ts`: NWS forecasts, current observations, LCD daily climate
- [ ] `faa-nas-status.client.ts`: airport-events JSON (bonus signal)
- [ ] Unit tests for each client with captured fixtures

### Step 2 — market curation & station mapping
- [ ] `market-scanner.service.ts`: periodically refresh the list of live weather markets, persist `kalshi_market` rows
- [ ] `station-mapper.service.ts`: map each market to its NWS station + closest METAR ICAO. **Confidence flag** when the resolution source is NWS (not METAR) so we know there's measurement-divergence risk.
- [ ] Manually verify mappings for the curated initial set

### Step 3 — sampling loop
- [ ] NestJS `@Cron` / `@Interval` scheduler:
  - Kalshi orderbook + market metadata: every 60s for tracked markets
  - METAR: every 5 min for tracked stations
  - NWS observations + forecasts: every 10 min
  - NWS LCD daily climate: once per hour late in the day, then more aggressively near market close
- [ ] Each cycle persists samples and runs discrepancy checks

### Step 4 — weather signal → implied probability (v0)
- [ ] `weather-signal.service.ts`:
  - **High-temp market** ("Will high at KJFK ≥ 75°F today?"):
    - If current METAR/NWS already shows ≥ threshold: `p = 1.0`
    - If day is over and never reached: `p = 0.0`
    - If pending: use NWS forecast high. If forecast ≥ threshold by ≥ 3°F margin → `p = 0.85`. Within ±3°F → `p = 0.50`. Below by ≥ 3°F → `p = 0.15`. (Tune empirically.)
  - **Low-temp market**: same logic, inverted
  - **Snow market**: NWS QPF + winter weather advisories; FAA deicing program at the airport is a strong corroborating signal
  - **Wind / precip markets**: similar simple rules driven by current obs + forecast
- [ ] Document every threshold as named config, not magic numbers
- [ ] **Critical guard**: if the resolution source is NWS LCD and our latest LCD reading is stale by > 1 hour near market close, flag and skip — we don't want to trade against the source we can't see

### Step 5 — discrepancy detection
- [ ] `discrepancy.service.ts`:
  - For each (market, sample): `edge = weather_implied_p - market_yes_mid`
  - Open a paper position when `abs(edge) > 0.15` AND orderbook has ≥ $200 size within 2¢ of mid AND we don't already have a position in this market
  - Persist a `discrepancy` row whether or not we open a position
  - Reasoning field captures the *why* in plain text — invaluable for post-mortem auditing

### Step 6 — simulator
- [ ] `simulator.service.ts`: $1000 paper bankroll, fixed-fraction sizing (5% per bet), assume we cross the spread (fill at ask when buying YES, bid when selling)
- [ ] Track open positions; close at resolution

### Step 7 — resolution tracking
- [ ] `resolution-tracker.service.ts`: poll Kalshi for resolved markets (status transitions to `settled`/`finalized`), record outcome, close paper positions, compute realized PnL
- [ ] **Mapping-error tracking**: for each closed position, also fetch the official resolution source (NWS LCD) and compare to what our weather signal said. Record when our signal disagreed with reality — this is the dataset we need to know if Phase 2 is viable.

### Step 8 — reporting
- [ ] `GET /kalshi-observer/summary` — bankroll, open positions, weekly PnL, win rate by category and city
- [ ] `GET /kalshi-observer/discrepancies?since=...` — recent discrepancies with reasoning
- [ ] `GET /kalshi-observer/markets` — currently tracked markets + mapping confidence
- [ ] `GET /kalshi-observer/positions` — open + closed simulated positions
- [ ] Add to Swagger

### Step 9 — safety rails
- [ ] Boot-time assertion: if the Kalshi key is loaded, log a warning that it's loaded read-only and is never used for trade endpoints
- [ ] No code path in this module constructs an order — and there is no `POST /portfolio/orders` call site to grep
- [ ] Rate-limit external APIs, log every external request

## Key measurements Phase 1 must produce

1. **Paper PnL per week**, broken down by market category and city
2. **Win rate** of "would_trade=true" detections
3. **Mapping-error rate**: how often our weather signal disagreed with the actual resolution
4. **Time-of-day edge profile**: when during the day does the edge actually appear vs disappear
5. **Liquidity-vs-edge tradeoff**: are the high-edge markets the illiquid ones (untradeable in practice)?

If after 2 weeks paper PnL is positive AND win rate > 55% AND mapping errors are rare AND there's enough liquidity to actually deploy capital → Phase 2. Otherwise → abandon weather, pivot to generalized Kalshi market scanner that watches multiple categories empirically.

## Open questions to confirm before coding

1. **Step 0 first?** I want to run the discovery subagent to enumerate live Kalshi weather markets and read their resolution source PDFs before scaffolding, so we don't build against assumed APIs. OK?
2. **SQLite via `better-sqlite3`** confirmed?
3. **Same Dokploy deployment** as the existing NestJS app, with `@Cron`-driven sampling. OK?
4. **$1000 paper bankroll, 5% per bet, edge threshold 15%** — same starting config as before. OK?
5. **Defer WebSocket entirely from Phase 1** since REST polling at 60s is plenty for daily-resolving markets. OK?

## Review / results

_(to be filled in after Phase 1 completes — paper PnL, win rate, where the edge lives, mapping-error rate, recommendation on Phase 2 vs generalized scanner pivot)_
