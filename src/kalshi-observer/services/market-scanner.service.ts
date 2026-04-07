import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  KalshiClient,
  KalshiMarket,
  parseKalshiNumber,
} from '../clients/kalshi.client';
import { ObserverRepository } from '../storage/observer.repository';
import { StationMapperService } from './station-mapper.service';

/**
 * Shape of an entry in curated-markets.json — the hand-curated set of Kalshi
 * weather series the observer tracks. Each entry specifies a series and the
 * resolution metadata (source agency, station, metric) parsed from the
 * contract certification PDF during Step 0 research.
 */
export interface CuratedMarketConfig {
  series_ticker: string;
  category: string;
  region: string;
  resolution_source: {
    agency: string;
    wfo: string;
    cli_location_id: string;
    station_name: string;
    station_id: string;
    metric: string;
  };
  mapped_metar_icao: string;
  mapping_confidence: 'high' | 'medium' | 'low';
  mapping_notes: string;
}

/**
 * Refreshes the set of tracked Kalshi weather markets from live Kalshi data.
 *
 * Daily weather markets get new tickers every day (e.g. KXHIGHNY-26APR08-T55),
 * so the scanner can't persist tickers statically. Instead it takes the
 * curated series list, expands each series into its currently-open events,
 * then expands each event into its live markets, and upserts the resulting
 * rows into the observer database with resolution/mapping metadata attached.
 *
 * On each refresh, the scanner also validates the station mapping for each
 * curated entry against the StationMapperService — catching any drift
 * between curated-markets.json and station-map.json at load time instead
 * of during a trade.
 */
@Injectable()
export class MarketScannerService {
  private readonly logger = new Logger(MarketScannerService.name);
  private readonly curated: CuratedMarketConfig[];

  constructor(
    private readonly kalshi: KalshiClient,
    private readonly stations: StationMapperService,
    private readonly repo: ObserverRepository,
  ) {
    const configPath = path.resolve(
      __dirname,
      '..',
      'config',
      'curated-markets.json',
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    this.curated = JSON.parse(raw) as CuratedMarketConfig[];

    // Validate every curated entry at construction time — fail loud if
    // station mapping is inconsistent with station-map.json.
    for (const c of this.curated) {
      this.stations.assertIcaoForRegion(c.region, c.mapped_metar_icao);
    }

    this.logger.log(
      `Loaded ${this.curated.length} curated weather series: ` +
        this.curated.map((c) => c.series_ticker).join(', '),
    );
  }

  getCuratedConfigs(): CuratedMarketConfig[] {
    return [...this.curated];
  }

  getConfigForSeries(seriesTicker: string): CuratedMarketConfig | undefined {
    return this.curated.find((c) => c.series_ticker === seriesTicker);
  }

  /**
   * Refresh tracked markets from live Kalshi data. For each curated series:
   *  1. List currently-open events (typically 1-2: today + tomorrow)
   *  2. For each event, list its live markets (typically 5-15 buckets)
   *  3. Upsert each market into the database with resolution/mapping
   *     metadata pulled from the curated config
   *
   * Returns a summary of counts for logging/reporting.
   */
  async refresh(): Promise<{
    seriesScanned: number;
    eventsFound: number;
    marketsUpserted: number;
    priceSamplesInserted: number;
    errors: Array<{ series: string; message: string }>;
  }> {
    const errors: Array<{ series: string; message: string }> = [];
    let eventsFound = 0;
    let marketsUpserted = 0;
    let priceSamplesInserted = 0;
    const sampledAt = new Date().toISOString();

    for (const config of this.curated) {
      try {
        const events = await this.kalshi.listEvents({
          series_ticker: config.series_ticker,
          status: 'open',
          limit: 10,
        });
        eventsFound += events.length;

        for (const event of events) {
          const markets = await this.kalshi.listMarkets({
            event_ticker: event.event_ticker,
            limit: 100,
          });

          for (const market of markets) {
            this.upsertFromApiMarket(market, event.event_ticker, config);
            this.insertPriceSample(market, sampledAt);
            marketsUpserted++;
            priceSamplesInserted++;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to refresh ${config.series_ticker}: ${message}`,
        );
        errors.push({ series: config.series_ticker, message });
      }
    }

    this.logger.log(
      `Refresh complete: scanned ${this.curated.length} series, ` +
        `found ${eventsFound} events, upserted ${marketsUpserted} markets, ` +
        `inserted ${priceSamplesInserted} price samples` +
        (errors.length ? ` (${errors.length} errors)` : ''),
    );

    return {
      seriesScanned: this.curated.length,
      eventsFound,
      marketsUpserted,
      priceSamplesInserted,
      errors,
    };
  }

  private insertPriceSample(market: KalshiMarket, sampledAt: string): void {
    this.repo.insertPriceSample({
      ticker: market.ticker,
      sampled_at: sampledAt,
      yes_ask: parseKalshiNumber(market.yes_ask_dollars) ?? null,
      yes_bid: parseKalshiNumber(market.yes_bid_dollars) ?? null,
      no_ask: parseKalshiNumber(market.no_ask_dollars) ?? null,
      no_bid: parseKalshiNumber(market.no_bid_dollars) ?? null,
      last_price: parseKalshiNumber(market.last_price_dollars) ?? null,
      volume_24h: parseKalshiNumber(market.volume_24h_fp) ?? null,
      open_interest: parseKalshiNumber(market.open_interest_fp) ?? null,
      liquidity: parseKalshiNumber(market.liquidity_dollars) ?? null,
    });
  }

  private upsertFromApiMarket(
    market: KalshiMarket,
    eventTicker: string,
    config: CuratedMarketConfig,
  ): void {
    const now = new Date().toISOString();
    const existing = this.repo.getMarket(market.ticker);
    const threshold = this.buildThreshold(market);

    this.repo.upsertMarket({
      ticker: market.ticker,
      event_ticker: eventTicker,
      series_ticker: config.series_ticker,
      category: config.category,
      region: config.region,
      title: market.title ?? market.subtitle ?? null,
      rules_primary: market.rules_primary ?? null,
      threshold_json: threshold ? JSON.stringify(threshold) : null,
      expected_expiration_time: market.expected_expiration_time ?? null,
      latest_expiration_time: market.latest_expiration_time ?? null,
      resolution_source_json: JSON.stringify(config.resolution_source),
      mapped_metar_icao: config.mapped_metar_icao,
      mapping_confidence: config.mapping_confidence,
      mapping_notes: config.mapping_notes,
      status: market.status ?? 'unknown',
      first_seen_at: existing?.first_seen_at ?? now,
      last_seen_at: now,
    });
  }

  /**
   * Build a threshold descriptor from Kalshi's authoritative fields.
   *
   * NEVER parse the ticker suffix for direction — `-T48` can mean either
   * `> 48` or `< 48` depending on `strike_type`. Always use `strike_type`
   * + `floor_strike` / `cap_strike`.
   */
  private buildThreshold(
    market: KalshiMarket,
  ):
    | { op: 'greater'; value: number }
    | { op: 'less'; value: number }
    | { op: 'between'; floor: number; cap: number }
    | undefined {
    const strikeType = market.strike_type;

    if (strikeType === 'greater' && market.floor_strike != null) {
      return { op: 'greater', value: market.floor_strike };
    }
    if (strikeType === 'less' && market.cap_strike != null) {
      return { op: 'less', value: market.cap_strike };
    }
    if (
      strikeType === 'between' &&
      market.floor_strike != null &&
      market.cap_strike != null
    ) {
      return {
        op: 'between',
        floor: market.floor_strike,
        cap: market.cap_strike,
      };
    }
    return undefined;
  }
}
