import { Injectable } from '@nestjs/common';
import {
  AlpacaObserverRepository,
  CondorPositionRow,
  EntryDecisionRow,
  SignalSampleRow,
} from '../storage/alpaca-observer.repository';

/**
 * Read-only query layer for the alpaca-observer's HTTP inspection endpoints.
 * Pure SELECT — never mutates state.
 */

export interface AlpacaObserverSummary {
  phase: string;
  trading: string;
  scheduler: 'enabled' | 'disabled';
  dryRun: boolean;
  credentialsLoaded: boolean;
  positions: {
    total: number;
    open: number;
    closed: number;
    errored: number;
  };
  pnl: {
    realizedTotal: number;
    closedCount: number;
    winRate: number | null;
    averageRealizedPerPosition: number | null;
  };
  recentSignal: SignalSampleRow | null;
}

interface RawDb {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
}

@Injectable()
export class AlpacaReportingService {
  constructor(private readonly repo: AlpacaObserverRepository) {}

  private get db(): RawDb {
    return (this.repo as unknown as { db: RawDb }).db;
  }

  getSummary(): AlpacaObserverSummary {
    const counts = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status IN ('open','pending','closing') THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN status IN ('closed_expired','closed_stop','closed_manual') THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN status = 'errored' THEN 1 ELSE 0 END) AS errored
         FROM condor_position`,
      )
      .get() as {
      total: number;
      open: number;
      closed: number;
      errored: number;
    };

    const pnl = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(realized_pnl), 0) AS total,
           COUNT(realized_pnl) AS closed_count,
           SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS wins
         FROM condor_position
         WHERE realized_pnl IS NOT NULL`,
      )
      .get() as { total: number; closed_count: number; wins: number };

    const recentSignal = this.db
      .prepare('SELECT * FROM signal_sample ORDER BY sampled_at DESC LIMIT 1')
      .get() as SignalSampleRow | undefined;

    return {
      phase: 'phase-1-paper',
      trading: 'paper-only-never-live',
      scheduler:
        (process.env.ALPACA_OBSERVER_ENABLED ?? 'false').toLowerCase() ===
        'true'
          ? 'enabled'
          : 'disabled',
      dryRun:
        (process.env.ALPACA_OBSERVER_DRY_RUN ?? 'true').toLowerCase() !==
        'false',
      credentialsLoaded: !!process.env.ALPACA_API_KEY_ID,
      positions: {
        total: counts.total ?? 0,
        open: counts.open ?? 0,
        closed: counts.closed ?? 0,
        errored: counts.errored ?? 0,
      },
      pnl: {
        realizedTotal: pnl.total ?? 0,
        closedCount: pnl.closed_count ?? 0,
        winRate: pnl.closed_count > 0 ? pnl.wins / pnl.closed_count : null,
        averageRealizedPerPosition:
          pnl.closed_count > 0 ? pnl.total / pnl.closed_count : null,
      },
      recentSignal: recentSignal ?? null,
    };
  }

  listPositions(params: { status?: string } = {}): CondorPositionRow[] {
    return this.repo.listPositions(params);
  }

  listRecentSignals(limit = 50): SignalSampleRow[] {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    return this.db
      .prepare(
        `SELECT * FROM signal_sample ORDER BY sampled_at DESC LIMIT ${safeLimit}`,
      )
      .all() as SignalSampleRow[];
  }

  listRecentDecisions(limit = 50): EntryDecisionRow[] {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    return this.db
      .prepare(
        `SELECT * FROM entry_decision ORDER BY decided_at DESC LIMIT ${safeLimit}`,
      )
      .all() as EntryDecisionRow[];
  }
}
