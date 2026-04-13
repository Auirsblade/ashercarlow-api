import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AlpacaClient,
  AlpacaMlegOrderRequest,
  AlpacaOptionSnapshot,
  AlpacaOrder,
  buildOccSymbol,
} from '../clients/alpaca.client';
import {
  AlpacaObserverRepository,
  CondorPositionRow,
} from '../storage/alpaca-observer.repository';
import { CondorTarget } from './chain-selector.service';

/**
 * Places, marks, and closes iron condor positions on Alpaca paper.
 *
 * SAFETY:
 *   - Default mode is dry-run (logs orders to the DB without submitting
 *     to Alpaca). Set `ALPACA_OBSERVER_DRY_RUN=false` to actually
 *     submit to paper.
 *   - Even when dry-run is off, the AlpacaClient is hard-locked to the
 *     paper trading host. There is no code path in this module that can
 *     reach the live trading endpoint.
 *
 * FIELD-NAME GOTCHAS verified during Step 0:
 *   - Credit spreads use NEGATIVE `limit_price` strings. An iron condor
 *     sold for $1.80 credit submits as `limit_price: "-1.80"`.
 *   - Closing the same condor for a debit submits as `limit_price: "0.20"`
 *     (positive, the amount we pay to buy back).
 *   - SPY is equity-settled. Always close at least 1 day before expiration
 *     to avoid pin-risk assignment to 100 shares per contract — which we
 *     could not afford on a $5k account.
 */

const PIN_RISK_BUFFER_DAYS = 1; // close positions this many days before expiration
const CLOSE_SLIPPAGE_BUFFER = 0.05; // willing to pay 5¢ above mid to close

export interface OpenCondorResult {
  positionId: number;
  alpacaOrderId: string | null;
  dryRun: boolean;
  estimatedCredit: number;
  maxLoss: number;
}

export interface CloseCondorResult {
  positionId: number;
  alpacaOrderId: string | null;
  exitReason: string;
  dryRun: boolean;
  estimatedDebit: number;
}

@Injectable()
export class ExecutionService implements OnModuleInit {
  private readonly logger = new Logger(ExecutionService.name);

  /**
   * Hard default to true. The user must explicitly set
   * `ALPACA_OBSERVER_DRY_RUN=false` to actually submit orders to Alpaca
   * paper. This is the same shape as the kalshi-observer kill switch.
   */
  private readonly dryRun =
    (process.env.ALPACA_OBSERVER_DRY_RUN ?? 'true').toLowerCase() !== 'false';

  constructor(
    private readonly alpaca: AlpacaClient,
    private readonly repo: AlpacaObserverRepository,
  ) {}

  onModuleInit(): void {
    if (this.dryRun) {
      this.logger.log(
        'ExecutionService: DRY-RUN mode (orders are persisted to DB only, ' +
          'NOT submitted to Alpaca). Set ALPACA_OBSERVER_DRY_RUN=false to ' +
          'enable real paper-account submission.',
      );
    } else {
      this.logger.warn(
        'ExecutionService: LIVE PAPER mode — orders WILL be submitted to ' +
          'Alpaca paper trading. Verify ALPACA_BASE_URL points at paper-api.',
      );
    }
  }

  /**
   * Open an iron condor for a given target. Returns the position ID and,
   * if not dry-run, the Alpaca parent order ID.
   *
   * Idempotency: this method does NOT check for an existing position in
   * the cycle — that's the caller's job (via `repo.hasDecisionForCycle`).
   * If you call openCondor twice for the same cycle you will get two
   * positions in the database (and possibly two orders submitted).
   */
  async openCondor(
    target: CondorTarget,
    cycleMonth: string,
  ): Promise<OpenCondorResult> {
    const localId = randomUUID();
    const openedAt = new Date().toISOString();

    // Insert pending row first so a crash mid-submit leaves a recoverable
    // claim in the DB.
    const positionId = this.repo.insertPosition({
      local_id: localId,
      alpaca_order_id: null,
      cycle_month: cycleMonth,
      opened_at: openedAt,
      expiration_date: target.expirationDate,
      status: 'pending',
      short_put_strike: target.shortPut.strikePrice,
      long_put_strike: target.longPut.strikePrice,
      short_call_strike: target.shortCall.strikePrice,
      long_call_strike: target.longCall.strikePrice,
      credit_received: target.estimatedCredit,
      max_loss: target.maxLoss,
      contracts: 1,
      dry_run: this.dryRun ? 1 : 0,
    });

    // Persist the four legs.
    for (const [side, snapshot] of [
      ['short_put', target.shortPut],
      ['long_put', target.longPut],
      ['short_call', target.shortCall],
      ['long_call', target.longCall],
    ] as const) {
      this.repo.insertLeg({
        position_id: positionId,
        side,
        contract_symbol: snapshot.symbol,
        strike: snapshot.strikePrice,
        expiration: snapshot.expirationDate,
        alpaca_leg_order_id: null,
        fill_price: null,
        fill_qty: null,
      });
    }

    if (this.dryRun) {
      this.repo.updatePositionStatus(positionId, 'open', {
        credit_received: target.estimatedCredit,
      });
      this.logger.log(
        `[DRY-RUN] Opened condor ${localId} for ${cycleMonth} ` +
          `${target.expirationDate}: SP${target.shortPut.strikePrice} ` +
          `LP${target.longPut.strikePrice} SC${target.shortCall.strikePrice} ` +
          `LC${target.longCall.strikePrice}, est credit $${target.estimatedCredit.toFixed(2)}`,
      );
      return {
        positionId,
        alpacaOrderId: null,
        dryRun: true,
        estimatedCredit: target.estimatedCredit,
        maxLoss: target.maxLoss,
      };
    }

    // Live paper submission.
    const orderRequest = this.buildOpenOrderRequest(target);
    let order: AlpacaOrder;
    try {
      order = await this.alpaca.placeMlegOrder(orderRequest);
    } catch (err) {
      this.repo.updatePositionStatus(positionId, 'errored', {
        exit_reason: `open_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }

    this.repo.updatePositionStatus(positionId, 'open', {
      alpaca_order_id: order.id,
      credit_received: target.estimatedCredit,
    });

    this.logger.log(
      `Opened paper condor ${localId} via Alpaca order ${order.id} ` +
        `(est credit $${target.estimatedCredit.toFixed(2)}, max loss $${target.maxLoss.toFixed(2)})`,
    );

    return {
      positionId,
      alpacaOrderId: order.id,
      dryRun: false,
      estimatedCredit: target.estimatedCredit,
      maxLoss: target.maxLoss,
    };
  }

  /**
   * Close an open condor. The closing order is the inverse of the opening
   * order: every leg's side is flipped, and `limit_price` is positive
   * (we're paying a debit to buy back the condor).
   */
  async closePosition(
    position: CondorPositionRow,
    exitReason: string,
  ): Promise<CloseCondorResult> {
    if (position.id == null) {
      throw new Error('closePosition requires a persisted position with id');
    }

    // Refresh the chain to get current mids for the closing limit price.
    const chain = await this.alpaca.getOptionChain('SPY', {
      expirationDate: position.expiration_date,
    });
    const debit = this.estimateClosingDebit(position, chain);

    if (this.dryRun) {
      const closedAt = new Date().toISOString();
      const realizedPnl =
        ((position.credit_received ?? 0) - debit) * 100 * position.contracts;
      this.repo.updatePositionStatus(position.id, 'closed_manual', {
        closed_at: closedAt,
        realized_pnl: realizedPnl,
        exit_reason: exitReason,
      });
      this.logger.log(
        `[DRY-RUN] Closed condor ${position.local_id} reason=${exitReason} ` +
          `est debit $${debit.toFixed(2)} → realized $${realizedPnl.toFixed(2)}`,
      );
      return {
        positionId: position.id,
        alpacaOrderId: null,
        exitReason,
        dryRun: true,
        estimatedDebit: debit,
      };
    }

    const closeRequest = this.buildCloseOrderRequest(position, debit);
    let order: AlpacaOrder;
    try {
      order = await this.alpaca.placeMlegOrder(closeRequest);
    } catch (err) {
      this.logger.error(
        `Failed to close condor ${position.local_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    this.repo.updatePositionStatus(position.id, 'closing', {
      exit_reason: exitReason,
    });

    this.logger.log(
      `Submitted close for ${position.local_id} via Alpaca order ${order.id} ` +
        `(est debit $${debit.toFixed(2)}, reason=${exitReason})`,
    );

    return {
      positionId: position.id,
      alpacaOrderId: order.id,
      exitReason,
      dryRun: false,
      estimatedDebit: debit,
    };
  }

  /**
   * Sweep open positions: close any whose expiration is within
   * PIN_RISK_BUFFER_DAYS of the current date.
   */
  async expireSweep(now: Date = new Date()): Promise<{
    swept: number;
    closeResults: CloseCondorResult[];
  }> {
    const open = this.repo.listOpenPositions();
    const closeResults: CloseCondorResult[] = [];

    for (const pos of open) {
      const exp = new Date(`${pos.expiration_date}T16:00:00Z`);
      const dte = Math.ceil(
        (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (dte <= PIN_RISK_BUFFER_DAYS) {
        try {
          const result = await this.closePosition(pos, 'pin_risk_expiry');
          closeResults.push(result);
        } catch (err) {
          this.logger.warn(
            `Expire sweep failed to close ${pos.local_id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    return { swept: closeResults.length, closeResults };
  }

  // ---------- order construction (the field-name traps live here) ----------

  /**
   * Build a 4-leg multi-leg order for opening a short iron condor.
   *
   * `limit_price` is NEGATIVE for credit spreads. An iron condor sold for
   * $1.80 of credit submits as `limit_price: "-1.80"`. The negative value
   * is the field-name trap that bit other Alpaca devs in the discovery.
   */
  buildOpenOrderRequest(target: CondorTarget): AlpacaMlegOrderRequest {
    return {
      order_class: 'mleg',
      qty: '1',
      type: 'limit',
      time_in_force: 'day',
      // Credit → negative limit price. Round to 2 decimals.
      limit_price: `-${target.estimatedCredit.toFixed(2)}`,
      legs: [
        {
          symbol: target.shortPut.symbol,
          ratio_qty: '1',
          side: 'sell',
          position_intent: 'opening',
        },
        {
          symbol: target.longPut.symbol,
          ratio_qty: '1',
          side: 'buy',
          position_intent: 'opening',
        },
        {
          symbol: target.shortCall.symbol,
          ratio_qty: '1',
          side: 'sell',
          position_intent: 'opening',
        },
        {
          symbol: target.longCall.symbol,
          ratio_qty: '1',
          side: 'buy',
          position_intent: 'opening',
        },
      ],
    };
  }

  /**
   * Build the closing 4-leg order. Sides are flipped from opening
   * (buy the shorts back, sell the longs back). limit_price is POSITIVE
   * because we're paying debit to close.
   */
  buildCloseOrderRequest(
    position: CondorPositionRow,
    estimatedDebit: number,
  ): AlpacaMlegOrderRequest {
    return {
      order_class: 'mleg',
      qty: String(position.contracts),
      type: 'limit',
      time_in_force: 'day',
      // Debit → positive limit price.
      limit_price: estimatedDebit.toFixed(2),
      legs: [
        {
          symbol: buildOccSymbol(
            'SPY',
            position.expiration_date,
            'put',
            position.short_put_strike,
          ),
          ratio_qty: '1',
          side: 'buy',
          position_intent: 'closing',
        },
        {
          symbol: buildOccSymbol(
            'SPY',
            position.expiration_date,
            'put',
            position.long_put_strike,
          ),
          ratio_qty: '1',
          side: 'sell',
          position_intent: 'closing',
        },
        {
          symbol: buildOccSymbol(
            'SPY',
            position.expiration_date,
            'call',
            position.short_call_strike,
          ),
          ratio_qty: '1',
          side: 'buy',
          position_intent: 'closing',
        },
        {
          symbol: buildOccSymbol(
            'SPY',
            position.expiration_date,
            'call',
            position.long_call_strike,
          ),
          ratio_qty: '1',
          side: 'sell',
          position_intent: 'closing',
        },
      ],
    };
  }

  /**
   * Estimate the debit required to close the position by buying back the
   * condor at current chain mids. Returns a rounded value with a small
   * slippage buffer added so the closing limit order has a chance of
   * filling.
   */
  estimateClosingDebit(
    position: CondorPositionRow,
    chain: AlpacaOptionSnapshot[],
  ): number {
    const findStrike = (
      type: 'put' | 'call',
      strike: number,
    ): AlpacaOptionSnapshot | undefined => {
      return chain.find((c) => c.type === type && c.strikePrice === strike);
    };

    const sp = findStrike('put', position.short_put_strike);
    const lp = findStrike('put', position.long_put_strike);
    const sc = findStrike('call', position.short_call_strike);
    const lc = findStrike('call', position.long_call_strike);

    const mid = (s?: AlpacaOptionSnapshot): number => {
      if (!s?.latestQuote) return 0;
      const b = s.latestQuote.bid ?? 0;
      const a = s.latestQuote.ask ?? 0;
      if (b <= 0 || a <= 0) return 0;
      return (b + a) / 2;
    };

    // Closing debit = buy back shorts - sell back longs
    const debit = mid(sp) + mid(sc) - mid(lp) - mid(lc);
    // Floor at 0.05 (we have to pay something) and add slippage buffer.
    return Math.max(0.05, debit + CLOSE_SLIPPAGE_BUFFER);
  }
}
