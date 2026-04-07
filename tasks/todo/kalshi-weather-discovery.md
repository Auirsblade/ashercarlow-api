# Kalshi Weather Market Discovery

Date of research: 2026-04-07
All API calls and PDF fetches were performed live against
`https://api.elections.kalshi.com/trade-api/v2` and
`https://kalshi-public-docs.s3.us-east-1.amazonaws.com/regulatory/product-certifications/`
with no authentication.

## Summary

- Total Kalshi series in category `Climate and Weather`: **264**
- Filtered weather series probed: **78** (covering all major US cities for high/low/rain/snow plus several legacy duplicates)
- Series with at least one live (`status=open`) event today/tomorrow: **42**
- Series that exist but are dormant (no open events): **14** of those probed (almost all are seasonal: snow markets in April, plus a few legacy short-prefix duplicates that have been migrated to the `KX*` namespace)
- Categories with live markets right now: **high temperature, low temperature, daily rain (binary), monthly rain (multi-bucket), hourly directional NYC temp**. **Snow is dormant** (out of season — last live snow events were Mar 2026 for the Apr roll).
- **Wind, hurricane, and tornado markets are seasonal/event-driven** and were not probed in depth — wind has no daily series, hurricane series only list during hurricane season (Jun–Nov), and there is no live "wind speed" daily market.
- Liquidity observation: daily high-temp markets in NYC, LAX, Chicago, Miami, Boston have **5-figure 24h volume per bucket** and tight spreads (1–3 cents). Low-temp markets have ~10x less volume but are still tradeable. Hourly NYC temp (`KXTEMPNYCH`) is essentially zero volume. Monthly rain has decent depth.
- **Recommendation: PROCEED.** Phase 1 should target the daily NWS-CLI temperature contracts in the top 5–10 cities and the daily/monthly NYC rain contracts. There are >5 markets with meaningful liquidity and clean, NWS-sourced resolution that can be cross-checked against well-known stations.

## Important early findings

1. **Resolution source is uniformly NWS Daily Climate Report (CLI product)**, not METAR. Every temperature/rain PDF and every market `rules_primary` field consistently names "National Weather Service's Daily Climate Report" or "Climatological Report (Daily)" as the binding source. This is published once per day per WFO/station via the NWS NWWS feed and the `forecast.weather.gov/product.php?product=CLI` URL pattern. **It is NOT METAR.** METAR will be a useful real-time leading indicator, but the official resolution is a CLI product released the next morning.
2. **Station identity matters and varies by city**:
   - NYC = **Central Park (KNYC)** for both temperature and rain
   - Chicago = **Chicago Midway (KMDW)** — explicitly NOT O'Hare
   - LA = **Los Angeles Airport (KLAX)**
   - Miami = **Miami International Airport (KMIA)**
   - Other cities (DC, Boston, Dallas, Houston, Phoenix, Seattle, Austin, Atlanta, Denver, Philadelphia, Vegas, OKC, NOLA, SATX, Minneapolis, SFO) use the GLOBALTEMPERATURE generic certification, which delegates to "the designated official or primary station" of the NWS — in practice, the airport ASOS / WFO CLI used by NWS, but the per-market `rules_primary` field is the binding clarifier.
3. **There is a hidden "AccuWeather hourly" trap.** `KXTEMPNYCH` (hourly NYC temp) resolves on **AccuWeather** at coordinates `40.7812,-73.9665`, NOT NWS, despite being in the weather category. Volume is essentially zero so we should ignore it for Phase 1, but we must avoid the assumption "all temperature markets resolve on NWS."
4. **Position limit is $25,000 USD per Member, per strike** (per LAHIGH and GLOBALTEMPERATURE certifications; older NHIGH/CHIHIGH certs say $25,000 USD on the contract). For Phase 1 (read-only) this is informational.
5. **Daily expiration cadence**: Last Trading Time = 11:59 PM local-ish (varies by certification — most newer ones use 11:59 PM ET, LAHIGH says 11:59 PM PT). Expiration Time = 10:00 AM ET on the day after the statistical date, with early close as soon as the NWS CLI report is published (the API exposes both `expected_expiration_time` and `latest_expiration_time` to capture this). Daily-temp markets typically settle the next morning around 7–9 AM local time, after the WFO publishes the daily CLI.

## Live weather series (filtered list of confirmed-live, non-snow)

All the following had `>=1` open event when probed:

| Series ticker | Title | Frequency | Live events | Contract PDF |
|---|---|---|---|---|
| KXHIGHNY | Highest temperature in NYC | daily | 2 | NHIGH.pdf |
| KXHIGHLAX | Highest temperature in Los Angeles | daily | 2 | LAXHIGH.pdf |
| KXHIGHCHI | Highest temperature in Chicago | daily | 2 | CHIHIGH.pdf |
| KXHIGHMIA | Highest temperature in Miami | daily | 2 | MIAHIGH.pdf |
| KXHIGHPHIL | Highest temperature in Philadelphia | daily | 2 | PHILHIGH.pdf |
| KXHIGHDEN | Highest temperature in Denver | daily | 2 | DENHIGH.pdf |
| KXHIGHAUS | Highest temperature in Austin | daily | 2 | AUSHIGH.pdf |
| KXHIGHTDC | Daily High Temperature DC | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTBOS | Daily High Temperature Boston | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTDAL | Daily High Temperature Dallas | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTHOU | Daily High Temperature Houston | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTPHX | Daily High Temperature Phoenix | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTSFO | Daily High Temperature SFO | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTSEA | Daily High Temperature Seattle | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTATL | Daily High Temperature Atlanta | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTMIN | Daily High Temperature Minneapolis | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTSATX | Daily High Temperature SATX | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTNOLA | Daily High Temperature NOLA | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTOKC | Daily High Temperature OKC | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXHIGHTLV | Daily High Temperature Vegas | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTNYC | Lowest temperature in NYC | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTBOS | Lowest temperature Boston | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTDC | Lowest temperature DC | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTDAL | Lowest temperature Dallas | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTSFO | Lowest temperature SFO | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTLAX | Lowest temperature LA | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTPHX | Lowest temperature Phoenix | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTMIA | Lowest temperature Miami | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTSEA | Lowest temperature Seattle | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTCHI | Lowest temperature Chicago | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTPHIL | Lowest temperature Philadelphia | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTATL | Lowest temperature Atlanta | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTMIN | Lowest temperature Minneapolis | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTOKC | Lowest temperature OKC | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTSATX | Lowest temperature SATX | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTNOLA | Lowest temperature NOLA | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTLV | Lowest temperature Vegas | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTDEN | Lowest temperature Denver | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXLOWTAUS | Lowest temperature Austin | daily | 2 | GLOBALTEMPERATURE.pdf |
| KXRAINNYC | Will it rain in NYC today? | daily | 2 | RAINNYC.pdf |
| KXRAINNYCM | Monthly rain in NYC | monthly | 1 | RAINNYCM.pdf |
| KXRAINMIAM | Monthly rain in Miami | custom | 1 | RAINM.pdf |
| KXRAINCHIM | Monthly rain in Chicago | monthly | 1 | RAINM.pdf |
| KXRAINLAXM | Monthly rain in LA | custom | 1 | RAINM.pdf |
| KXRAINHOUM | Monthly rain in Houston | custom | 1 | RAINM.pdf |
| KXRAINDALM | Monthly rain in Dallas | custom | 1 | RAINM.pdf |
| KXRAINDENM | Monthly rain in Denver | monthly | 1 | RAINM.pdf |
| KXRAINSFOM | Monthly rain in SFO | custom | 1 | RAINM.pdf |
| KXRAINSEAM | Monthly rain in Seattle | custom | 1 | RAINM.pdf |
| KXRAINAUSM | Monthly rain in Austin | custom | 1 | RAINM.pdf |
| KXTEMPNYCH | Hourly NYC temperature (AccuWeather) | hourly | 1 | NHIGHD.pdf |

## Dormant or seasonal series (probed, returned 0 open events)

These are mostly seasonal weather phenomena out of season, plus some legacy duplicate tickers
that have migrated to a newer KX namespace.

| Ticker | Reason |
|---|---|
| KXSNOWNY, KXSNOWNYM, KXSNOWNYC, KXSNOWCHIM, KXNYCSNOWM, KXBOSSNOWM, KXCHISNOWM, KXDCSNOWM, KXPHILSNOWM, KXDENSNOWM | All snow markets — out of season in April |
| KXHIGHNYD, KXHIGHHOU, KXHIGHTEMPDEN, KXLOWNY, KXLOWNYC, KXLOWLAX, KXLOWMIA, KXLOWPHIL, KXLOWDEN, KXLOWAUS, KXLOWCHI | Legacy duplicate tickers superseded by `KXHIGHT*`/`KXLOWT*` |
| KXRAINSEA | Superseded by KXRAINSEAM (monthly) |
| KXHIGHUS, KXHIGHAUS (US-wide), KXMINNYC, KXMAXTEMP100, KXTEMPNYCH (sometimes), KXHEATWARNING, KXCITIESWEATHER | Aggregate / annual / event-driven, no current cycle live |

Wind, hurricane, tornado, flood, FEMA, eruption, earthquake series exist (`KXHURCAT`, `KXHURNYC`,
`KXHURMIA`, `KXTORNADO`, `KXTROPSTORM`, ...) but were not probed for live events because (a)
they are seasonal (hurricane season Jun–Nov), (b) they resolve on NHC / USGS rather than NWS CLI
and would need separate data plumbing, and (c) they are out of scope for the weather-divergence
observer in Phase 1.

## Live markets by category (with orderbook snapshots)

The market objects below were captured at ~14:00 UTC on 2026-04-07. Volume / OI are in
contracts. Prices are decimal dollars (Yes ask / Yes bid).

### High temperature

**KXHIGHNY-26APR07** (NYC, NWS CLI Central Park) — 6 buckets, total volume 123,128, total OI 77,440.
- B52.5 (52–53°): ya 0.68 / yb 0.67, vol 22,880, OI 14,157 (heavy)
- B54.5 (54–55°): ya 0.32 / yb 0.30, vol 16,316, OI 8,834
- T55 (>=56°): ya 0.02 / yb 0.01, vol 15,380, OI 8,560
- `rules_primary`: "If the highest temperature recorded in Central Park, New York for April 07, 2026 as reported by the National Weather Service's Climatological Report (Daily), is between 52-53°, then the market resolves to Yes."

**KXHIGHLAX-26APR07** — 6 buckets, total volume 160,084, total OI 112,695. Highest-volume series in the sample.
- T73 (>=74°): ya 0.38 / yb 0.37, vol 81,748, OI 57,098 (extremely heavy)
- `rules_primary`: "If the highest temperature recorded in Los Angeles Airport, CA for April 07, 2026 as reported by the National Weather Service's Climatological Report (Daily), is less than 66°, then the market resolves to Yes." (LAX = airport, not downtown)

**KXHIGHCHI-26APR07** — 6 buckets, total volume 70,430, total OI 46,029.
- B38.5 (38–39°): ya 0.35 / yb 0.34, vol 10,363, OI 7,556
- T45 (>=46°): ya 0.01 / yb 0.00, vol 14,608, OI 8,564
- `rules_primary`: "If the highest temperature recorded at Chicago Midway, IL for April 07, 2026, is between 44-45° according to the National Weather Service's Climatological Report (Daily), then the market resolves to Yes." (Chicago = Midway, NOT O'Hare)

**KXHIGHMIA-26APR07** — 6 buckets, total volume 96,619, total OI 54,047.
- T81 (>=82°): ya 0.61 / yb 0.55, vol 37,888, OI 13,564
- `rules_primary`: "...recorded at Miami International Airport for April 07, 2026..."

**KXHIGHTBOS-26APR07** — 6 buckets, total volume 42,089, total OI 27,443.
- T46 (<=45°): ya 0.44 / yb 0.43, vol 13,962, OI 7,414
- `rules_primary`: "If the maximum temperature recorded at Boston for Apr 7, 2026, is between 52-53° fahrenheit according to the National Weather Service's Climatological Report (Daily), ..."

**KXHIGHTDC-26APR07** — 6 buckets, total volume 26,647, total OI 17,928.
**KXHIGHTDAL-26APR07** — 6 buckets, total volume 20,499, total OI 15,164.

### Low temperature

**KXLOWTNYC-26APR07** — 6 buckets, total volume 8,396, total OI 5,625. Less liquid than highs.
- B32.5 (32–33°): ya 0.25 / yb 0.24, vol 1,139, OI 804
- `rules_primary`: "If the minimum temperature recorded at New York City for Apr 7, 2026, is between 32-33° fahrenheit according to the National Weather Service's Climatological Report (Daily), ..."
  Note: the per-market text just says "New York City" without naming Central Park explicitly, but it falls under GLOBALTEMPERATURE which delegates to the NWS-designated primary station — that is `KNYC` (Central Park).

### Rain (binary daily)

**KXRAINNYC-26APR07** — 1 bucket (yes/no), volume 34,125, OI 33,532, currently trading at ya 1.00 / yb 0.99 (it has rained today already).
- `rules_primary`: "If the number of inches of precipitation recorded at Central Park, New York on April 07, 2026 is strictly greater than 0, then the market resolves to Yes."
- Threshold: `> 0.00 in` (any trace of measurable rain at KNYC).

### Rain (monthly multi-bucket)

**KXRAINNYCM-26APR** — 4 buckets (>1, >2, >3, >4 in for the whole month), total volume 24,297, OI 14,975.
- "Above 1 inches": ya 0.89 / yb 0.88, vol 5,905
- "Above 3 inches": ya 0.20 / yb 0.15, vol 5,239
- "Above 4 inches": ya 0.09 / yb 0.06, vol 7,041
- `rules_primary`: "If the total precipitation at Central Park, New York City in Apr 2026 is strictly greater than 3 inches, then the market resolves to Yes."

Other monthly rain markets (KXRAINMIAM, KXRAINSFOM, KXRAINAUSM, KXRAINCHIM, KXRAINLAXM,
KXRAINHOUM, KXRAINDALM, KXRAINDENM, KXRAINSEAM) all use RAINM.pdf and follow the same pattern
at the corresponding NWS CLI primary station for each city.

### Hourly NYC temperature (AccuWeather — DO NOT USE)

**KXTEMPNYCH-26APR0713** — 15 buckets, total volume 89, total OI 85. Effectively dead.
- `rules_primary`: "If the temperature recorded in Central Park, New York for Apr 7, 2026 1 PM EDT as reported by **Accuweather** (for coordinates 40.7812,-73.9665), is above 54.99°, then the market resolves to Yes."
- This is the only weather series we found that does NOT resolve on NWS. Skip it.

## Resolution sources (verbatim from contract PDFs)

### NHIGH.pdf — NYC daily high
> **Underlying:** "The Underlying for this Contract is the maximum temperature recorded for the specified <date> published in the National Weather Service's ("NWS") Daily Climate Report for Central Park, New York which can be accessed here: https://w2.weather.gov/climate/getclimate.php?date=&wfo=okx&sid=NYC&pil=CLI&recent=yes&specdate=2021-05-19+20%3A38%3A22 ... Specifically, it is in the section labeled 'Temperature' and 'Yesterday' in a column titled 'Observed Value' and row titled 'Maximum'. Temperatures are reported in degrees Fahrenheit."
>
> **Source Agency:** "The Source Agency is the National Weather Service ('NWS')."
>
> **Position Limit:** "The Position Limit for the $1 referred Contract shall be $25,000 per Member."
>
> **Expiration time:** "the Expiration time of the Contract shall be 10:00am ET."

NWS WFO = `OKX` (NWS New York). Product = CLI (Climatological Report Daily). Station ID in
the WFO climate URL = `NYC` (i.e. KNYC = Central Park). Rounding: NWS CLI reports whole
degrees Fahrenheit; rounding to whole F is implicit in the data source.

### CHIHIGH.pdf — Chicago daily high
> **Underlying:** "The Underlying for this Contract is the maximum temperature recorded for the specified <date> published in the National Weather Service's ('NWS') Daily Climate Report for Chicago Midway, Illinois which can be accessed here: https://w2.weather.gov/climate/index.php?wfo=lot, selecting Chicago Midway under 'Location' and then clicking 'go'."
>
> **Source Agency:** "The Source Agency is the National Weather Service ('NWS')."
>
> **Position Limit:** "$25,000 per Member."
>
> **Expiration time:** "10:00am ET."

NWS WFO = `LOT` (NWS Chicago). Station ID in the WFO climate URL = `MDW` (Chicago Midway,
KMDW). **NOT KORD.** This is the single biggest divergence trap in the curated set —
KMDW is ~12 miles SE of KORD and runs ~1–3°F warmer than KORD on most spring/summer days.

### LAXHIGH.pdf (LAHIGH rulebook) — Los Angeles daily high
> **Underlying:** "The Underlying for this Contract is the maximum temperature recorded for the specified <date> published in the National Weather Service's ('NWS') Daily Climate Report for Los Angeles Airport, CA. Revisions to the Underlying made after Expiration will not be accounted for in determining the Expiration Value."
>
> **Instructions:** "The Daily Climate Report for Los Angeles Airport, CA can be accessed here." Footnote URL: `https://forecast.weather.gov/product.php?site=LOX&product=CLI&issuedby=FHM`
>
> **Source Agency:** "The Source Agency is the National Weather Service ('NWS')."
>
> **Position Accountability Level:** "$25,000 per strike, per Member."
>
> **Expiration time:** "10:00 AM ET."

NWS WFO = `LOX` (NWS Los Angeles/Oxnard). Product = `CLI`. Issuing site = `FHM` (this is
the NWS CLI product code for Los Angeles International Airport). Station = KLAX.

### GLOBALTEMPERATURE.pdf — generic temperature (covers KXHIGHT*, KXLOWT*, KXHIGHTDC, KXHIGHTBOS etc.)
> **Underlying:** "The Underlying for this Contract is the <maximum/minimum/average> temperature in <area> in <time period>. Revisions to the Underlying made after Expiration will not be accounted for in determining the Expiration Value."
>
> **Source Agency:** "The Source Agencies are, in hierarchical order, National Weather Service, the national weather service for <area> (e.g. Australian Bureau of Meteorology, the Met Office, etc.)."
>
> **<area>:** "Unless otherwise stated, <area> will be defined by the data received from the primary official weather measurement station(s) for that location as designated by the National Weather Service, or as otherwise specified by the Exchange."
>
> Additional clarifications:
> - "If multiple weather stations exist within <area>, the Exchange may specify the station in question. Where not specified, the designated 'official' or 'primary' station for that location as determined by the Source Agencies shall be used."
> - "Only the first official non-preliminary report published by the Source Agencies that includes the relevant data will be used for resolution. Revisions after the Expiration Date are not included in the Payout Criterion."
> - "Contract resolution is based on the full precision reported by the Source Agency. Rounding by media outlets, secondary reporting, or third-party summaries does not affect resolution."
>
> **Position Accountability Level:** "$25,000 per strike, per Member."
>
> **Expiration time:** "10:00 AM ET."

This is the binding language for ~36 of the ~52 live temperature series. It does NOT name a
specific station — the per-market `rules_primary` field is what we trust for the city name,
and we then have to map city → NWS designated primary station ourselves. For US cities, the
NWS designated primary station is the airport ASOS that the local WFO uses to publish its
daily CLI product (verified via `forecast.weather.gov/product.php?site=<wfo>&product=CLI`).

### RAINNYC.pdf — NYC daily rain
> **Underlying:** "The Underlying for this Contract is the number of inches of precipitation recorded for the specified <date> published in the National Weather Service's ('NWS') Daily Climate Report for Central Park, New York City, New York. Data that is revised past the Expiration Date and Expiration time of the contract will not be used to determine the Expiration Value of the Contract."
>
> **Instructions:** "Please navigate to https://www.weather.gov/wrh/Climate?wfo=okx, select the tab of 'Observed Weather', selecting 'Central Park NY'. ... Specifically, it is in the section labeled 'Precipitation' in a column titled 'Observed Value' and row titled 'Yesterday'. Precipitation is reported in inches."
>
> **Source Agency:** "The Source Agency is the National Weather Service."
>
> **Position Limit:** "$25,000 per Member."
>
> **Expiration time:** "10:00am ET."

KNYC, NWS OKX, CLI product, "Precipitation > Yesterday > Observed Value" cell.

### MIAHIGH / DENHIGH / PHILHIGH / AUSHIGH (per-city legacy certs)

These older per-city certifications were not all read in full but follow the exact same
template as NHIGH/CHIHIGH: NWS Daily Climate Report at the named city's primary
airport ASOS. The market `rules_primary` text confirms this (e.g. "Miami International
Airport", "Philadelphia"). Source Agency in all cases = NWS. Position limit $25,000 per
Member.

### NHIGHD.pdf — KXTEMPNYCH (hourly directional NYC temp)

The PDF was downloaded but not read in full; based on the market `rules_primary` field, the
binding source is **AccuWeather at coordinates 40.7812,-73.9665** (which is in Central Park
near the Met). This is a non-NWS source and the only series we should NOT include in the
NWS-cross-check observer.

### RAINNYCM.pdf / RAINM.pdf — Monthly rain certifications

Not read in full. Per the per-market `rules_primary` text, monthly rain markets resolve on
"the total precipitation at <city primary station> in <month>" using NWS CLI cumulative
precipitation. Phase 1 should treat them as (sum of NWS CLI daily precip for the month at
the same station as the daily rain market for that city).

## Divergence risk analysis

For each city in the curated set, the question is: how close is the resolution station to
the readily-available METAR/NWS API observation we plan to query, and what is the realistic
worst-case divergence?

| City | Resolution station (Kalshi) | METAR ICAO we'd query | Same physical station? | Divergence risk for daily max/min |
|---|---|---|---|---|
| NYC | NWS CLI Central Park (KNYC) | KNYC | Yes (KNYC ASOS in Central Park) | Low. Same instrument feeds both METAR and CLI. Risk is mostly QC corrections on the published CLI vs the raw 24h max from METAR (~1°F). |
| LA | NWS CLI Los Angeles Airport (KLAX) | KLAX | Yes | Low. METAR-based max == CLI max almost always. |
| Chicago | NWS CLI Chicago Midway (KMDW) | **KMDW (NOT KORD)** | Yes if we map correctly | Low if mapped to KMDW. **High if mistakenly mapped to KORD** — KMDW averages 1–3°F warmer than KORD, especially in summer. This is the single most important mapping fact in the whole report. |
| Miami | NWS CLI Miami International (KMIA) | KMIA | Yes | Low |
| Boston | GLOBALTEMPERATURE → NWS primary "Boston" | KBOS | Yes (KBOS ASOS is the NWS primary for Boston) | Low |
| DC | GLOBALTEMPERATURE → NWS primary "Washington DC" | KDCA (Reagan National) | Most likely yes — WFO LWX uses KDCA for the DC CLI | Low–Medium. Need to confirm via the actual CLI product URL on first run. KIAD (Dulles) is a different number entirely. |
| Dallas | GLOBALTEMPERATURE → NWS primary "Dallas" | KDFW | Yes (DFW WFO uses KDFW for DAL CLI) | Low |
| Houston | GLOBALTEMPERATURE → NWS primary "Houston" | KIAH | Yes (Houston WFO uses Bush Intercontinental KIAH for HOU CLI) | Low–Medium. KHOU (Hobby) is a separate station and runs slightly warmer in winter. |
| Phoenix | GLOBALTEMPERATURE → NWS primary "Phoenix" | KPHX | Yes | Low |
| SFO | GLOBALTEMPERATURE → NWS primary "San Francisco" | KSFO | Yes (NWS Bay Area uses KSFO for SF CLI) | Low–Medium. Microclimate near the bay can deviate from downtown. |
| Seattle | GLOBALTEMPERATURE → NWS primary "Seattle" | KSEA | Yes | Low |
| Atlanta | GLOBALTEMPERATURE → NWS primary "Atlanta" | KATL | Yes | Low |
| Denver | DENHIGH → NWS CLI Denver | KDEN | Yes | Low |
| Philadelphia | PHILHIGH → NWS CLI Philadelphia | KPHL | Yes | Low |
| Austin | AUSHIGH → NWS CLI Austin | KAUS (Bergstrom) | Yes | Low |
| Vegas | GLOBALTEMPERATURE → NWS primary "Las Vegas" | KLAS | Yes | Low |
| Minneapolis | GLOBALTEMPERATURE → NWS primary "Minneapolis" | KMSP | Yes | Low |
| OKC | GLOBALTEMPERATURE → NWS primary "Oklahoma City" | KOKC | Yes | Low |
| SATX | GLOBALTEMPERATURE → NWS primary "San Antonio" | KSAT | Yes | Low |
| NOLA | GLOBALTEMPERATURE → NWS primary "New Orleans" | KMSY | Yes | Low |

Generic divergence taxonomy:

1. **Station mismatch** (Chicago Midway vs O'Hare; Houston Hobby vs IAH; DC Reagan vs Dulles). Catastrophic if mis-mapped — resolves on a different instrument. Mitigation: hard-code station per market in `curated-markets.json` and require manual approval to add new markets.
2. **METAR vs CLI rounding/QC**. METAR reports temperature in tenths of °C, converted to whole °F by NWS CLI. NWS may apply QC, throw out spurious peaks, etc. Expect routine ~1°F divergence. Phase 1 should treat any |delta| > 2°F between live METAR and our nowcast as "high confidence signal," not "free money."
3. **Timing**. METAR is hourly (with SPECI between), CLI is once per day (~7–9 AM local for previous day). For an "Apr 7" market that closes at 11:59 PM ET on Apr 7 and expires when CLI is published on Apr 8, we should sample METAR through ~23:00 local Apr 7, then watch CLI on Apr 8 morning.
4. **Last-hour spikes**. High temp can occur late afternoon, low temp can occur right before sunrise on either side of midnight. We must respect the local-time day boundary the NWS CLI uses (midnight–midnight local), not UTC.
5. **Monthly rain accumulation drift**. Monthly rain markets accumulate the daily CLI precip values. Over 30 days the rounding error is small but real.

## Proposed `src/kalshi-observer/config/curated-markets.json`

The market tickers below correspond to the **today** event (`-26APR07`); in production we
will refresh the ticker daily by parsing the event from the series + date. The
`series_ticker` and `resolution_source` fields are stable and are what the observer should
key off.

```json
[
  {
    "market_ticker": "KXHIGHNY-26APR07-T55",
    "series_ticker": "KXHIGHNY",
    "category": "high_temp",
    "region": "nyc",
    "threshold": 55,
    "threshold_unit": "F",
    "op": ">",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "OKX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=OKX&issuedby=NYC&product=CLI",
      "station_name": "Central Park, New York",
      "station_id": "KNYC",
      "metric": "daily maximum temperature, NWS Daily Climate Report (CLI), Temperature/Yesterday/Observed Value/Maximum cell, whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KNYC",
    "mapping_confidence": "high",
    "mapping_notes": "KNYC ASOS in Central Park is the same physical instrument that feeds the NWS OKX CLI product. Routine ~1°F divergence due to QC and rounding."
  },
  {
    "market_ticker": "KXHIGHLAX-26APR07-T73",
    "series_ticker": "KXHIGHLAX",
    "category": "high_temp",
    "region": "lax",
    "threshold": 73,
    "threshold_unit": "F",
    "op": ">",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "LOX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=LOX&issuedby=FHM&product=CLI",
      "station_name": "Los Angeles Airport, CA",
      "station_id": "KLAX",
      "metric": "daily maximum temperature, NWS LOX Daily Climate Report (CLI), whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KLAX",
    "mapping_confidence": "high",
    "mapping_notes": "KLAX ASOS at Los Angeles International Airport. Highest-volume series in the sample (>160k 24h vol). Note: not downtown Los Angeles."
  },
  {
    "market_ticker": "KXHIGHCHI-26APR07-B44.5",
    "series_ticker": "KXHIGHCHI",
    "category": "high_temp",
    "region": "chi_midway",
    "threshold": [44, 45],
    "threshold_unit": "F",
    "op": "between",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "LOT",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=LOT&issuedby=MDW&product=CLI",
      "station_name": "Chicago Midway, Illinois",
      "station_id": "KMDW",
      "metric": "daily maximum temperature, NWS LOT Daily Climate Report (CLI) for Chicago Midway, whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KMDW",
    "mapping_confidence": "high",
    "mapping_notes": "CRITICAL: Chicago Midway (KMDW), NOT O'Hare (KORD). The two stations diverge by 1–3°F regularly. Hard-code KMDW and refuse to substitute KORD."
  },
  {
    "market_ticker": "KXHIGHMIA-26APR07-T81",
    "series_ticker": "KXHIGHMIA",
    "category": "high_temp",
    "region": "mia",
    "threshold": 81,
    "threshold_unit": "F",
    "op": ">",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "MFL",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=MFL&issuedby=MIA&product=CLI",
      "station_name": "Miami International Airport",
      "station_id": "KMIA",
      "metric": "daily maximum temperature, NWS MFL Daily Climate Report (CLI), whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KMIA",
    "mapping_confidence": "high",
    "mapping_notes": "KMIA ASOS at Miami International. Confirmed via per-market rules text."
  },
  {
    "market_ticker": "KXHIGHTBOS-26APR07-T46",
    "series_ticker": "KXHIGHTBOS",
    "category": "high_temp",
    "region": "bos",
    "threshold": 46,
    "threshold_unit": "F",
    "op": "<=",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "BOX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=BOX&issuedby=BOS&product=CLI",
      "station_name": "Boston",
      "station_id": "KBOS",
      "metric": "daily maximum temperature, NWS BOX Daily Climate Report (CLI), whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KBOS",
    "mapping_confidence": "high",
    "mapping_notes": "Per GLOBALTEMPERATURE.pdf, NWS BOX (Taunton) WFO publishes the Boston CLI from KBOS ASOS at Logan."
  },
  {
    "market_ticker": "KXHIGHTDC-26APR07-T59",
    "series_ticker": "KXHIGHTDC",
    "category": "high_temp",
    "region": "dca",
    "threshold": 59,
    "threshold_unit": "F",
    "op": ">",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "LWX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=LWX&issuedby=DCA&product=CLI",
      "station_name": "Washington DC (Reagan National)",
      "station_id": "KDCA",
      "metric": "daily maximum temperature, NWS LWX Daily Climate Report (CLI) for DCA, whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KDCA",
    "mapping_confidence": "medium",
    "mapping_notes": "GLOBALTEMPERATURE.pdf does not name DCA explicitly. NWS LWX (Sterling) publishes daily CLIs for KDCA, KIAD, and KBWI separately. KDCA is the historical 'Washington DC' station and is the assumed primary. Verify against the first published CLI on day one before going live."
  },
  {
    "market_ticker": "KXHIGHTDAL-26APR07-B73.5",
    "series_ticker": "KXHIGHTDAL",
    "category": "high_temp",
    "region": "dfw",
    "threshold": [73, 74],
    "threshold_unit": "F",
    "op": "between",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "FWD",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=FWD&issuedby=DFW&product=CLI",
      "station_name": "Dallas",
      "station_id": "KDFW",
      "metric": "daily maximum temperature, NWS FWD Daily Climate Report (CLI) for DFW, whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KDFW",
    "mapping_confidence": "high",
    "mapping_notes": "NWS Fort Worth WFO uses KDFW for the Dallas CLI."
  },
  {
    "market_ticker": "KXLOWTNYC-26APR07-T39",
    "series_ticker": "KXLOWTNYC",
    "category": "low_temp",
    "region": "nyc",
    "threshold": 39,
    "threshold_unit": "F",
    "op": ">",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "OKX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=OKX&issuedby=NYC&product=CLI",
      "station_name": "New York City (Central Park)",
      "station_id": "KNYC",
      "metric": "daily minimum temperature, NWS OKX Daily Climate Report (CLI), whole degrees Fahrenheit"
    },
    "mapped_metar_icao": "KNYC",
    "mapping_confidence": "high",
    "mapping_notes": "Per-market rules say 'New York City', GLOBALTEMPERATURE delegates to the NWS-designated primary, which for NYC is KNYC. Cross-check the published OKX CLI to confirm on day one."
  },
  {
    "market_ticker": "KXRAINNYC-26APR07-T0",
    "series_ticker": "KXRAINNYC",
    "category": "precip",
    "region": "nyc",
    "threshold": 0.0,
    "threshold_unit": "in",
    "op": ">",
    "resolves_at_utc": "2026-04-08T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "OKX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=OKX&issuedby=NYC&product=CLI",
      "station_name": "Central Park, New York City",
      "station_id": "KNYC",
      "metric": "daily total precipitation in inches, NWS OKX Daily Climate Report (CLI), Precipitation/Yesterday/Observed Value cell. 'Trace' (T) does NOT count as > 0; only measurable precipitation does."
    },
    "mapped_metar_icao": "KNYC",
    "mapping_confidence": "high",
    "mapping_notes": "Binary yes/no on any measurable precipitation at KNYC. Need to handle the 'T' (trace) edge case explicitly: per NWS convention, trace = > 0 but < 0.005 in, and Kalshi has historically resolved trace as NO (i.e. 0). Verify before going live."
  },
  {
    "market_ticker": "KXRAINNYCM-26APR-3",
    "series_ticker": "KXRAINNYCM",
    "category": "precip",
    "region": "nyc",
    "threshold": 3.0,
    "threshold_unit": "in",
    "op": ">",
    "resolves_at_utc": "2026-05-01T14:00:00Z",
    "resolution_source": {
      "agency": "NWS",
      "wfo": "OKX",
      "cli_product_url": "https://forecast.weather.gov/product.php?site=OKX&issuedby=NYC&product=CLI",
      "station_name": "Central Park, New York City",
      "station_id": "KNYC",
      "metric": "monthly total precipitation in inches, sum of NWS OKX Daily Climate Report (CLI) daily precip values for the calendar month"
    },
    "mapped_metar_icao": "KNYC",
    "mapping_confidence": "high",
    "mapping_notes": "Sum of daily KNYC CLI precip for April 2026. NWS also publishes a monthly CLM product that should agree with the sum and is the cleanest source for the resolution check."
  }
]
```

## Proposed `src/kalshi-observer/config/station-map.json`

```json
{
  "nyc": {
    "city": "New York City",
    "nws_wfo": "OKX",
    "nws_cli_site_id": "NYC",
    "primary_station": {
      "name": "Central Park",
      "icao": "KNYC",
      "lat": 40.7794,
      "lon": -73.9692,
      "elevation_m": 47
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=OKX&issuedby=NYC&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KNYC&format=json&hours=24",
    "divergence_notes": "Same instrument feeds METAR and CLI. Routine ~1°F divergence on max/min due to NWS QC and whole-F rounding. Trace precip is NOT counted as > 0 for daily rain markets."
  },
  "lax": {
    "city": "Los Angeles",
    "nws_wfo": "LOX",
    "nws_cli_site_id": "FHM",
    "primary_station": {
      "name": "Los Angeles International Airport",
      "icao": "KLAX",
      "lat": 33.9381,
      "lon": -118.3889,
      "elevation_m": 30
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=LOX&issuedby=FHM&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KLAX&format=json&hours=24",
    "divergence_notes": "Coastal station, much cooler than downtown LA. Do NOT substitute KCQT (downtown) or KBUR (Burbank). NWS LOX issues daily CLIs separately for KLAX, KCQT, KSAN, etc."
  },
  "chi_midway": {
    "city": "Chicago",
    "nws_wfo": "LOT",
    "nws_cli_site_id": "MDW",
    "primary_station": {
      "name": "Chicago Midway International Airport",
      "icao": "KMDW",
      "lat": 41.7861,
      "lon": -87.7522,
      "elevation_m": 188
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=LOT&issuedby=MDW&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KMDW&format=json&hours=24",
    "divergence_notes": "CRITICAL: Kalshi resolves Chicago on KMDW, not KORD. KMDW averages 1–3°F warmer than KORD. The observer must reject any code path that maps 'Chicago' to KORD."
  },
  "mia": {
    "city": "Miami",
    "nws_wfo": "MFL",
    "nws_cli_site_id": "MIA",
    "primary_station": {
      "name": "Miami International Airport",
      "icao": "KMIA",
      "lat": 25.7959,
      "lon": -80.2870,
      "elevation_m": 9
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=MFL&issuedby=MIA&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KMIA&format=json&hours=24",
    "divergence_notes": "KMIA ASOS at the airport. Different from KMFL (NWS office) and KOPF (Opa-Locka)."
  },
  "bos": {
    "city": "Boston",
    "nws_wfo": "BOX",
    "nws_cli_site_id": "BOS",
    "primary_station": {
      "name": "Boston Logan International Airport",
      "icao": "KBOS",
      "lat": 42.3656,
      "lon": -71.0096,
      "elevation_m": 6
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=BOX&issuedby=BOS&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KBOS&format=json&hours=24",
    "divergence_notes": "KBOS at Logan. Coastal — cooler than KBED (Hanscom inland) on summer afternoons."
  },
  "dca": {
    "city": "Washington DC",
    "nws_wfo": "LWX",
    "nws_cli_site_id": "DCA",
    "primary_station": {
      "name": "Ronald Reagan Washington National Airport",
      "icao": "KDCA",
      "lat": 38.8521,
      "lon": -77.0377,
      "elevation_m": 5
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=LWX&issuedby=DCA&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KDCA&format=json&hours=24",
    "divergence_notes": "Reagan National (KDCA) is the historical DC primary. KIAD (Dulles) is colder and runs ~3-5°F lower on min temps. Do NOT substitute KIAD."
  },
  "dfw": {
    "city": "Dallas",
    "nws_wfo": "FWD",
    "nws_cli_site_id": "DFW",
    "primary_station": {
      "name": "Dallas/Fort Worth International Airport",
      "icao": "KDFW",
      "lat": 32.8968,
      "lon": -97.0380,
      "elevation_m": 184
    },
    "cli_product_url": "https://forecast.weather.gov/product.php?site=FWD&issuedby=DFW&product=CLI",
    "metar_endpoint_hint": "https://aviationweather.gov/api/data/metar?ids=KDFW&format=json&hours=24",
    "divergence_notes": "KDFW is the standard Dallas station. KDAL (Love Field) is a separate station and runs slightly warmer."
  }
}
```

## Decision gate

- **Are there >= 5 live markets with meaningful liquidity? YES.** At minimum: KXHIGHNY, KXHIGHLAX, KXHIGHCHI, KXHIGHMIA, KXHIGHTBOS, KXHIGHTDC, KXHIGHTDAL, KXLOWTNYC, KXRAINNYC, KXRAINNYCM. The high-temp series carry 5-figure 24h volume per bucket and sub-3-cent spreads.
- **Recommendation for Phase 1 implementation: PROCEED.** This is qualitatively different from the dormant flight market situation — Kalshi weather markets are deeply liquid, list daily for every major US city, and have clean, well-documented NWS-sourced resolution.
- **Surprises and concerns that should change the plan:**
  1. **Resolution is on NWS CLI, not METAR.** The plan should treat METAR as a leading-indicator nowcast and treat NWS CLI as the ground truth. The observer should ingest both: METAR for live tracking, CLI for "did our prediction match the eventual settlement" calibration. Do NOT bet implied probabilities on METAR alone — there is a known ~1°F drift between METAR-derived max/min and the published CLI.
  2. **Chicago = KMDW, not KORD.** This is a foot-gun and must be hard-coded.
  3. **DC defaults to KDCA**, but GLOBALTEMPERATURE.pdf doesn't say so explicitly. We must verify on day one by reading the actual published CLI for `site=LWX&issuedby=DCA`. If we're wrong and it's KIAD, our mapping confidence drops to "low" for that market.
  4. **Houston is ambiguous between KIAH and KHOU.** Phase 1 should defer adding Houston until we read the first published CLI from `site=HGX` and confirm which station it points to.
  5. **`KXTEMPNYCH` resolves on AccuWeather, not NWS.** It's the only such series. Liquidity is zero, so we exclude it.
  6. **Trace precipitation handling.** `KXRAINNYC` says "strictly greater than 0". Per NWS convention, "T" (trace) is reported separately and is NOT > 0. We must confirm this matches Kalshi historical settlements before claiming a divergence on a trace day.
  7. **Snow markets are dormant in April** (out of season). Skip snow entirely for Phase 1; revisit in October when KXNYCSNOWM, KXBOSSNOWM, etc. relist.
  8. **Hurricane and wind markets** are out of scope and don't share the NWS CLI plumbing — they use NHC advisories. Defer to Phase 2+.
  9. **Position limit of $25,000 per Member per strike** is generous enough that it does not constrain Phase 1 (read-only) at all, and constrains a future trading phase only at scale.
 10. **Expiration timing is local to data release**, not a fixed UTC time. Each market exposes both `expected_expiration_time` (when Kalshi expects the data) and `latest_expiration_time` (the hard fallback). The sampling loop should key off `expected_expiration_time` and stop sampling METAR around 30 min before that.

## Appendix: relevant API endpoints used during this discovery

- `GET https://api.elections.kalshi.com/trade-api/v2/series?limit=500` — returns 9,502 series across all categories. Filter `category == "Climate and Weather"` for 264 weather series. No cursor needed (limit=500 returns all).
- `GET https://api.elections.kalshi.com/trade-api/v2/events?series_ticker={ticker}&status=open&limit=10` — returns the open event(s) for a series. Daily-temp series typically return 2 events (today + tomorrow). Rate-limited to ~1 request/sec; use exponential backoff on 429.
- `GET https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker={event_ticker}&limit=100` — returns the bucket markets for an event. Each market includes `rules_primary` (the binding resolution sentence), `yes_ask_dollars`, `yes_bid_dollars`, `volume_fp`, `open_interest_fp`, `expected_expiration_time`, `latest_expiration_time`, and `early_close_condition`. **Field names use `_dollars` suffix and `_fp` (fixed point) suffix — older docs that show plain `yes_ask` are out of date.**
- `GET https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}/orderbook` — full depth orderbook. Not strictly required for Phase 1 since the market object already returns ya/yb/yas/ybs.
- `GET https://kalshi-public-docs.s3.us-east-1.amazonaws.com/regulatory/product-certifications/{cert}.pdf` — contract certification PDFs. **Note: these are wrapped in a multipart/form-data envelope** with a leading `--boundary` line; strip everything before `%PDF-` and after `%%EOF` to get a valid PDF. The contract URL is exposed as `contract_url` on the series object.
