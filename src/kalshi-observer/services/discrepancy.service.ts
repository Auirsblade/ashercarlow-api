import { Injectable, Logger } from '@nestjs/common';
import {
  DiscrepancyRow,
  ObserverRepository,
  PriceSampleRow,
  TrackedMarketRow,
} from '../storage/observer.repository';
import { SimulatorService } from './simulator.service';
import { WeatherSignal, WeatherSignalService } from './weather-signal.service';

/**
 * Joins the weather signal with the latest Kalshi price for each tracked
 * market, computes the edge, and persists a `discrepancy` row. Also decides
 * whether the observer *would have* taken a paper position if the signal
 * were trusted — this is the `wouldTrade` flag.
 *
 * Phase 1 trade rules (intentionally conservative):
 *   1. Signal status must be one of `already_resolved_*` or
 *      `running_guaranteed_*`. We do NOT trade on `needs_forecast`
 *      because we don't have a forecast source wired in yet —
 *      guessing here would be worse than the market.
 *   2. For `running_guaranteed_*` (METAR-based, not CLI): require a
 *      ≥ 1.0°F margin between the running max/min and the threshold.
 *      METAR and NWS CLI can drift by ~1°F due to rounding and QC;
 *      a tighter margin is a silent-loss trap.
 *   3. |edge| must exceed 0.15 (15 cents) to be worth crossing the spread.
 *   4. Price sample must have both yes_ask and yes_bid, and the
 *      spread must be ≤ 5 cents (noisy books are traps).
 *   5. Market liquidity (`liquidity_fp`) must be ≥ $200.
 *   6. No existing open paper position for the same market.
 *
 * Every evaluated market gets a `discrepancy` row regardless of whether
 * `wouldTrade` is true — we need the full dataset to measure signal edge
 * and calibrate the rules in Step 7.
 *
 * Phase 1 known limitation: with no forecast source, only ~12% of markets
 * will be actionable per scan (the ones where the day's high/low is
 * already locked in monotonically). This is correct for Phase 1 — the
 * goal is to measure whether the signal we DO have is edge-positive, not
 * to maximize coverage.
 */

const EDGE_THRESHOLD = 0.15;
const MIN_LIQUIDITY_USD = 200;
const MAX_SPREAD = 0.05;
const METAR_SAFETY_MARGIN_F = 1.0;

export interface DiscrepancyResult {
  marketTicker: string;
  signal: WeatherSignal;
  marketImpliedP: number | null;
  edge: number | null;
  wouldTrade: boolean;
  side: 'yes' | 'no' | null;
  skipReason: string | null;
  /** Populated when a paper position was actually opened. */
  openedPositionId?: number;
  openedSizeUsd?: number;
  openedFillPrice?: number;
}

@Injectable()
export class DiscrepancyService {
  private readonly logger = new Logger(DiscrepancyService.name);

  constructor(
    private readonly repo: ObserverRepository,
    private readonly signals: WeatherSignalService,
    private readonly simulator: SimulatorService,
  ) {}

  /**
   * Evaluate every tracked market and persist discrepancy rows. Returns a
   * summary of counts for logging.
   */
  scanAll(): {
    evaluated: number;
    withSignal: number;
    wouldTradeCount: number;
    openedCount: number;
    topEdges: DiscrepancyResult[];
  } {
    const markets = this.repo.listTrackedMarkets({ status: 'active' });
    const sampledAt = new Date().toISOString();

    let withSignal = 0;
    let wouldTradeCount = 0;
    let openedCount = 0;
    const allResults: DiscrepancyResult[] = [];

    for (const market of markets) {
      const result = this.evaluateMarket(market);

      // If the market passed filters, try to open a paper position.
      // Simulator may still decline (insufficient bankroll, invalid prices).
      if (result.wouldTrade && result.side) {
        const price = this.repo.getLatestPriceSample(market.ticker);
        if (price) {
          const opened = this.simulator.tryOpen(
            market,
            price,
            result.side,
            sampledAt,
          );
          if (opened) {
            result.openedPositionId = opened.id;
            result.openedSizeUsd = opened.sizeUsd;
            result.openedFillPrice = opened.entryPrice;
            openedCount++;
          } else {
            result.wouldTrade = false;
            result.skipReason = 'simulator-declined';
          }
        }
      }

      allResults.push(result);
      if (this.signalIsActionable(result.signal.status)) withSignal++;
      if (result.wouldTrade) wouldTradeCount++;

      this.persist(result, market, sampledAt);
    }

    const topEdges = allResults
      .filter((r) => r.edge != null)
      .sort((a, b) => Math.abs(b.edge!) - Math.abs(a.edge!))
      .slice(0, 10);

    this.logger.log(
      `Discrepancy scan: ${markets.length} markets, ${withSignal} actionable signals, ` +
        `${wouldTradeCount} would-trade, ${openedCount} paper positions opened`,
    );

    return {
      evaluated: markets.length,
      withSignal,
      wouldTradeCount,
      openedCount,
      topEdges,
    };
  }

  evaluateMarket(market: TrackedMarketRow): DiscrepancyResult {
    const signal = this.signals.estimate(market);
    const price = this.repo.getLatestPriceSample(market.ticker);

    // No price data yet — can still persist the signal as an info-only row.
    if (!price || price.yes_ask == null || price.yes_bid == null) {
      return {
        marketTicker: market.ticker,
        signal,
        marketImpliedP: null,
        edge: null,
        wouldTrade: false,
        side: null,
        skipReason: 'no-price-sample',
      };
    }

    const marketImpliedP = (price.yes_ask + price.yes_bid) / 2;
    const edge = signal.weatherImpliedP - marketImpliedP;

    const skip = this.determineSkipReason(market, signal, price, edge);
    const side = edge > 0 ? 'yes' : 'no';
    const wouldTrade = skip == null;

    return {
      marketTicker: market.ticker,
      signal,
      marketImpliedP,
      edge,
      wouldTrade,
      side: wouldTrade ? side : null,
      skipReason: skip,
    };
  }

  // ---------- decision helpers ----------

  private determineSkipReason(
    market: TrackedMarketRow,
    signal: WeatherSignal,
    price: PriceSampleRow,
    edge: number,
  ): string | null {
    if (!this.signalIsActionable(signal.status)) {
      return `signal-${signal.status}`;
    }

    if (Math.abs(edge) < EDGE_THRESHOLD) {
      return `edge-${edge.toFixed(3)}-below-threshold`;
    }

    if (price.yes_ask == null || price.yes_bid == null) {
      return 'missing-ask-or-bid';
    }
    const spread = price.yes_ask - price.yes_bid;
    if (spread > MAX_SPREAD) {
      return `spread-${spread.toFixed(3)}-too-wide`;
    }

    const liquidity = price.liquidity ?? 0;
    if (liquidity < MIN_LIQUIDITY_USD) {
      return `liquidity-${liquidity}-below-${MIN_LIQUIDITY_USD}`;
    }

    // METAR-based guarantees need a safety margin — CLI rounding can
    // silently flip the result on marginal cases.
    if (
      signal.status === 'running_guaranteed_yes' ||
      signal.status === 'running_guaranteed_no'
    ) {
      const margin = this.computeMetarMarginF(market, signal);
      if (margin != null && margin < METAR_SAFETY_MARGIN_F) {
        return `metar-margin-${margin.toFixed(2)}F-below-${METAR_SAFETY_MARGIN_F}`;
      }
    }

    // Don't open a second position on the same market.
    const existing = this.repo.findOpenPositionForMarket(market.ticker);
    if (existing) {
      return `position-already-open-${existing.id}`;
    }

    return null;
  }

  private signalIsActionable(status: WeatherSignal['status']): boolean {
    return (
      status === 'already_resolved_yes' ||
      status === 'already_resolved_no' ||
      status === 'running_guaranteed_yes' ||
      status === 'running_guaranteed_no'
    );
  }

  /**
   * For a METAR-based guarantee signal, return the margin in °F between
   * the running observation and the threshold. Returns undefined if the
   * signal doesn't carry numeric temperature data (e.g. precip markets).
   */
  private computeMetarMarginF(
    market: TrackedMarketRow,
    signal: WeatherSignal,
  ): number | undefined {
    const threshold = this.parseThreshold(market.threshold_json);
    if (!threshold) return undefined;

    const runningMaxF = signal.dataPoints.runningMaxF as number | undefined;
    const runningMinF = signal.dataPoints.runningMinF as number | undefined;

    if (market.category === 'high_temp' && runningMaxF != null) {
      if (
        signal.status === 'running_guaranteed_yes' &&
        threshold.op === 'greater'
      ) {
        return runningMaxF - threshold.value;
      }
      if (
        signal.status === 'running_guaranteed_no' &&
        threshold.op === 'less'
      ) {
        return runningMaxF - threshold.value;
      }
      if (
        signal.status === 'running_guaranteed_no' &&
        threshold.op === 'between'
      ) {
        return runningMaxF - threshold.cap;
      }
    }
    if (market.category === 'low_temp' && runningMinF != null) {
      if (
        signal.status === 'running_guaranteed_no' &&
        threshold.op === 'greater'
      ) {
        return threshold.value - runningMinF;
      }
      if (
        signal.status === 'running_guaranteed_yes' &&
        threshold.op === 'less'
      ) {
        return threshold.value - runningMinF;
      }
      if (
        signal.status === 'running_guaranteed_no' &&
        threshold.op === 'between'
      ) {
        return threshold.floor - runningMinF;
      }
    }
    return undefined;
  }

  private parseThreshold(
    json: string | null,
  ):
    | { op: 'greater'; value: number }
    | { op: 'less'; value: number }
    | { op: 'between'; floor: number; cap: number }
    | undefined {
    if (!json) return undefined;
    try {
      return JSON.parse(json) as
        | { op: 'greater'; value: number }
        | { op: 'less'; value: number }
        | { op: 'between'; floor: number; cap: number };
    } catch {
      return undefined;
    }
  }

  // ---------- persistence ----------

  private persist(
    result: DiscrepancyResult,
    market: TrackedMarketRow,
    sampledAt: string,
  ): void {
    const reasoningLines = [
      `status=${result.signal.status}`,
      `reasoning=${result.signal.reasoning}`,
    ];
    if (result.skipReason) reasoningLines.push(`skip=${result.skipReason}`);

    const row: DiscrepancyRow = {
      market_ticker: market.ticker,
      sampled_at: sampledAt,
      market_implied_p: result.marketImpliedP ?? 0,
      weather_implied_p: result.signal.weatherImpliedP,
      edge: result.edge ?? 0,
      would_trade: result.wouldTrade ? 1 : 0,
      simulated_side: result.side,
      simulated_size_usd: result.openedSizeUsd ?? null,
      simulated_fill_price: result.openedFillPrice ?? null,
      reasoning: reasoningLines.join(' | '),
    };

    this.repo.insertDiscrepancy(row);
  }
}
