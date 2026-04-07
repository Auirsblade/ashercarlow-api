import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SQLite repository for the Kalshi weather observer.
 *
 * Stores everything the observer needs: tracked markets, price samples,
 * weather observations, discrepancies, and simulated positions. Schema is
 * created at module init — no migrations, no ORM, no ceremony. This is a
 * Phase 1 observational tool, not a production database.
 */

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'kalshi-observer.sqlite');

export interface TrackedMarketRow {
  ticker: string;
  event_ticker: string;
  series_ticker: string;
  category: string;
  region: string;
  title: string | null;
  rules_primary: string | null;
  threshold_json: string | null;
  expected_expiration_time: string | null;
  latest_expiration_time: string | null;
  resolution_source_json: string;
  mapped_metar_icao: string;
  mapping_confidence: string;
  mapping_notes: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface PriceSampleRow {
  id?: number;
  ticker: string;
  sampled_at: string;
  yes_ask: number | null;
  yes_bid: number | null;
  no_ask: number | null;
  no_bid: number | null;
  last_price: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  liquidity: number | null;
}

export interface MetarSampleRow {
  id?: number;
  icao: string;
  observed_at: string;
  temp_c: number | null;
  dewpoint_c: number | null;
  wind_kt: number | null;
  gust_kt: number | null;
  visibility: string | null;
  wx_phenomena: string | null;
  raw: string | null;
}

export interface NwsCliSampleRow {
  id?: number;
  cli_location_id: string;
  product_id: string;
  issuance_time: string;
  observation_date: string | null;
  max_temp_f: number | null;
  min_temp_f: number | null;
  precip_in: number | null;
  precip_is_trace: number; // 0/1
  raw_text: string;
}

export interface DiscrepancyRow {
  id?: number;
  market_ticker: string;
  sampled_at: string;
  market_implied_p: number;
  weather_implied_p: number;
  edge: number;
  would_trade: number; // 0/1
  simulated_side: string | null;
  simulated_size_usd: number | null;
  simulated_fill_price: number | null;
  reasoning: string;
}

export interface SimulatedPositionRow {
  id?: number;
  market_ticker: string;
  opened_at: string;
  side: string;
  size_usd: number;
  entry_price: number;
  closed_at?: string | null;
  resolution_outcome?: string | null;
  realized_pnl_usd?: number | null;
}

@Injectable()
export class ObserverRepository implements OnModuleInit {
  private readonly logger = new Logger(ObserverRepository.name);
  private db!: Database.Database;

  onModuleInit() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.logger.log(`Observer database ready at ${DB_PATH}`);
  }

  /** Exposed for tests that need to control the DB path. */
  useInMemoryForTests() {
    if (this.db) this.db.close();
    this.db = new Database(':memory:');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  close() {
    if (this.db) this.db.close();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kalshi_market (
        ticker TEXT PRIMARY KEY,
        event_ticker TEXT NOT NULL,
        series_ticker TEXT NOT NULL,
        category TEXT NOT NULL,
        region TEXT NOT NULL,
        title TEXT,
        rules_primary TEXT,
        threshold_json TEXT,
        expected_expiration_time TEXT,
        latest_expiration_time TEXT,
        resolution_source_json TEXT NOT NULL,
        mapped_metar_icao TEXT NOT NULL,
        mapping_confidence TEXT NOT NULL,
        mapping_notes TEXT,
        status TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_market_series ON kalshi_market(series_ticker);
      CREATE INDEX IF NOT EXISTS idx_market_status ON kalshi_market(status);
      CREATE INDEX IF NOT EXISTS idx_market_region ON kalshi_market(region);

      CREATE TABLE IF NOT EXISTS kalshi_price_sample (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        sampled_at TEXT NOT NULL,
        yes_ask REAL,
        yes_bid REAL,
        no_ask REAL,
        no_bid REAL,
        last_price REAL,
        volume_24h REAL,
        open_interest REAL,
        liquidity REAL
      );
      CREATE INDEX IF NOT EXISTS idx_price_ticker_time
        ON kalshi_price_sample(ticker, sampled_at);

      CREATE TABLE IF NOT EXISTS metar_sample (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        icao TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        temp_c REAL,
        dewpoint_c REAL,
        wind_kt REAL,
        gust_kt REAL,
        visibility TEXT,
        wx_phenomena TEXT,
        raw TEXT,
        UNIQUE(icao, observed_at)
      );
      CREATE INDEX IF NOT EXISTS idx_metar_icao_time
        ON metar_sample(icao, observed_at);

      CREATE TABLE IF NOT EXISTS nws_cli_sample (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cli_location_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        issuance_time TEXT NOT NULL,
        observation_date TEXT,
        max_temp_f REAL,
        min_temp_f REAL,
        precip_in REAL,
        precip_is_trace INTEGER NOT NULL DEFAULT 0,
        raw_text TEXT NOT NULL,
        UNIQUE(product_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cli_loc_time
        ON nws_cli_sample(cli_location_id, issuance_time);

      CREATE TABLE IF NOT EXISTS discrepancy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_ticker TEXT NOT NULL,
        sampled_at TEXT NOT NULL,
        market_implied_p REAL NOT NULL,
        weather_implied_p REAL NOT NULL,
        edge REAL NOT NULL,
        would_trade INTEGER NOT NULL,
        simulated_side TEXT,
        simulated_size_usd REAL,
        simulated_fill_price REAL,
        reasoning TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discrepancy_ticker
        ON discrepancy(market_ticker, sampled_at);

      CREATE TABLE IF NOT EXISTS simulated_position (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_ticker TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        side TEXT NOT NULL,
        size_usd REAL NOT NULL,
        entry_price REAL NOT NULL,
        closed_at TEXT,
        resolution_outcome TEXT,
        realized_pnl_usd REAL
      );
      CREATE INDEX IF NOT EXISTS idx_position_ticker
        ON simulated_position(market_ticker);
      CREATE INDEX IF NOT EXISTS idx_position_open
        ON simulated_position(closed_at) WHERE closed_at IS NULL;
    `);
  }

  // ---------- kalshi_market ----------

  upsertMarket(row: TrackedMarketRow): void {
    this.db
      .prepare(
        `INSERT INTO kalshi_market (
          ticker, event_ticker, series_ticker, category, region, title,
          rules_primary, threshold_json, expected_expiration_time,
          latest_expiration_time, resolution_source_json, mapped_metar_icao,
          mapping_confidence, mapping_notes, status, first_seen_at, last_seen_at
        ) VALUES (
          @ticker, @event_ticker, @series_ticker, @category, @region, @title,
          @rules_primary, @threshold_json, @expected_expiration_time,
          @latest_expiration_time, @resolution_source_json, @mapped_metar_icao,
          @mapping_confidence, @mapping_notes, @status, @first_seen_at, @last_seen_at
        )
        ON CONFLICT(ticker) DO UPDATE SET
          event_ticker = excluded.event_ticker,
          title = excluded.title,
          rules_primary = excluded.rules_primary,
          threshold_json = excluded.threshold_json,
          expected_expiration_time = excluded.expected_expiration_time,
          latest_expiration_time = excluded.latest_expiration_time,
          status = excluded.status,
          last_seen_at = excluded.last_seen_at
        `,
      )
      .run(row);
  }

  getMarket(ticker: string): TrackedMarketRow | undefined {
    return this.db
      .prepare('SELECT * FROM kalshi_market WHERE ticker = ?')
      .get(ticker) as TrackedMarketRow | undefined;
  }

  listTrackedMarkets(params: { status?: string } = {}): TrackedMarketRow[] {
    if (params.status) {
      return this.db
        .prepare('SELECT * FROM kalshi_market WHERE status = ? ORDER BY ticker')
        .all(params.status) as TrackedMarketRow[];
    }
    return this.db
      .prepare('SELECT * FROM kalshi_market ORDER BY ticker')
      .all() as TrackedMarketRow[];
  }

  /**
   * Return METAR samples for an ICAO within a time window (inclusive).
   * Useful for running max/min computations over a day window.
   */
  listMetarSamplesInWindow(
    icao: string,
    sinceIso: string,
    untilIso: string,
  ): MetarSampleRow[] {
    return this.db
      .prepare(
        `SELECT * FROM metar_sample
         WHERE icao = ? AND observed_at >= ? AND observed_at < ?
         ORDER BY observed_at`,
      )
      .all(icao, sinceIso, untilIso) as MetarSampleRow[];
  }

  /**
   * Return the most recent NWS CLI sample for a location, or undefined.
   */
  getLatestCliForLocation(locationId: string): NwsCliSampleRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM nws_cli_sample
         WHERE cli_location_id = ?
         ORDER BY issuance_time DESC
         LIMIT 1`,
      )
      .get(locationId) as NwsCliSampleRow | undefined;
  }

  /**
   * Most recent price sample per ticker. Used by the discrepancy engine
   * to compare against the weather-implied probability.
   */
  getLatestPriceSample(ticker: string): PriceSampleRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM kalshi_price_sample
         WHERE ticker = ?
         ORDER BY sampled_at DESC
         LIMIT 1`,
      )
      .get(ticker) as PriceSampleRow | undefined;
  }

  // ---------- samples ----------

  insertPriceSample(row: PriceSampleRow): void {
    this.db
      .prepare(
        `INSERT INTO kalshi_price_sample (
          ticker, sampled_at, yes_ask, yes_bid, no_ask, no_bid,
          last_price, volume_24h, open_interest, liquidity
        ) VALUES (
          @ticker, @sampled_at, @yes_ask, @yes_bid, @no_ask, @no_bid,
          @last_price, @volume_24h, @open_interest, @liquidity
        )`,
      )
      .run(row);
  }

  insertMetarSample(row: MetarSampleRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO metar_sample (
          icao, observed_at, temp_c, dewpoint_c, wind_kt, gust_kt,
          visibility, wx_phenomena, raw
        ) VALUES (
          @icao, @observed_at, @temp_c, @dewpoint_c, @wind_kt, @gust_kt,
          @visibility, @wx_phenomena, @raw
        )`,
      )
      .run(row);
  }

  insertNwsCliSample(row: NwsCliSampleRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO nws_cli_sample (
          cli_location_id, product_id, issuance_time, observation_date,
          max_temp_f, min_temp_f, precip_in, precip_is_trace, raw_text
        ) VALUES (
          @cli_location_id, @product_id, @issuance_time, @observation_date,
          @max_temp_f, @min_temp_f, @precip_in, @precip_is_trace, @raw_text
        )`,
      )
      .run(row);
  }

  // ---------- discrepancy & positions ----------

  insertDiscrepancy(row: DiscrepancyRow): number {
    const res = this.db
      .prepare(
        `INSERT INTO discrepancy (
          market_ticker, sampled_at, market_implied_p, weather_implied_p,
          edge, would_trade, simulated_side, simulated_size_usd,
          simulated_fill_price, reasoning
        ) VALUES (
          @market_ticker, @sampled_at, @market_implied_p, @weather_implied_p,
          @edge, @would_trade, @simulated_side, @simulated_size_usd,
          @simulated_fill_price, @reasoning
        )`,
      )
      .run(row);
    return res.lastInsertRowid as number;
  }

  openPosition(row: SimulatedPositionRow): number {
    const res = this.db
      .prepare(
        `INSERT INTO simulated_position (
          market_ticker, opened_at, side, size_usd, entry_price
        ) VALUES (
          @market_ticker, @opened_at, @side, @size_usd, @entry_price
        )`,
      )
      .run(row);
    return res.lastInsertRowid as number;
  }

  closePosition(
    id: number,
    closedAt: string,
    outcome: string,
    pnl: number,
  ): void {
    this.db
      .prepare(
        `UPDATE simulated_position
         SET closed_at = ?, resolution_outcome = ?, realized_pnl_usd = ?
         WHERE id = ?`,
      )
      .run(closedAt, outcome, pnl, id);
  }

  listOpenPositions(): SimulatedPositionRow[] {
    return this.db
      .prepare(
        'SELECT * FROM simulated_position WHERE closed_at IS NULL ORDER BY opened_at',
      )
      .all() as SimulatedPositionRow[];
  }

  findOpenPositionForMarket(ticker: string): SimulatedPositionRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM simulated_position WHERE market_ticker = ? AND closed_at IS NULL',
      )
      .get(ticker) as SimulatedPositionRow | undefined;
  }
}
