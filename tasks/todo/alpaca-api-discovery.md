# Alpaca Paper API Discovery

Research date: 2026-04-07. Scope: verify Alpaca paper trading + options API surface before scaffolding a NestJS module for monthly SPY iron condors.

## Summary

- **Multi-leg iron condor order: SUPPORTED** (4 legs in one atomic order via `order_class: "mleg"`, launched Feb 25, 2025; auto-enabled on all paper accounts).
- **Options chain with Greeks: SUPPORTED** (fields `greeks.delta`, `greeks.gamma`, `greeks.theta`, `greeks.vega`, `greeks.rho`, plus `impliedVolatility`, on `GET /v1beta1/options/snapshots/{underlying}`). Note: **Greeks are NOT returned for 0DTE contracts** because Black-Scholes requires T > 0. This is fine for monthly condors (we open ~45 DTE) but would bite a 0DTE strategy.
- **Free paper account access: YES**. Paper accounts start with virtual $100k and auto-receive Level 3 options approval. The free `indicative` options data feed is available without a paid market-data subscription; `opra` requires the paid plan.
- **Recommended Node.js path: ROLL OUR OWN thin REST wrapper**. `@alpacahq/alpaca-trade-api` (the official JS SDK) was last pushed 2025-01-16 and has **no mleg-aware helpers or types** (its `order.post()` just passes an object through to `POST /v2/orders`). It *works* but gives us no type safety and no option-specific helpers, so we get zero value from the dependency versus a typed fetch wrapper.
- **Decision: PROCEED with build.** All critical assumptions from `vol-harvesting-discovery.md` are confirmed. No blockers.

## 1. Endpoints and auth

- **Paper base URL:** `https://paper-api.alpaca.markets`
- **Live base URL:** `https://api.alpaca.markets` (kill switch must refuse anything pointed here)
- **Market data base URL:** `https://data.alpaca.markets`
- **Auth headers (REST):** two headers on every request:
  - `APCA-API-KEY-ID: <key>`
  - `APCA-API-SECRET-KEY: <secret>`
  - OAuth 2.0 Bearer tokens also exist but are for broker-partner / third-party integrations; for a self-owned paper account the header pair is the correct path.
- **Rate limits:** 200 req/min per account on the free tier (both trading and data). A `429 Too Many Requests` is returned on breach. Paid market-data plan raises trading to ~1000 req/min. For a once-per-minute observer this is a non-issue.
- **How to get paper keys:** log in at <https://app.alpaca.markets/paper/dashboard/overview> -> right sidebar "Your API Keys" -> click "Generate New Key" (or "View" for existing). The generated `Key ID` and `Secret Key` are only shown once; secret must be stored immediately. Paper and live keys are distinct - they cannot be swapped across environments.
- **Sample curl (account ping):**
  ```bash
  curl -s https://paper-api.alpaca.markets/v2/account \
    -H "APCA-API-KEY-ID: $ALPACA_PAPER_KEY_ID" \
    -H "APCA-API-SECRET-KEY: $ALPACA_PAPER_SECRET"
  ```
- **Live verification attempted:** hitting `GET https://data.alpaca.markets/v1beta1/options/snapshots/SPY` unauthenticated returns `401 Authorization Required` (confirmed via curl during this research). Every endpoint we need requires the key pair; there is no public read path.

## 2. Options chain

- **Endpoint (per-underlying chain, what we actually want):**
  ```
  GET https://data.alpaca.markets/v1beta1/options/snapshots/{underlying_symbol}
  ```
  e.g. `.../options/snapshots/SPY`.
- **Alternative (lookup by explicit symbol list):**
  ```
  GET https://data.alpaca.markets/v1beta1/options/snapshots?symbols=SPY250620P00560000,SPY250620P00555000,...
  ```
- **Query parameters:**
  | param | type | notes |
  | --- | --- | --- |
  | `feed` | `opra` \| `indicative` | `indicative` is free/delayed; `opra` requires the paid plan. Default is `opra`. |
  | `type` | `call` \| `put` | filter |
  | `strike_price_gte` / `strike_price_lte` | double | strike window |
  | `expiration_date` | `YYYY-MM-DD` | exact expiry |
  | `expiration_date_gte` / `expiration_date_lte` | `YYYY-MM-DD` | expiry window - use this to grab ~45 DTE |
  | `root_symbol` | string | SPY |
  | `updated_since` | RFC-3339 | incremental polling |
  | `limit` | int 1-1000 (default 100) | applies to total data points, not per-symbol |
  | `page_token` | string | pagination; next token returned in `next_page_token` |
- **Sample request (find ~45 DTE put strikes around the money on SPY):**
  ```bash
  curl -s -G https://data.alpaca.markets/v1beta1/options/snapshots/SPY \
    -H "APCA-API-KEY-ID: $ALPACA_PAPER_KEY_ID" \
    -H "APCA-API-SECRET-KEY: $ALPACA_PAPER_SECRET" \
    --data-urlencode "feed=indicative" \
    --data-urlencode "type=put" \
    --data-urlencode "expiration_date=2026-05-16" \
    --data-urlencode "strike_price_gte=500" \
    --data-urlencode "strike_price_lte=560" \
    --data-urlencode "limit=200"
  ```
- **Sample response (real, captured from Alpaca community forum thread; truncated to one contract):**
  ```json
  {
    "snapshots": {
      "SPY240723P00553000": {
        "greeks": {
          "delta": -0.4039,
          "gamma": 0.079,
          "rho": -0.0062,
          "theta": -0.917,
          "vega": 0.1123
        },
        "impliedVolatility": 0.1691,
        "latestQuote": {
          "ap": 1.43,
          "as": 73,
          "ax": "N",
          "bp": 1.42,
          "bs": 210,
          "bx": "I",
          "c": " ",
          "t": "2024-07-22T17:16:04.289345792Z"
        },
        "latestTrade": {
          "c": "I",
          "p": 1.43,
          "s": 5,
          "t": "2024-07-22T17:16:04.183603456Z",
          "x": "A"
        }
      }
    },
    "next_page_token": null
  }
  ```
- **Field map (use these exact names in our DTOs):**
  - Greeks: `greeks.delta`, `greeks.gamma`, `greeks.theta`, `greeks.vega`, `greeks.rho`
  - IV: `impliedVolatility` (camelCase; not `implied_volatility`)
  - Quote: `latestQuote.ap` (ask price), `as` (ask size), `ax` (ask exchange), `bp` (bid price), `bs` (bid size), `bx` (bid exchange), `c` (conditions), `t` (RFC-3339 timestamp)
  - Trade: `latestTrade.p` (price), `s` (size), `t` (time), `x` (exchange), `c` (conditions)
- **Greeks included: YES**, except for 0DTE where the `greeks` and `impliedVolatility` fields are simply absent from the snapshot object because Black-Scholes blows up at T=0. For our ~45 DTE monthly condor this is fine.
- **Occupancy Symbol format (OCC 21-char):** `SPY250620P00560000` = SPY, 2025-06-20, Put, strike 560.000 (strike * 1000, zero-padded to 8 digits). Alpaca uses this exactly.
- **Subscription tier required:**
  - `indicative` feed: FREE, included with paper accounts. Delayed, not OPRA-official, but sufficient for an observer/paper backtest.
  - `opra` feed: requires the paid Algo Trader Plus plan (~$9/mo for basic, $99/mo for full). We do NOT need this for Phase 1.

## 3. Multi-leg order placement (THE CRITICAL ONE)

**Verdict: confirmed supported.** 4-leg atomic iron condor as a single POST is the supported path. Published by Alpaca on 2025-02-25 ("Multi-Leg (Level 3) Options Trading Now Available") and auto-enabled on all paper accounts.

- **Endpoint:** `POST https://paper-api.alpaca.markets/v2/orders`
- **Order class field name:** `order_class` = `"mleg"`
- **Max legs:** 4 (exactly matches iron condor)
- **Legs array element shape:**
  ```
  {
    symbol: string          // OCC 21-char option symbol
    ratio_qty: string|int   // relative ratio; GCD across all legs must equal 1
    side: "buy" | "sell"
    position_intent: "buy_to_open" | "sell_to_open" | "buy_to_close" | "sell_to_close"
  }
  ```
- **Order-level fields:**
  - `order_class`: `"mleg"`
  - `qty`: total number of spreads (string). With `ratio_qty=1` on each leg, `qty=1` buys one condor.
  - `type`: `"limit"` (strongly recommended for condors; `"market"` is accepted but dangerous on wide-spread option legs)
  - `limit_price`: signed string; **negative** for a net credit (iron condor is sold for a credit), **positive** for a net debit. Represented as a string e.g. `"-1.80"`.
  - `time_in_force`: `"day"` or `"gtc"`. Day is safest for the open; use `"day"` unless we explicitly want to leave a closing combo working overnight.
- **Sample request body for a 1-lot SPY iron condor (short put spread 540/535, short call spread 580/585, collected $1.80 credit, day TIF):**
  ```json
  {
    "order_class": "mleg",
    "qty": "1",
    "type": "limit",
    "limit_price": "-1.80",
    "time_in_force": "day",
    "legs": [
      {
        "symbol": "SPY250620P00535000",
        "ratio_qty": "1",
        "side": "buy",
        "position_intent": "buy_to_open"
      },
      {
        "symbol": "SPY250620P00540000",
        "ratio_qty": "1",
        "side": "sell",
        "position_intent": "sell_to_open"
      },
      {
        "symbol": "SPY250620C00580000",
        "ratio_qty": "1",
        "side": "sell",
        "position_intent": "sell_to_open"
      },
      {
        "symbol": "SPY250620C00585000",
        "ratio_qty": "1",
        "side": "buy",
        "position_intent": "buy_to_open"
      }
    ]
  }
  ```
- **Reference examples:**
  - Alpaca Docs, "Options Level 3 Trading": <https://docs.alpaca.markets/docs/options-level-3-trading>
  - Changelog "Multi-leg (Level 3) Options Trading in Paper": <https://docs.alpaca.markets/changelog/multi-leg-level-3-options-trading-in-paper>
  - Blog (2025-02-25): <https://alpaca.markets/blog/level-3-options-trading-now-available-with-alpacas-trading-api/>
  - Python reference notebook: <https://github.com/alpacahq/alpaca-py/blob/master/examples/options/options-iron-condor.ipynb>
  - Alpaca learn "Iron Condor": <https://alpaca.markets/learn/iron-condor>
- **Response / tracking the trade:**
  - POST returns a standard `Order` object with an `id` (parent order id) and `legs` array containing child orders, each with its own `id`, `symbol`, `status`, `filled_qty`, `filled_avg_price`.
  - Subsequent `GET /v2/orders` / `GET /v2/orders/{id}` calls support `?nested=true` to roll child legs under the parent's `legs` field. For mleg retrieval, always pass `nested=true` or we lose visibility into leg fills.
  - Cancelling the parent (`DELETE /v2/orders/{parent_id}`) cancels all unfilled legs atomically.
- **Constraints worth remembering:**
  - GCD of all `ratio_qty` must equal 1 (simplest form).
  - Mleg cannot mix equities with options.
  - Time-in-force limited to `day` or `gtc` for mleg; no `opg` / `cls`.
  - No extended-hours execution for options.

## 4. Position management

- **List all positions:** `GET /v2/positions`. Returns an array. No server-side filter by asset class, so we filter client-side on `asset_class === "us_option"`. Each position includes `symbol`, `qty` (signed; short legs are negative), `avg_entry_price`, `market_value`, `cost_basis`, `unrealized_pl`, `unrealized_plpc`, `current_price`, `lastday_price`, `change_today`.
- **Get single position:** `GET /v2/positions/{symbol_or_asset_id}` (symbol must be the OCC option symbol).
- **Mark-to-market:** Alpaca updates `market_value`, `current_price`, and `unrealized_pl` on the position object in near real time, so we do NOT need to re-mark from the chain. Useful - saves us an extra data call on every observer tick. `current_price` on options is typically the OPRA last trade, which can be stale; for a more accurate mark we'd compute mid from the chain snapshot bid/ask.
- **Close a position:**
  - `DELETE /v2/positions/{symbol}` closes a *single* leg by firing a market order. **Do NOT use this for closing a condor** - you'd close each leg independently and lose atomicity.
  - `DELETE /v2/positions?cancel_orders=true` closes ALL positions and cancels ALL working orders. Useful for kill switch, not for a surgical close.
  - **Correct close pattern for a condor:** submit a new `mleg` order with the same 4 legs but opposite `side` values and `position_intent` of `*_to_close` instead of `*_to_open`, at a limit price that represents the debit we're willing to pay to close (e.g. `+0.30` to buy back a condor opened for `-1.80` = $150 profit per spread).
- **Expiration handling:**
  - Alpaca auto-processes option expiry. OTM contracts expire worthless and are removed from positions; ITM contracts are auto-exercised/assigned by OCC rules, producing a stock position in the underlying (SPY becomes long/short shares equal to 100x contracts). For SPY cash-settled **does not apply** - SPY is equity-settled, so assignment produces shares. (Note: SPX would be cash-settled, but Alpaca doesn't support index options as of this report.)
  - **Practical implication for iron condor risk management:** if we let an iron condor go into expiration with the underlying between the short strikes, everything expires worthless and we keep the credit. If SPY pins between the short and long strike on either side, the short is assigned and we're left with a directional SPY stock position equal to 100 shares per contract that we have to unwind the next morning (pin risk). Mitigation: **close the condor before expiration** - the standard rule is close at 21 DTE or at 50% of max profit, whichever comes first.
- **Order lifecycle events we'll observe:**
  - Open: `new` -> `accepted` -> `pending_new` -> `accepted_for_bidding` -> `filled` (or `partially_filled` -> `filled`). For mleg, the parent transitions to `filled` only when all 4 legs fill.
  - Expires worthless: no events on expiry day; positions simply disappear from `/v2/positions` after the OCC settlement cycle. An `order` event with `event: "expired"` fires on each leg.
  - Assignment: `event: "assigned"` fires on the short leg, producing a new `fill` event against SPY equity position. Subscribe via the trade updates WebSocket (`wss://paper-api.alpaca.markets/stream`) to get these in real time.

## 5. Account info

- **Endpoint:** `GET /v2/account`
- **Key fields:**
  - `cash` - current cash balance
  - `equity` - cash + long_market_value + short_market_value
  - `buying_power` - overall buying power (varies with account multiplier)
  - `options_buying_power` - **use this for sizing condor max loss** (cash-secured on paper)
  - `regt_buying_power`, `daytrading_buying_power`
  - `options_approved_level` and `options_trading_level` - these two fields tell us the approval level (should be `3` on any paper account post-Feb 2025)
  - `status` - should be `ACTIVE`
  - `account_number`, `id`
- **Paper-vs-live discriminator:** Alpaca does NOT return an explicit `is_paper` boolean on the account object. The ONLY safe runtime check is **the base URL the request went to**. Our kill switch must therefore enforce at the HTTP client layer that the base URL equals `https://paper-api.alpaca.markets` exactly, and fail closed otherwise. Belt-and-suspenders: paper and live keys are different - a paper key against live returns 403, so a boot-time self-test hitting `/v2/account` and asserting the URL-to-key binding is worthwhile.
- **Starting bankroll:** paper accounts start with $100,000 virtual cash. You can reset or change the balance via the dashboard ("Reset" button on the paper account page). Use this as the test bankroll; no code change needed.

## 6. Options approval

- **Paper Level 3 auto-granted: YES**, since the Feb 25, 2025 launch. The changelog "Multi-leg (Level 3) Options Trading in Paper" (<https://docs.alpaca.markets/changelog/multi-leg-level-3-options-trading-in-paper>) and the launch blog both state: "All paper trading accounts will automatically have access to Level 3 strategies."
- **Approval flow (not needed for paper, noted for later):** for live accounts, users must upgrade options level in the dashboard under Account Settings -> Options Trading and answer a suitability questionnaire. Live Level 3 requires passing the KYC + options suitability questions (experience, net worth, income, investment objective "speculation"). Not relevant for Phase 1.
- **Runtime sanity check:** at boot, `GET /v2/account` and assert `options_approved_level >= 3 && options_trading_level >= 3`. Refuse to run otherwise.

## 7. Node.js SDK

- **Official SDK:** `@alpacahq/alpaca-trade-api` on npm. Repo: <https://github.com/alpacahq/alpaca-trade-api-js>. Last pushed 2025-01-16 (verified via `gh api`). Not archived, but maintenance is sporadic and it predates the mleg launch.
- **Multi-leg support in SDK:** **Implicit only.** The `createOrder` / `post` method in `lib/resources/order.js` is a thin passthrough:
  ```js
  function post(order) {
    return this.sendRequest("/orders", null, order, "POST");
  }
  ```
  It will accept `{order_class: "mleg", legs: [...]}` and forward it to the REST endpoint, and the server will handle it. But:
  - No TypeScript types for `legs`, `ratio_qty`, `position_intent`, or `order_class: "mleg"`.
  - No helper for building iron-condor orders.
  - No handling of `nested=true` on order retrieval.
  - No grep hits for `mleg` or `legs` in the codebase.
  - So the SDK gives us zero value over `fetch` for the one thing we care about.
- **Python reference:** `alpaca-py` (<https://github.com/alpacahq/alpaca-py>) is the well-maintained, mleg-aware SDK. Use its example notebook (<https://github.com/alpacahq/alpaca-py/blob/master/examples/options/options-iron-condor.ipynb>) as the canonical reference for field names and ordering. The Python `OptionLegRequest` class corresponds 1:1 to the JSON legs shape documented above.
- **Recommendation: roll our own thin REST client.** Same pattern as the Kalshi module. Reasons:
  1. Node SDK is stale and untyped for mleg.
  2. We want strict TypeScript DTOs (we got burned by Kalshi field-name mismatches; same discipline applies here).
  3. The REST surface we need is small: `/v2/account`, `/v2/positions` (+ optional `/v2/positions/{symbol}`), `/v2/orders` POST, `/v2/orders/{id}?nested=true`, `/v2/options/contracts`, `/v1beta1/options/snapshots/SPY`. That's 6 endpoints - a ~200 LOC module.
  4. A custom client lets us hard-code the paper base URL at the transport layer for the kill switch and do env-var gating with zero ambiguity.
  5. Rate limiting and retry (429 handling) is trivial to add with a token bucket.

## Surprises and gotchas

1. **0DTE snapshots have NO Greeks / IV.** Black-Scholes blows up at T=0 so Alpaca omits those fields entirely rather than returning zeros. Not a problem for monthly condors, but if we ever extend to 0DTE we'd need to compute our own. Code should treat `greeks` as optional and defensively skip contracts without it.
2. **`impliedVolatility` is camelCase**, but most other endpoints use snake_case. Easy trap for a DTO.
3. **Limit price sign for credit spreads is NEGATIVE.** A short iron condor is opened for a credit, which Alpaca expresses as `limit_price: "-1.80"`. Passing `"1.80"` would submit a debit order and almost certainly be rejected or misfill. This is the single most likely place for a field-mismatch bug.
4. **No explicit `is_paper` field on the account object.** Our kill switch MUST enforce the base URL at the HTTP client layer. A boot-time assertion that `options_approved_level === 3` is a reasonable proxy since live accounts require manual upgrade, but it is not a guarantee.
5. **SPY options are equity-settled, not cash-settled.** Expiring in the money on one wing leaves us with a long or short stock position. Always close iron condors before expiry (target: 21 DTE or 50% max profit).
6. **Default `feed` is `opra`, which costs money.** If we forget `feed=indicative`, a fresh paper account will get 403s on the chain endpoint until the user subscribes. Default to `indicative` in our client, with `opra` as opt-in config.
7. **`@alpacahq/alpaca-trade-api` does not know mleg exists.** Don't waste an afternoon wiring it up expecting helpers.
8. **Greeks data source:** Alpaca's Greeks are computed server-side (Black-Scholes-ish) with a risk-free rate they don't document precisely. They are "good enough" for strike selection but not research-grade. For production strategy decisions we should either (a) accept Alpaca's deltas as-is for paper, (b) compute our own with a pinned r and a pinned vol surface if we ever go to live.
9. **4-leg max.** We get no headroom - a calendarized iron condor (8 legs) would need to be broken into 2 separate combos and would no longer be atomic. Out of scope for Phase 1 but worth flagging.
10. **The POST /v2/orders docs and blog examples use `"AAPL250117P00190000"` style symbols.** Confirm we construct SPY symbols with the same format: `<ROOT><YY><MM><DD><P|C><strike*1000 zero-padded to 8>`.

## Recommended next step

Proceed to scaffold a NestJS `alpaca` module with a thin typed REST client (roll-our-own, Kalshi-style). Phase 1: implement and integration-test these six endpoints against the paper URL - `GET /v2/account`, `GET /v2/positions`, `GET /v2/orders/{id}?nested=true`, `POST /v2/orders` (as a **dry run / log-only first**), `GET /v1beta1/options/snapshots/SPY` (feed=indicative), `GET /v2/options/contracts`. Hard-code the base URL to `https://paper-api.alpaca.markets` in the HTTP client constructor and refuse to instantiate if the env var is set to anything else. Boot-time assertion: call `/v2/account` and verify `options_approved_level >= 3` and `status === "ACTIVE"`. Only after the dry-run observer has captured a full condor lifecycle in logs (open, mid-life MTM, close or expiration) do we flip `POST /v2/orders` from dry-run to real submission.
