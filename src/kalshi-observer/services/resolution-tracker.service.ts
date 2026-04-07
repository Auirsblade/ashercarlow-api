import { Injectable, Logger } from '@nestjs/common';
import { KalshiClient, KalshiMarket } from '../clients/kalshi.client';
import { ObserverRepository } from '../storage/observer.repository';
import { SimulatorService } from './simulator.service';

/**
 * Polls Kalshi for settled markets that match open paper positions and
 * closes them via the simulator. Also backfills the market row's `status`
 * to `settled`/`finalized` in our DB so scanAll stops evaluating it.
 *
 * Phase 1 scope:
 *   - Close paper positions when the market's `result` field is populated
 *     with `yes`, `no`, or `void`.
 *   - Log the realized outcome so we can correlate with the signal that
 *     opened the position (the discrepancy row).
 *
 * Phase 1 deferred:
 *   - Mapping-error detection (comparing our METAR-based prediction to
 *     the actual resolution). The data is all there in the discrepancy +
 *     simulated_position rows already; a standalone reporting query in
 *     Step 8 can compute this without any schema change here.
 */
@Injectable()
export class ResolutionTrackerService {
  private readonly logger = new Logger(ResolutionTrackerService.name);

  constructor(
    private readonly repo: ObserverRepository,
    private readonly kalshi: KalshiClient,
    private readonly simulator: SimulatorService,
  ) {}

  async checkResolutions(): Promise<{
    openPositionsChecked: number;
    closed: number;
    errors: number;
  }> {
    const open = this.repo.listOpenPositions();
    if (open.length === 0) {
      return { openPositionsChecked: 0, closed: 0, errors: 0 };
    }

    let closed = 0;
    let errors = 0;
    const nowIso = new Date().toISOString();

    for (const pos of open) {
      try {
        const market = await this.kalshi.getMarket(pos.market_ticker);
        if (!this.isSettled(market)) continue;

        const outcome = this.parseOutcome(market.result);
        if (!outcome) {
          this.logger.warn(
            `Market ${pos.market_ticker} is settled but result="${market.result}" is not parseable`,
          );
          continue;
        }

        if (pos.id != null) {
          this.simulator.closePosition(pos.id, outcome, nowIso);
          closed++;
        }

        // Also update the tracked market's status so future scans ignore it.
        const stored = this.repo.getMarket(pos.market_ticker);
        if (stored && stored.status !== market.status) {
          this.repo.upsertMarket({
            ...stored,
            status: market.status ?? 'settled',
            last_seen_at: nowIso,
          });
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          `Failed to check resolution for ${pos.market_ticker}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(
      `Resolution check: ${open.length} open positions, ${closed} closed, ${errors} errors`,
    );

    return { openPositionsChecked: open.length, closed, errors };
  }

  private isSettled(market: KalshiMarket): boolean {
    const status = market.status ?? '';
    return (
      status === 'settled' || status === 'finalized' || status === 'determined'
    );
  }

  private parseOutcome(result?: string): 'yes' | 'no' | 'void' | null {
    if (!result) return null;
    const r = result.trim().toLowerCase();
    if (r === 'yes') return 'yes';
    if (r === 'no') return 'no';
    if (r === 'void' || r === 'voided' || r === 'no_contest') return 'void';
    return null;
  }
}
