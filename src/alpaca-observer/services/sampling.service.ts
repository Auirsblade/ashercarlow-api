import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlpacaClient } from '../clients/alpaca.client';
import { AlpacaObserverRepository } from '../storage/alpaca-observer.repository';
import { ChainSelectorService } from './chain-selector.service';
import { ExecutionService } from './execution.service';
import { SignalService } from './signal.service';

/**
 * Periodic loop for the Alpaca iron condor observer.
 *
 * Cadences (much slower than Kalshi observer because options strategies
 * are inherently lower-frequency):
 *
 *   tickSignal           every 60 min  - sample VRP regime
 *   tickEntryDecision    every 6 hours - check if cycle should be opened
 *   tickMarkToMarket     every 60 min  - mark all open positions
 *   tickAccountSnapshot  every 6 hours - snapshot bankroll
 *   tickExpireSweep      every 6 hours - close positions near expiry
 *
 * Each tick is concurrency-guarded and gated by ALPACA_OBSERVER_ENABLED
 * (default false — opposite of kalshi-observer because this module places
 * actual orders even in paper mode).
 *
 * SAFETY:
 *   - Default disabled. The user must explicitly set
 *     ALPACA_OBSERVER_ENABLED=true to start the cron loop.
 *   - Even when enabled, ExecutionService is in DRY-RUN mode by default.
 *     Both flags must be set for any real Alpaca submissions.
 */
@Injectable()
export class AlpacaSamplingService implements OnModuleInit {
  private readonly logger = new Logger(AlpacaSamplingService.name);

  private signalRunning = false;
  private entryRunning = false;
  private mtmRunning = false;
  private accountRunning = false;
  private expireRunning = false;

  /** Default DISABLED. Set ALPACA_OBSERVER_ENABLED=true to start. */
  private readonly enabled =
    (process.env.ALPACA_OBSERVER_ENABLED ?? 'false').toLowerCase() === 'true';

  constructor(
    private readonly signal: SignalService,
    private readonly chainSelector: ChainSelectorService,
    private readonly execution: ExecutionService,
    private readonly alpaca: AlpacaClient,
    private readonly repo: AlpacaObserverRepository,
  ) {}

  onModuleInit(): void {
    this.logger.log('─'.repeat(70));
    this.logger.log('Alpaca iron condor observer — Phase 1 (PAPER ONLY)');
    this.logger.log(
      `  Scheduler:       ${this.enabled ? 'ENABLED' : 'DISABLED (set ALPACA_OBSERVER_ENABLED=true)'}`,
    );
    this.logger.log(
      `  Live trading:    NEVER (AlpacaClient refuses live trading hostname)`,
    );
    this.logger.log(
      `  Order submission: ${process.env.ALPACA_OBSERVER_DRY_RUN === 'false' ? 'LIVE PAPER (orders go to Alpaca)' : 'DRY-RUN (DB only)'}`,
    );
    this.logger.log(
      `  Alpaca creds:    ${process.env.ALPACA_API_KEY_ID ? 'loaded' : 'NOT SET (any submission will fail)'}`,
    );
    this.logger.log('─'.repeat(70));
  }

  // ---------- @Interval ticks ----------

  @Interval('alpaca-signal', 60 * 60 * 1000) // 60 min
  async tickSignal(): Promise<void> {
    if (!this.enabled || this.signalRunning) return;
    this.signalRunning = true;
    try {
      await this.signal.evaluate();
    } catch (err) {
      this.logger.error(
        `Signal tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.signalRunning = false;
    }
  }

  @Interval('alpaca-entry', 6 * 60 * 60 * 1000) // 6 hours
  async tickEntryDecision(): Promise<void> {
    if (!this.enabled || this.entryRunning) return;
    this.entryRunning = true;
    try {
      await this.evaluateEntry();
    } catch (err) {
      this.logger.error(
        `Entry decision tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.entryRunning = false;
    }
  }

  @Interval('alpaca-mtm', 60 * 60 * 1000) // 60 min
  async tickMarkToMarket(): Promise<void> {
    if (!this.enabled || this.mtmRunning) return;
    this.mtmRunning = true;
    try {
      await this.markAllOpenPositions();
    } catch (err) {
      this.logger.error(
        `Mark-to-market tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.mtmRunning = false;
    }
  }

  @Interval('alpaca-account', 6 * 60 * 60 * 1000) // 6 hours
  async tickAccountSnapshot(): Promise<void> {
    if (!this.enabled || this.accountRunning) return;
    this.accountRunning = true;
    try {
      await this.snapshotAccount();
    } catch (err) {
      this.logger.error(
        `Account snapshot tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.accountRunning = false;
    }
  }

  @Interval('alpaca-expire', 6 * 60 * 60 * 1000) // 6 hours
  async tickExpireSweep(): Promise<void> {
    if (!this.enabled || this.expireRunning) return;
    this.expireRunning = true;
    try {
      await this.execution.expireSweep();
    } catch (err) {
      this.logger.error(
        `Expire sweep tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.expireRunning = false;
    }
  }

  // ---------- public methods (callable directly for tests + smoke) ----------

  /**
   * Decide whether to open a new condor for the current cycle.
   * Idempotency is enforced via the `entry_decision` table — only one
   * decision per cycle_month, regardless of how many times this is called.
   */
  async evaluateEntry(now: Date = new Date()): Promise<{
    cycleMonth: string;
    decision: 'open' | 'skip';
    reason: string;
    positionId: number | null;
  }> {
    const cycleMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const decidedAt = now.toISOString();

    // Idempotency check.
    if (this.repo.hasDecisionForCycle(cycleMonth)) {
      return {
        cycleMonth,
        decision: 'skip',
        reason: 'cycle_already_decided',
        positionId: null,
      };
    }

    // Check signal regime first — cheap check before pulling chain.
    const signal = await this.signal.evaluate();
    if (!signal.entryEligible) {
      this.repo.insertEntryDecision({
        cycle_month: cycleMonth,
        decided_at: decidedAt,
        decision: 'skip',
        reason: signal.reason,
        position_id: null,
      });
      this.logger.log(`Entry skip ${cycleMonth}: ${signal.reason}`);
      return {
        cycleMonth,
        decision: 'skip',
        reason: signal.reason,
        positionId: null,
      };
    }

    // Check we don't already have an open position somehow (defense in depth).
    const open = this.repo.listOpenPositions();
    if (open.length > 0) {
      const reason = `existing_open_position_${open[0].local_id}`;
      this.repo.insertEntryDecision({
        cycle_month: cycleMonth,
        decided_at: decidedAt,
        decision: 'skip',
        reason,
        position_id: null,
      });
      return { cycleMonth, decision: 'skip', reason, positionId: null };
    }

    // Pick strikes from the live chain.
    const selection = await this.chainSelector.selectCondorTarget('SPY', now);
    if (!selection.ok) {
      const reason = `chain_${selection.failure.reason}`;
      this.repo.insertEntryDecision({
        cycle_month: cycleMonth,
        decided_at: decidedAt,
        decision: 'skip',
        reason,
        position_id: null,
      });
      this.logger.log(`Entry skip ${cycleMonth}: ${reason}`);
      return { cycleMonth, decision: 'skip', reason, positionId: null };
    }

    // Open the condor.
    let positionId: number | null = null;
    try {
      const opened = await this.execution.openCondor(
        selection.target,
        cycleMonth,
      );
      positionId = opened.positionId;
    } catch (err) {
      const reason = `execution_failed: ${err instanceof Error ? err.message : String(err)}`;
      this.repo.insertEntryDecision({
        cycle_month: cycleMonth,
        decided_at: decidedAt,
        decision: 'skip',
        reason,
        position_id: null,
      });
      this.logger.error(`Entry execution failed for ${cycleMonth}: ${reason}`);
      return { cycleMonth, decision: 'skip', reason, positionId: null };
    }

    this.repo.insertEntryDecision({
      cycle_month: cycleMonth,
      decided_at: decidedAt,
      decision: 'open',
      reason: 'signal_eligible_and_chain_available',
      position_id: positionId,
    });
    this.logger.log(
      `Entry OPEN ${cycleMonth}: position ${positionId} ` +
        `(${selection.target.shortPut.strikePrice}/${selection.target.shortCall.strikePrice})`,
    );
    return {
      cycleMonth,
      decision: 'open',
      reason: 'signal_eligible_and_chain_available',
      positionId,
    };
  }

  /**
   * Mark every open position to market by pulling current chain mids.
   */
  async markAllOpenPositions(now: Date = new Date()): Promise<{
    marked: number;
  }> {
    const open = this.repo.listOpenPositions();
    if (open.length === 0) return { marked: 0 };

    const sampledAt = now.toISOString();
    let marked = 0;

    for (const pos of open) {
      if (pos.id == null) continue;
      try {
        const chain = await this.alpaca.getOptionChain('SPY', {
          expirationDate: pos.expiration_date,
        });
        const debit = this.execution.estimateClosingDebit(pos, chain);
        // Unrealized PnL = (credit_received - current_debit) * 100 * contracts
        const credit = pos.credit_received ?? 0;
        const unrealizedPnl = (credit - debit) * 100 * pos.contracts;

        this.repo.insertMarkToMarket({
          position_id: pos.id,
          sampled_at: sampledAt,
          spy_spot: null, // we'd need an extra fetch; defer for now
          vix: null,
          mid_value: debit,
          unrealized_pnl: unrealizedPnl,
        });
        marked++;
      } catch (err) {
        this.logger.warn(
          `MTM failed for ${pos.local_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { marked };
  }

  /**
   * Snapshot account balance from Alpaca and persist.
   */
  async snapshotAccount(now: Date = new Date()): Promise<void> {
    try {
      const account = await this.alpaca.getAccount();
      const open = this.repo.listOpenPositions();
      this.repo.insertAccountSnapshot({
        sampled_at: now.toISOString(),
        cash: parseFloat(account.cash),
        equity: parseFloat(account.equity),
        buying_power: parseFloat(account.buying_power),
        open_positions: open.length,
      });
    } catch (err) {
      this.logger.warn(
        `Account snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
