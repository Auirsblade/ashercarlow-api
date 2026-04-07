import { Injectable, Logger } from '@nestjs/common';
import {
  ObserverRepository,
  PriceSampleRow,
  TrackedMarketRow,
} from '../storage/observer.repository';

/**
 * Paper-trading simulator. Consumes eligible discrepancies from the
 * DiscrepancyService and records hypothetical positions in the
 * `simulated_position` table. **No real trades. Ever.**
 *
 * Sizing model:
 *   - Starting bankroll:      $1000 (hardcoded; Phase 1 is a measurement tool)
 *   - Free bankroll at any time:
 *         1000
 *       + sum(realized_pnl on closed positions)
 *       - sum(size_usd on currently open positions)
 *   - Position size:           5% of free bankroll, floored at $10, capped at $50
 *   - Minimum bankroll to open a new position: $20
 *
 * Fill model:
 *   - Buying YES: pay yes_ask (cross the spread)
 *   - Buying NO:  pay no_ask
 *   - Size in dollars; contracts = size_usd / entry_price
 *
 * PnL on resolution (`outcome` is 'yes' or 'no'):
 *   - win  (side === outcome): realized = contracts * (1 - entry_price)
 *   - lose (side !== outcome): realized = -size_usd
 *
 * Phase 1 assumptions:
 *   - Void/refund resolutions are treated as PnL = 0.
 *   - Partial fills and slippage beyond the posted ask are not modeled.
 *     Paper-traded sizes are small enough ($10–$50) that a real Kalshi
 *     book will almost always absorb them at the posted ask. If we later
 *     scale up, we'd need to model depth.
 */

const STARTING_BANKROLL_USD = 1000;
const POSITION_SIZE_FRACTION = 0.05;
const MIN_POSITION_USD = 10;
const MAX_POSITION_USD = 50;
const MIN_BANKROLL_TO_OPEN = 20;

export interface OpenedPosition {
  id: number;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsd: number;
  freeBankrollAfter: number;
}

export interface BankrollSummary {
  starting: number;
  realizedPnl: number;
  openExposure: number;
  freeBankroll: number;
  openPositions: number;
  closedPositions: number;
  winRate: number | null;
}

@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(private readonly repo: ObserverRepository) {}

  /**
   * Open a paper position for a market that passed discrepancy filters.
   * Returns the opened position, or null if bankroll is too low or
   * inputs are invalid. Idempotent against concurrent callers only if
   * guarded by the discrepancy service's existing-position check.
   */
  tryOpen(
    market: TrackedMarketRow,
    price: PriceSampleRow,
    side: 'yes' | 'no',
    sampledAt: string,
  ): OpenedPosition | null {
    const entryPrice = side === 'yes' ? price.yes_ask : price.no_ask;
    if (entryPrice == null || entryPrice <= 0 || entryPrice >= 1) {
      this.logger.warn(
        `Refusing to open ${market.ticker}: invalid ${side}_ask=${entryPrice}`,
      );
      return null;
    }

    const free = this.computeFreeBankroll();
    if (free < MIN_BANKROLL_TO_OPEN) {
      this.logger.warn(
        `Refusing to open ${market.ticker}: free bankroll $${free.toFixed(2)} < min $${MIN_BANKROLL_TO_OPEN}`,
      );
      return null;
    }

    const raw = free * POSITION_SIZE_FRACTION;
    const sizeUsd = Math.min(MAX_POSITION_USD, Math.max(MIN_POSITION_USD, raw));

    const id = this.repo.openPosition({
      market_ticker: market.ticker,
      opened_at: sampledAt,
      side,
      size_usd: sizeUsd,
      entry_price: entryPrice,
    });

    this.logger.log(
      `Opened paper ${side.toUpperCase()} ${market.ticker} ` +
        `$${sizeUsd.toFixed(2)} @ ${entryPrice.toFixed(3)}; ` +
        `free bankroll now $${(free - sizeUsd).toFixed(2)}`,
    );

    return {
      id,
      side,
      entryPrice,
      sizeUsd,
      freeBankrollAfter: free - sizeUsd,
    };
  }

  /**
   * Close an open position at resolution. `outcome` is the side that won
   * per the authoritative resolution source. Returns the realized PnL.
   */
  closePosition(
    positionId: number,
    outcome: 'yes' | 'no' | 'void',
    closedAtIso: string,
  ): number {
    const pos = this.findPositionById(positionId);
    if (!pos) {
      this.logger.warn(`Cannot close unknown position id=${positionId}`);
      return 0;
    }
    const pnl = this.computePnl(
      pos.side,
      pos.entry_price,
      pos.size_usd,
      outcome,
    );
    this.repo.closePosition(positionId, closedAtIso, outcome, pnl);
    this.logger.log(
      `Closed ${pos.market_ticker} side=${pos.side} outcome=${outcome} pnl=$${pnl.toFixed(2)}`,
    );
    return pnl;
  }

  computePnl(
    side: 'yes' | 'no',
    entryPrice: number,
    sizeUsd: number,
    outcome: 'yes' | 'no' | 'void',
  ): number {
    if (outcome === 'void') return 0;
    const contracts = sizeUsd / entryPrice;
    const won = side === outcome;
    return won ? contracts * (1 - entryPrice) : -sizeUsd;
  }

  /**
   * Current free bankroll = starting + realized PnL (closed) - exposure on open positions.
   */
  computeFreeBankroll(): number {
    return (
      STARTING_BANKROLL_USD +
      this.sumClosedRealizedPnl() -
      this.sumOpenExposure()
    );
  }

  summary(): BankrollSummary {
    const realizedPnl = this.sumClosedRealizedPnl();
    const openExposure = this.sumOpenExposure();
    const free = STARTING_BANKROLL_USD + realizedPnl - openExposure;
    const closed = this.countClosedPositions();
    const wins = this.countWins();

    return {
      starting: STARTING_BANKROLL_USD,
      realizedPnl,
      openExposure,
      freeBankroll: free,
      openPositions: this.repo.listOpenPositions().length,
      closedPositions: closed,
      winRate: closed > 0 ? wins / closed : null,
    };
  }

  // ---------- internal queries ----------

  private sumClosedRealizedPnl(): number {
    const row = this.rawSingleNumber(
      `SELECT COALESCE(SUM(realized_pnl_usd), 0) AS v
       FROM simulated_position
       WHERE closed_at IS NOT NULL`,
    );
    return row ?? 0;
  }

  private sumOpenExposure(): number {
    const row = this.rawSingleNumber(
      `SELECT COALESCE(SUM(size_usd), 0) AS v
       FROM simulated_position
       WHERE closed_at IS NULL`,
    );
    return row ?? 0;
  }

  private countClosedPositions(): number {
    return (
      this.rawSingleNumber(
        `SELECT COUNT(*) AS v
         FROM simulated_position
         WHERE closed_at IS NOT NULL`,
      ) ?? 0
    );
  }

  private countWins(): number {
    return (
      this.rawSingleNumber(
        `SELECT COUNT(*) AS v
         FROM simulated_position
         WHERE closed_at IS NOT NULL
           AND realized_pnl_usd > 0`,
      ) ?? 0
    );
  }

  private findPositionById(id: number):
    | {
        market_ticker: string;
        side: 'yes' | 'no';
        entry_price: number;
        size_usd: number;
      }
    | undefined {
    const db = (
      this.repo as unknown as {
        db: {
          prepare: (s: string) => { get: (...args: unknown[]) => unknown };
        };
      }
    ).db;
    return db
      .prepare(
        `SELECT market_ticker, side, entry_price, size_usd
         FROM simulated_position
         WHERE id = ?`,
      )
      .get(id) as
      | {
          market_ticker: string;
          side: 'yes' | 'no';
          entry_price: number;
          size_usd: number;
        }
      | undefined;
  }

  private rawSingleNumber(sql: string): number | null {
    const db = (
      this.repo as unknown as {
        db: {
          prepare: (s: string) => { get: () => { v: number } | undefined };
        };
      }
    ).db;
    const row = db.prepare(sql).get();
    return row?.v ?? null;
  }
}
