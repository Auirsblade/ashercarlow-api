import { Injectable, Logger } from '@nestjs/common';
import {
  ObserverRepository,
  TrackedMarketRow,
} from '../storage/observer.repository';

/**
 * Converts tracked weather data into a probability that a Kalshi weather
 * market resolves YES. v0 is intentionally simple and rule-based — the
 * whole point of Phase 1 is to measure whether even this naive signal
 * produces positive expected value vs live market prices.
 *
 * Threshold format (authoritative — built from Kalshi's `strike_type`,
 * `floor_strike`, `cap_strike`, NEVER from parsing the ticker suffix):
 *
 *   { op: 'greater', value: V }          - resolves YES if observed > V
 *   { op: 'less',    value: V }          - resolves YES if observed < V
 *   { op: 'between', floor: L, cap: H }  - resolves YES if L <= observed <= H
 *
 * Monotonicity-based guarantees for HIGH TEMP markets (running max only goes up):
 *   - greater V: if running_max > V                  -> guaranteed YES
 *   - less V:    if running_max >= V                 -> guaranteed NO
 *   - between:   if running_max > cap                -> guaranteed NO (busted above)
 *
 * Monotonicity-based guarantees for LOW TEMP markets (running min only goes down):
 *   - greater V: if running_min <= V                 -> guaranteed NO (dipped below)
 *   - less V:    if running_min < V                  -> guaranteed YES
 *   - between:   if running_min < floor              -> guaranteed NO (dipped below)
 *
 * CLI (Climate Report) is the authoritative resolution source. When a CLI
 * for the market's exact observation date is available, it is used instead
 * of METAR nowcasting.
 */

export type SignalStatus =
  | 'already_resolved_yes'
  | 'already_resolved_no'
  | 'running_guaranteed_yes'
  | 'running_guaranteed_no'
  | 'needs_forecast'
  | 'insufficient_data'
  | 'unknown_category';

export interface WeatherSignal {
  weatherImpliedP: number;
  status: SignalStatus;
  reasoning: string;
  dataPoints: Record<string, unknown>;
}

export type Threshold =
  | { op: 'greater'; value: number }
  | { op: 'less'; value: number }
  | { op: 'between'; floor: number; cap: number };

@Injectable()
export class WeatherSignalService {
  private readonly logger = new Logger(WeatherSignalService.name);

  constructor(private readonly repo: ObserverRepository) {}

  estimate(market: TrackedMarketRow): WeatherSignal {
    const threshold = this.parseThreshold(market.threshold_json);
    if (!threshold) {
      return {
        weatherImpliedP: 0.5,
        status: 'insufficient_data',
        reasoning: `Could not parse threshold from ${market.threshold_json}`,
        dataPoints: {},
      };
    }

    const resolutionSource = this.parseResolutionSource(
      market.resolution_source_json,
    );
    const day = this.extractDayFromEventTicker(market.event_ticker);

    switch (market.category) {
      case 'high_temp':
        return this.estimateHighTemp(market, threshold, resolutionSource, day);
      case 'low_temp':
        return this.estimateLowTemp(market, threshold, resolutionSource, day);
      case 'precip_daily':
        return this.estimatePrecipDaily(
          market,
          threshold,
          resolutionSource,
          day,
        );
      case 'precip_monthly':
        return this.estimatePrecipMonthly(market, threshold, resolutionSource);
      default:
        return {
          weatherImpliedP: 0.5,
          status: 'unknown_category',
          reasoning: `Unknown category "${market.category}"`,
          dataPoints: {},
        };
    }
  }

  // ---------- evaluation (public so callers can check threshold directly) ----------

  evalThreshold(value: number, t: Threshold): boolean {
    switch (t.op) {
      case 'greater':
        return value > t.value;
      case 'less':
        return value < t.value;
      case 'between':
        return value >= t.floor && value <= t.cap;
    }
  }

  describeThreshold(t: Threshold): string {
    switch (t.op) {
      case 'greater':
        return `> ${t.value}`;
      case 'less':
        return `< ${t.value}`;
      case 'between':
        return `in [${t.floor}, ${t.cap}]`;
    }
  }

  // ---------- high temp ----------

  private estimateHighTemp(
    market: TrackedMarketRow,
    threshold: Threshold,
    resolutionSource: { cli_location_id: string } | undefined,
    day: { startUtc: string; endUtc: string; dateStr: string } | undefined,
  ): WeatherSignal {
    // CLI is the binding source when available for the exact day.
    const cliSig = this.tryCliHighTemp(
      market,
      threshold,
      resolutionSource,
      day,
    );
    if (cliSig) return cliSig;

    if (!day) {
      return this.insufficient(
        `Could not derive day window from event ${market.event_ticker}`,
      );
    }
    const metarMax = this.runningMaxTempF(
      market.mapped_metar_icao,
      day.startUtc,
      day.endUtc,
    );
    if (metarMax == null) {
      return this.insufficient(
        `No METAR samples for ${market.mapped_metar_icao} in window ${day.startUtc}..${day.endUtc}`,
      );
    }

    const dataPoints = {
      runningMaxF: metarMax.maxF,
      runningMaxAt: metarMax.atIso,
      sampleCount: metarMax.count,
    };

    // Daily max is monotonic non-decreasing.
    switch (threshold.op) {
      case 'greater':
        if (metarMax.maxF > threshold.value) {
          return {
            weatherImpliedP: 1.0,
            status: 'running_guaranteed_yes',
            reasoning:
              `${market.mapped_metar_icao} running max = ${metarMax.maxF.toFixed(1)}°F ` +
              `at ${metarMax.atIso}, already > ${threshold.value}. ` +
              `NOTE: ~1°F drift possible between METAR and NWS CLI QC value.`,
            dataPoints,
          };
        }
        break;
      case 'less':
        // "max < V" — if running max already >= V, the day's max is locked
        // at >= V, so the market resolves NO.
        if (metarMax.maxF >= threshold.value) {
          return {
            weatherImpliedP: 0.0,
            status: 'running_guaranteed_no',
            reasoning:
              `${market.mapped_metar_icao} running max = ${metarMax.maxF.toFixed(1)}°F ` +
              `is already >= ${threshold.value}. Daily max is monotonic; the final ` +
              `max cannot fall back below ${threshold.value}.`,
            dataPoints,
          };
        }
        break;
      case 'between':
        if (metarMax.maxF > threshold.cap) {
          return {
            weatherImpliedP: 0.0,
            status: 'running_guaranteed_no',
            reasoning:
              `${market.mapped_metar_icao} running max = ${metarMax.maxF.toFixed(1)}°F ` +
              `is already > cap ${threshold.cap}. Daily max cannot fall back into [${threshold.floor}, ${threshold.cap}].`,
            dataPoints,
          };
        }
        break;
    }

    return {
      weatherImpliedP: 0.5,
      status: 'needs_forecast',
      reasoning:
        `${market.mapped_metar_icao} running max = ${metarMax.maxF.toFixed(1)}°F, ` +
        `threshold ${this.describeThreshold(threshold)}. Not yet monotonically locked; ` +
        `forecast source not wired in — holding at 0.5 rather than guessing.`,
      dataPoints,
    };
  }

  private tryCliHighTemp(
    market: TrackedMarketRow,
    threshold: Threshold,
    resolutionSource: { cli_location_id: string } | undefined,
    day: { startUtc: string; endUtc: string; dateStr: string } | undefined,
  ): WeatherSignal | undefined {
    if (!resolutionSource?.cli_location_id || !day) return undefined;
    const cli = this.repo.getLatestCliForLocation(
      resolutionSource.cli_location_id,
    );
    if (
      !cli ||
      cli.max_temp_f == null ||
      cli.observation_date !== day.dateStr
    ) {
      return undefined;
    }
    const resolved = this.evalThreshold(cli.max_temp_f, threshold);
    return {
      weatherImpliedP: resolved ? 1.0 : 0.0,
      status: resolved ? 'already_resolved_yes' : 'already_resolved_no',
      reasoning:
        `CLI ${resolutionSource.cli_location_id} max=${cli.max_temp_f}°F vs ` +
        `${this.describeThreshold(threshold)}; resolved ${resolved ? 'YES' : 'NO'}`,
      dataPoints: { cliMaxF: cli.max_temp_f, cliIssuedAt: cli.issuance_time },
    };
  }

  // ---------- low temp ----------

  private estimateLowTemp(
    market: TrackedMarketRow,
    threshold: Threshold,
    resolutionSource: { cli_location_id: string } | undefined,
    day: { startUtc: string; endUtc: string; dateStr: string } | undefined,
  ): WeatherSignal {
    const cliSig = this.tryCliLowTemp(market, threshold, resolutionSource, day);
    if (cliSig) return cliSig;

    if (!day) {
      return this.insufficient(
        `Could not derive day window from event ${market.event_ticker}`,
      );
    }
    const metarMin = this.runningMinTempF(
      market.mapped_metar_icao,
      day.startUtc,
      day.endUtc,
    );
    if (metarMin == null) {
      return this.insufficient(
        `No METAR samples for ${market.mapped_metar_icao} in window ${day.startUtc}..${day.endUtc}`,
      );
    }

    const dataPoints = {
      runningMinF: metarMin.minF,
      runningMinAt: metarMin.atIso,
      sampleCount: metarMin.count,
    };

    // Daily min is monotonic non-increasing.
    switch (threshold.op) {
      case 'greater':
        // "min > V" — if running min already <= V, can't recover.
        if (metarMin.minF <= threshold.value) {
          return {
            weatherImpliedP: 0.0,
            status: 'running_guaranteed_no',
            reasoning:
              `${market.mapped_metar_icao} running min = ${metarMin.minF.toFixed(1)}°F ` +
              `is already <= ${threshold.value}. Daily min is monotonic non-increasing.`,
            dataPoints,
          };
        }
        break;
      case 'less':
        // "min < V" — if running min already < V, guaranteed YES.
        if (metarMin.minF < threshold.value) {
          return {
            weatherImpliedP: 1.0,
            status: 'running_guaranteed_yes',
            reasoning:
              `${market.mapped_metar_icao} running min = ${metarMin.minF.toFixed(1)}°F ` +
              `is already < ${threshold.value}. Daily min can only go lower. ` +
              `NOTE: ~1°F drift possible vs CLI.`,
            dataPoints,
          };
        }
        break;
      case 'between':
        if (metarMin.minF < threshold.floor) {
          return {
            weatherImpliedP: 0.0,
            status: 'running_guaranteed_no',
            reasoning:
              `${market.mapped_metar_icao} running min = ${metarMin.minF.toFixed(1)}°F ` +
              `is already < floor ${threshold.floor}.`,
            dataPoints,
          };
        }
        break;
    }

    return {
      weatherImpliedP: 0.5,
      status: 'needs_forecast',
      reasoning:
        `${market.mapped_metar_icao} running min = ${metarMin.minF.toFixed(1)}°F, ` +
        `threshold ${this.describeThreshold(threshold)}. Not monotonically locked.`,
      dataPoints,
    };
  }

  private tryCliLowTemp(
    market: TrackedMarketRow,
    threshold: Threshold,
    resolutionSource: { cli_location_id: string } | undefined,
    day: { startUtc: string; endUtc: string; dateStr: string } | undefined,
  ): WeatherSignal | undefined {
    if (!resolutionSource?.cli_location_id || !day) return undefined;
    const cli = this.repo.getLatestCliForLocation(
      resolutionSource.cli_location_id,
    );
    if (
      !cli ||
      cli.min_temp_f == null ||
      cli.observation_date !== day.dateStr
    ) {
      return undefined;
    }
    const resolved = this.evalThreshold(cli.min_temp_f, threshold);
    return {
      weatherImpliedP: resolved ? 1.0 : 0.0,
      status: resolved ? 'already_resolved_yes' : 'already_resolved_no',
      reasoning: `CLI ${resolutionSource.cli_location_id} min=${cli.min_temp_f}°F vs ${this.describeThreshold(threshold)}`,
      dataPoints: { cliMinF: cli.min_temp_f, cliIssuedAt: cli.issuance_time },
    };
  }

  // ---------- precip ----------

  private estimatePrecipDaily(
    market: TrackedMarketRow,
    threshold: Threshold,
    resolutionSource: { cli_location_id: string } | undefined,
    day: { startUtc: string; endUtc: string; dateStr: string } | undefined,
  ): WeatherSignal {
    if (resolutionSource?.cli_location_id && day) {
      const cli = this.repo.getLatestCliForLocation(
        resolutionSource.cli_location_id,
      );
      if (
        cli &&
        cli.precip_in != null &&
        cli.observation_date === day.dateStr
      ) {
        const resolved = this.evalThreshold(cli.precip_in, threshold);
        return {
          weatherImpliedP: resolved ? 1.0 : 0.0,
          status: resolved ? 'already_resolved_yes' : 'already_resolved_no',
          reasoning:
            `CLI ${resolutionSource.cli_location_id} precip=${cli.precip_in} ` +
            `vs ${this.describeThreshold(threshold)} (trace=${cli.precip_is_trace ? 'yes' : 'no'})`,
          dataPoints: {
            cliPrecipIn: cli.precip_in,
            cliIsTrace: !!cli.precip_is_trace,
          },
        };
      }
    }
    return {
      weatherImpliedP: 0.5,
      status: 'insufficient_data',
      reasoning:
        'Daily precip signal deferred: METAR-based precip nowcasting is noisy. Waiting on CLI for this market day.',
      dataPoints: {},
    };
  }

  private estimatePrecipMonthly(
    _market: TrackedMarketRow,
    _threshold: Threshold,
    resolutionSource: { cli_location_id: string } | undefined,
  ): WeatherSignal {
    return {
      weatherImpliedP: 0.5,
      status: 'insufficient_data',
      reasoning:
        'Monthly precip signal not implemented in Phase 1 (needs rolling sum of daily CLI precip).',
      dataPoints: { cliLocationId: resolutionSource?.cli_location_id },
    };
  }

  // ---------- METAR helpers ----------

  private runningMaxTempF(
    icao: string,
    startUtc: string,
    endUtc: string,
  ): { maxF: number; atIso: string; count: number } | null {
    const rows = this.repo.listMetarSamplesInWindow(icao, startUtc, endUtc);
    let best: { maxF: number; atIso: string } | null = null;
    let count = 0;
    for (const r of rows) {
      if (r.temp_c == null) continue;
      count++;
      const f = (r.temp_c * 9) / 5 + 32;
      if (!best || f > best.maxF) best = { maxF: f, atIso: r.observed_at };
    }
    return best && { maxF: best.maxF, atIso: best.atIso, count };
  }

  private runningMinTempF(
    icao: string,
    startUtc: string,
    endUtc: string,
  ): { minF: number; atIso: string; count: number } | null {
    const rows = this.repo.listMetarSamplesInWindow(icao, startUtc, endUtc);
    let best: { minF: number; atIso: string } | null = null;
    let count = 0;
    for (const r of rows) {
      if (r.temp_c == null) continue;
      count++;
      const f = (r.temp_c * 9) / 5 + 32;
      if (!best || f < best.minF) best = { minF: f, atIso: r.observed_at };
    }
    return best && { minF: best.minF, atIso: best.atIso, count };
  }

  private insufficient(reasoning: string): WeatherSignal {
    return {
      weatherImpliedP: 0.5,
      status: 'insufficient_data',
      reasoning,
      dataPoints: {},
    };
  }

  // ---------- parsing ----------

  private parseThreshold(json: string | null): Threshold | undefined {
    if (!json) return undefined;
    try {
      const parsed = JSON.parse(json) as Threshold;
      if (parsed.op === 'greater' || parsed.op === 'less') {
        if (typeof parsed.value === 'number') return parsed;
      }
      if (parsed.op === 'between') {
        if (
          typeof parsed.floor === 'number' &&
          typeof parsed.cap === 'number'
        ) {
          return parsed;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private parseResolutionSource(
    json: string,
  ): { cli_location_id: string; station_id?: string } | undefined {
    try {
      return JSON.parse(json) as { cli_location_id: string };
    } catch {
      return undefined;
    }
  }

  private extractDayFromEventTicker(
    eventTicker: string,
  ): { startUtc: string; endUtc: string; dateStr: string } | undefined {
    const m = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{1,2})(?:[A-Z]+)?$/);
    if (!m) return undefined;
    const year = 2000 + parseInt(m[1], 10);
    const monthIdx = MONTHS.indexOf(m[2]);
    if (monthIdx < 0) return undefined;
    const day = parseInt(m[3], 10);
    const start = new Date(Date.UTC(year, monthIdx, day, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIdx, day + 1, 0, 0, 0));
    return {
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      dateStr: `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    };
  }
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
