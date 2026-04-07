import { Injectable } from '@nestjs/common';
import { ObserverRepository } from '../storage/observer.repository';
import { BankrollSummary, SimulatorService } from './simulator.service';

/**
 * Read-only query layer for the observer's inspection endpoints.
 * Everything here is pure SELECT — no mutation of observer state.
 */

export interface ObserverSummary {
  phase: string;
  trading: false;
  bankroll: BankrollSummary;
  markets: {
    tracked: number;
    active: number;
    settled: number;
  };
  discrepancies: {
    total: number;
    wouldTradeTotal: number;
    last24h: number;
  };
}

export interface DiscrepancyView {
  id: number;
  market_ticker: string;
  sampled_at: string;
  market_implied_p: number;
  weather_implied_p: number;
  edge: number;
  would_trade: boolean;
  side: string | null;
  size_usd: number | null;
  fill_price: number | null;
  reasoning: string;
}

export interface PositionView {
  id: number;
  market_ticker: string;
  opened_at: string;
  side: string;
  size_usd: number;
  entry_price: number;
  closed_at: string | null;
  resolution_outcome: string | null;
  realized_pnl_usd: number | null;
}

export interface MappingErrorView {
  position_id: number;
  market_ticker: string;
  opened_at: string;
  side: string;
  entry_price: number;
  weather_implied_p_at_open: number;
  resolution_outcome: string;
  realized_pnl_usd: number;
  reasoning_at_open: string;
}

interface RawDb {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
}

@Injectable()
export class ReportingService {
  constructor(
    private readonly repo: ObserverRepository,
    private readonly simulator: SimulatorService,
  ) {}

  private get db(): RawDb {
    return (this.repo as unknown as { db: RawDb }).db;
  }

  getSummary(): ObserverSummary {
    const marketCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status IN ('settled','finalized','determined') THEN 1 ELSE 0 END) AS settled
         FROM kalshi_market`,
      )
      .get() as { total: number; active: number; settled: number };

    const discrepancyCounts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(would_trade) AS would_trade,
           SUM(CASE WHEN sampled_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS last_24h
         FROM discrepancy`,
      )
      .get() as { total: number; would_trade: number; last_24h: number };

    return {
      phase: 'phase-1-observer',
      trading: false,
      bankroll: this.simulator.summary(),
      markets: {
        tracked: marketCounts.total ?? 0,
        active: marketCounts.active ?? 0,
        settled: marketCounts.settled ?? 0,
      },
      discrepancies: {
        total: discrepancyCounts.total ?? 0,
        wouldTradeTotal: discrepancyCounts.would_trade ?? 0,
        last24h: discrepancyCounts.last_24h ?? 0,
      },
    };
  }

  listDiscrepancies(
    params: {
      since?: string;
      wouldTradeOnly?: boolean;
      limit?: number;
    } = {},
  ): DiscrepancyView[] {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (params.since) {
      clauses.push('sampled_at >= ?');
      args.push(params.since);
    }
    if (params.wouldTradeOnly) {
      clauses.push('would_trade = 1');
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `SELECT id, market_ticker, sampled_at, market_implied_p, weather_implied_p,
                edge, would_trade, simulated_side, simulated_size_usd,
                simulated_fill_price, reasoning
         FROM discrepancy
         ${where}
         ORDER BY sampled_at DESC, id DESC
         LIMIT ${limit}`,
      )
      .all(...args) as Array<{
      id: number;
      market_ticker: string;
      sampled_at: string;
      market_implied_p: number;
      weather_implied_p: number;
      edge: number;
      would_trade: number;
      simulated_side: string | null;
      simulated_size_usd: number | null;
      simulated_fill_price: number | null;
      reasoning: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      market_ticker: r.market_ticker,
      sampled_at: r.sampled_at,
      market_implied_p: r.market_implied_p,
      weather_implied_p: r.weather_implied_p,
      edge: r.edge,
      would_trade: !!r.would_trade,
      side: r.simulated_side,
      size_usd: r.simulated_size_usd,
      fill_price: r.simulated_fill_price,
      reasoning: r.reasoning,
    }));
  }

  listMarkets(params: { status?: string } = {}): unknown[] {
    if (params.status) {
      return this.db
        .prepare('SELECT * FROM kalshi_market WHERE status = ? ORDER BY ticker')
        .all(params.status);
    }
    return this.db.prepare('SELECT * FROM kalshi_market ORDER BY ticker').all();
  }

  listPositions(params: { status?: 'open' | 'closed' } = {}): PositionView[] {
    let where = '';
    if (params.status === 'open') where = 'WHERE closed_at IS NULL';
    if (params.status === 'closed') where = 'WHERE closed_at IS NOT NULL';
    return this.db
      .prepare(
        `SELECT id, market_ticker, opened_at, side, size_usd, entry_price,
                closed_at, resolution_outcome, realized_pnl_usd
         FROM simulated_position
         ${where}
         ORDER BY opened_at DESC`,
      )
      .all() as PositionView[];
  }

  /**
   * Mapping errors: closed positions whose signal was definitive (weather
   * probability was 0 or 1 at the time we opened) but the actual resolution
   * disagreed — i.e. we lost a paper position we thought we had locked in.
   *
   * These are the cases that should make us tighten station mapping,
   * METAR-vs-CLI safety margins, or CLI parsing logic.
   */
  listMappingErrors(): MappingErrorView[] {
    // For each closed losing position, find the discrepancy row that opened
    // it by matching sampled_at == opened_at (they're set to the same
    // timestamp by DiscrepancyService.scanAll).
    const rows = this.db
      .prepare(
        `SELECT
           p.id AS position_id,
           p.market_ticker,
           p.opened_at,
           p.side,
           p.entry_price,
           p.resolution_outcome,
           p.realized_pnl_usd,
           d.weather_implied_p AS weather_implied_p_at_open,
           d.reasoning AS reasoning_at_open
         FROM simulated_position p
         LEFT JOIN discrepancy d
           ON d.market_ticker = p.market_ticker
          AND d.sampled_at = p.opened_at
         WHERE p.closed_at IS NOT NULL
           AND p.realized_pnl_usd < 0
           AND d.weather_implied_p IN (0.0, 1.0)
         ORDER BY p.closed_at DESC`,
      )
      .all() as MappingErrorView[];
    return rows;
  }
}
