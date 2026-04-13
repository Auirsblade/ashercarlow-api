import { Injectable, Logger } from '@nestjs/common';
import { AlpacaClient, AlpacaOptionSnapshot } from '../clients/alpaca.client';

/**
 * Picks the four strikes for an iron condor from a live SPY option chain.
 *
 * Strategy spec (locked from Step 0 discovery):
 *   - Short put at ~0.20 delta (delta is negative for puts; we match |delta|)
 *   - Long put 5 points below short put (cheaper, defines max loss)
 *   - Short call at ~0.20 delta
 *   - Long call 5 points above short call
 *   - DTE at entry: 30-45 days
 *
 * If exact-delta strikes aren't available, snap to the nearest available
 * delta. If wing strikes (long puts/calls at -5 / +5) don't exist in the
 * chain, fall back to the nearest available strike at-or-beyond the
 * desired wing distance.
 *
 * Returns null if any required leg can't be located, with the reason
 * logged. Better to skip a cycle than to enter a malformed condor.
 */

const TARGET_DELTA = 0.2;
const WING_WIDTH_POINTS = 5;
const TARGET_DTE_MIN = 30;
const TARGET_DTE_MAX = 45;

export interface CondorTarget {
  expirationDate: string;
  shortPut: AlpacaOptionSnapshot;
  longPut: AlpacaOptionSnapshot;
  shortCall: AlpacaOptionSnapshot;
  longCall: AlpacaOptionSnapshot;
  /** Estimated net credit per contract in dollars (sell shorts, buy longs, mids) */
  estimatedCredit: number;
  /** Maximum loss per contract = (wing_width × 100) − (credit × 100) */
  maxLoss: number;
}

export interface ChainSelectionFailure {
  reason: string;
  details?: Record<string, unknown>;
}

export type ChainSelectionResult =
  | { ok: true; target: CondorTarget }
  | { ok: false; failure: ChainSelectionFailure };

@Injectable()
export class ChainSelectorService {
  private readonly logger = new Logger(ChainSelectorService.name);

  constructor(private readonly alpaca: AlpacaClient) {}

  /**
   * Pick the iron condor target for SPY for the next eligible expiration.
   * `now` is injectable so the caller can run this against historical
   * dates in tests.
   */
  async selectCondorTarget(
    underlying: string,
    now: Date = new Date(),
  ): Promise<ChainSelectionResult> {
    // Step 1: pick the expiration date.
    const expirations = await this.discoverEligibleExpirations(underlying, now);
    if (expirations.length === 0) {
      return {
        ok: false,
        failure: { reason: 'no_eligible_expiration_in_dte_range' },
      };
    }
    // Prefer the expiration nearest the middle of the DTE range (~37).
    const targetExpiration = this.pickPreferredExpiration(expirations, now);

    // Step 2: pull the chain for that expiration.
    const chain = await this.alpaca.getOptionChain(underlying, {
      expirationDate: targetExpiration,
    });
    if (chain.length === 0) {
      return {
        ok: false,
        failure: {
          reason: 'empty_chain',
          details: { expiration: targetExpiration },
        },
      };
    }

    return this.pickStrikesFromChain(chain, targetExpiration);
  }

  /**
   * Pure strike-picking logic separated so it can be unit-tested with
   * fixture chains without hitting the API.
   */
  pickStrikesFromChain(
    chain: AlpacaOptionSnapshot[],
    expirationDate: string,
  ): ChainSelectionResult {
    const puts = chain
      .filter((c) => c.type === 'put' && c.greeks?.delta != null)
      .sort((a, b) => b.strikePrice - a.strikePrice); // descending
    const calls = chain
      .filter((c) => c.type === 'call' && c.greeks?.delta != null)
      .sort((a, b) => a.strikePrice - b.strikePrice); // ascending

    if (puts.length === 0 || calls.length === 0) {
      return {
        ok: false,
        failure: {
          reason: 'no_strikes_with_greeks',
          details: { puts: puts.length, calls: calls.length },
        },
      };
    }

    // Find short put: delta closest to -0.20 (puts have negative delta)
    const shortPut = puts.reduce((best, c) => {
      const bestDist = Math.abs(Math.abs(best.greeks!.delta!) - TARGET_DELTA);
      const cDist = Math.abs(Math.abs(c.greeks!.delta!) - TARGET_DELTA);
      return cDist < bestDist ? c : best;
    });

    // Find long put: lowest strike at or below (shortPut.strike - 5)
    const longPutTargetStrike = shortPut.strikePrice - WING_WIDTH_POINTS;
    const longPut = puts
      .filter((c) => c.strikePrice <= longPutTargetStrike)
      .reduce<AlpacaOptionSnapshot | null>(
        (best, c) =>
          best == null || c.strikePrice > best.strikePrice ? c : best,
        null,
      );
    if (!longPut) {
      return {
        ok: false,
        failure: {
          reason: 'long_put_wing_unavailable',
          details: {
            shortPutStrike: shortPut.strikePrice,
            target: longPutTargetStrike,
          },
        },
      };
    }

    // Find short call: delta closest to +0.20
    const shortCall = calls.reduce((best, c) => {
      const bestDist = Math.abs((best.greeks!.delta ?? 0) - TARGET_DELTA);
      const cDist = Math.abs((c.greeks!.delta ?? 0) - TARGET_DELTA);
      return cDist < bestDist ? c : best;
    });

    // Find long call: lowest strike at or above (shortCall.strike + 5)
    const longCallTargetStrike = shortCall.strikePrice + WING_WIDTH_POINTS;
    const longCall = calls
      .filter((c) => c.strikePrice >= longCallTargetStrike)
      .reduce<AlpacaOptionSnapshot | null>(
        (best, c) =>
          best == null || c.strikePrice < best.strikePrice ? c : best,
        null,
      );
    if (!longCall) {
      return {
        ok: false,
        failure: {
          reason: 'long_call_wing_unavailable',
          details: {
            shortCallStrike: shortCall.strikePrice,
            target: longCallTargetStrike,
          },
        },
      };
    }

    // Sanity check: short put should be below short call (otherwise we have
    // an inverted condor, which is a bug, not a strategy).
    if (shortPut.strikePrice >= shortCall.strikePrice) {
      return {
        ok: false,
        failure: {
          reason: 'inverted_condor',
          details: {
            shortPut: shortPut.strikePrice,
            shortCall: shortCall.strikePrice,
          },
        },
      };
    }

    const credit = this.estimateNetCredit(
      shortPut,
      longPut,
      shortCall,
      longCall,
    );
    if (credit == null) {
      return {
        ok: false,
        failure: { reason: 'unable_to_estimate_credit' },
      };
    }

    const wingWidth =
      Math.min(
        shortPut.strikePrice - longPut.strikePrice,
        longCall.strikePrice - shortCall.strikePrice,
      ) * 100;
    const maxLoss = wingWidth - credit * 100;

    return {
      ok: true,
      target: {
        expirationDate,
        shortPut,
        longPut,
        shortCall,
        longCall,
        estimatedCredit: credit,
        maxLoss,
      },
    };
  }

  /**
   * Estimate the net credit (per contract, in dollars) for the condor
   * using mid prices from each leg's snapshot. Sells receive credit,
   * buys pay debit.
   */
  estimateNetCredit(
    shortPut: AlpacaOptionSnapshot,
    longPut: AlpacaOptionSnapshot,
    shortCall: AlpacaOptionSnapshot,
    longCall: AlpacaOptionSnapshot,
  ): number | null {
    const mids: Record<string, number | null> = {
      shortPut: this.midOf(shortPut),
      longPut: this.midOf(longPut),
      shortCall: this.midOf(shortCall),
      longCall: this.midOf(longCall),
    };
    if (Object.values(mids).some((m) => m == null)) return null;
    return (
      (mids.shortPut as number) +
      (mids.shortCall as number) -
      ((mids.longPut as number) + (mids.longCall as number))
    );
  }

  private midOf(snapshot: AlpacaOptionSnapshot): number | null {
    const q = snapshot.latestQuote;
    if (!q || q.bid == null || q.ask == null || q.bid <= 0 || q.ask <= 0) {
      return null;
    }
    return (q.bid + q.ask) / 2;
  }

  private async discoverEligibleExpirations(
    underlying: string,
    now: Date,
  ): Promise<string[]> {
    // Pull the full nearby chain (no expiration filter) and extract distinct
    // expirations within the DTE range. Alpaca caps response sizes; for SPY
    // the chain is large but the snapshots endpoint paginates.
    const chain = await this.alpaca.getOptionChain(underlying);
    const distinctExpirations = new Set<string>();
    for (const c of chain) {
      distinctExpirations.add(c.expirationDate);
    }
    const eligible: string[] = [];
    for (const exp of distinctExpirations) {
      const dte = this.daysBetween(now, new Date(exp));
      if (dte >= TARGET_DTE_MIN && dte <= TARGET_DTE_MAX) {
        eligible.push(exp);
      }
    }
    eligible.sort();
    return eligible;
  }

  private pickPreferredExpiration(expirations: string[], now: Date): string {
    const middle = (TARGET_DTE_MIN + TARGET_DTE_MAX) / 2;
    let best = expirations[0];
    let bestDist = Math.abs(this.daysBetween(now, new Date(best)) - middle);
    for (const exp of expirations.slice(1)) {
      const dte = this.daysBetween(now, new Date(exp));
      const dist = Math.abs(dte - middle);
      if (dist < bestDist) {
        best = exp;
        bestDist = dist;
      }
    }
    return best;
  }

  private daysBetween(a: Date, b: Date): number {
    const ms = b.getTime() - a.getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }
}
