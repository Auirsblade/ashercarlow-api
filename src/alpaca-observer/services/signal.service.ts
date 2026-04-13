import { Injectable, Logger } from '@nestjs/common';
import { AlpacaClient, StockBar } from '../clients/alpaca.client';
import { MarketDataClient } from '../clients/market-data.client';
import {
  AlpacaObserverRepository,
  SignalSampleRow,
} from '../storage/alpaca-observer.repository';

/**
 * Decides whether the current vol regime is favorable for opening a new
 * iron condor cycle. Implements the gating logic from Step 0 discovery:
 *
 *   - VIX between 12 and 35: favorable
 *   - VIX < 12: vol_too_low (premium too thin to bother)
 *   - VIX > 35: vol_too_high (tail-risk regime; new positions are dangerous)
 *
 * The decision uses VIX as the primary regime gate, with VRP (VIX minus
 * SPY 30-day realized vol) as an informational diagnostic. We persist
 * everything as a `signal_sample` row so we can post-hoc analyze whether
 * the gate was right.
 */

const VIX_FAVORABLE_MIN = 12;
const VIX_FAVORABLE_MAX = 35;
const RV_WINDOW_DAYS = 30;
const TRADING_DAYS_PER_YEAR = 252;

export interface SignalSnapshot {
  sampledAt: string;
  spySpot: number | null;
  vix: number | null;
  rv30: number | null;
  vrp: number | null;
  regime: 'favorable' | 'vol_too_low' | 'vol_too_high' | 'unknown';
  entryEligible: boolean;
  reason: string;
}

@Injectable()
export class SignalService {
  private readonly logger = new Logger(SignalService.name);

  constructor(
    private readonly alpaca: AlpacaClient,
    private readonly marketData: MarketDataClient,
    private readonly repo: AlpacaObserverRepository,
  ) {}

  /**
   * Compute the current signal snapshot. Persists a signal_sample row.
   * Returns the snapshot for callers (e.g. the entry decider).
   */
  async evaluate(): Promise<SignalSnapshot> {
    const sampledAt = new Date().toISOString();

    let vix: number | null = null;
    let spySpot: number | null = null;
    let rv30: number | null = null;
    const errors: string[] = [];

    try {
      const latest = await this.marketData.getLatestVix();
      vix = latest?.close ?? null;
    } catch (err) {
      errors.push(`vix: ${err instanceof Error ? err.message : String(err)}`);
    }

    let bars: StockBar[] = [];
    try {
      bars = await this.alpaca.getStockBars('SPY', {
        timeframe: '1Day',
        limit: RV_WINDOW_DAYS + 5,
      });
      if (bars.length > 0) {
        spySpot = bars[bars.length - 1].close;
      }
      rv30 = this.computeRealizedVol(bars, RV_WINDOW_DAYS);
    } catch (err) {
      errors.push(`spy: ${err instanceof Error ? err.message : String(err)}`);
    }

    const vrp = vix != null && rv30 != null ? vix - rv30 : null;
    const { regime, entryEligible, reason } = this.classifyRegime(
      vix,
      vrp,
      errors,
    );

    const row: SignalSampleRow = {
      sampled_at: sampledAt,
      spy_spot: spySpot,
      vix,
      rv30,
      vrp,
      regime,
      entry_eligible: entryEligible ? 1 : 0,
    };
    this.repo.insertSignalSample(row);

    if (errors.length > 0) {
      this.logger.warn(
        `Signal evaluation completed with errors: ${errors.join(', ')}`,
      );
    } else {
      this.logger.log(
        `Signal: VIX=${vix?.toFixed(2)} RV=${rv30?.toFixed(2)} VRP=${vrp?.toFixed(2)} regime=${regime} eligible=${entryEligible}`,
      );
    }

    return {
      sampledAt,
      spySpot,
      vix,
      rv30,
      vrp,
      regime,
      entryEligible,
      reason,
    };
  }

  /**
   * Compute annualized realized volatility from a sequence of daily closes.
   * Uses log returns and the standard √252 annualization. Returns volatility
   * in vol points (not decimals) for direct comparison to VIX (which is
   * also quoted in vol points).
   */
  computeRealizedVol(bars: StockBar[], window: number): number | null {
    if (bars.length < window + 1) return null;
    const tail = bars.slice(-(window + 1));
    const returns: number[] = [];
    for (let i = 1; i < tail.length; i++) {
      const prev = tail[i - 1].close;
      const curr = tail[i].close;
      if (prev > 0 && curr > 0) {
        returns.push(Math.log(curr / prev));
      }
    }
    if (returns.length === 0) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
    const dailyStdev = Math.sqrt(variance);
    const annualized = dailyStdev * Math.sqrt(TRADING_DAYS_PER_YEAR);
    // Convert from decimal (e.g. 0.18) to vol points (18.0)
    return annualized * 100;
  }

  private classifyRegime(
    vix: number | null,
    _vrp: number | null,
    errors: string[],
  ): {
    regime: SignalSnapshot['regime'];
    entryEligible: boolean;
    reason: string;
  } {
    if (errors.length > 0) {
      return {
        regime: 'unknown',
        entryEligible: false,
        reason: `data_errors: ${errors.join('; ')}`,
      };
    }
    if (vix == null) {
      return {
        regime: 'unknown',
        entryEligible: false,
        reason: 'no_vix_data',
      };
    }
    if (vix < VIX_FAVORABLE_MIN) {
      return {
        regime: 'vol_too_low',
        entryEligible: false,
        reason: `vix_${vix.toFixed(2)}_below_${VIX_FAVORABLE_MIN}`,
      };
    }
    if (vix > VIX_FAVORABLE_MAX) {
      return {
        regime: 'vol_too_high',
        entryEligible: false,
        reason: `vix_${vix.toFixed(2)}_above_${VIX_FAVORABLE_MAX}`,
      };
    }
    return {
      regime: 'favorable',
      entryEligible: true,
      reason: `vix_${vix.toFixed(2)}_in_favorable_range`,
    };
  }
}
