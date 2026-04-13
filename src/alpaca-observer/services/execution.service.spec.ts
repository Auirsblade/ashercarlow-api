import {
  AlpacaClient,
  AlpacaOptionSnapshot,
  AlpacaOrder,
} from '../clients/alpaca.client';
import {
  AlpacaObserverRepository,
  CondorPositionRow,
} from '../storage/alpaca-observer.repository';
import { CondorTarget } from './chain-selector.service';
import { ExecutionService } from './execution.service';

describe('ExecutionService', () => {
  let alpaca: jest.Mocked<AlpacaClient>;
  let repo: AlpacaObserverRepository;

  const sampleSnapshot = (
    type: 'put' | 'call',
    strike: number,
    bid = 1.0,
    ask = 1.2,
  ): AlpacaOptionSnapshot => ({
    symbol: `SPY260515${type === 'put' ? 'P' : 'C'}${String(strike * 1000).padStart(8, '0')}`,
    expirationDate: '2026-05-15',
    strikePrice: strike,
    type,
    greeks: { delta: type === 'put' ? -0.2 : 0.2 },
    latestQuote: { bid, ask },
  });

  const sampleTarget = (): CondorTarget => ({
    expirationDate: '2026-05-15',
    shortPut: sampleSnapshot('put', 550, 2.0, 2.2), // mid 2.1
    longPut: sampleSnapshot('put', 545, 1.0, 1.1), // mid 1.05
    shortCall: sampleSnapshot('call', 610, 2.0, 2.2),
    longCall: sampleSnapshot('call', 615, 1.0, 1.1),
    estimatedCredit: 2.1, // 2.1 + 2.1 - 1.05 - 1.05 = 2.10
    maxLoss: 290, // (5 * 100) - (2.10 * 100) = 500 - 210
  });

  beforeEach(() => {
    repo = new AlpacaObserverRepository();
    repo.useInMemoryForTests();
    alpaca = {
      placeMlegOrder: jest.fn(),
      getOptionChain: jest.fn(),
    } as unknown as jest.Mocked<AlpacaClient>;
  });

  afterEach(() => {
    repo.close();
  });

  describe('dry-run mode (default)', () => {
    let svc: ExecutionService;

    beforeEach(() => {
      delete process.env.ALPACA_OBSERVER_DRY_RUN;
      svc = new ExecutionService(alpaca, repo);
    });

    it('opens a condor without calling Alpaca', async () => {
      const result = await svc.openCondor(sampleTarget(), '2026-05');
      expect(result.dryRun).toBe(true);
      expect(result.alpacaOrderId).toBeNull();
      expect(result.estimatedCredit).toBeCloseTo(2.1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(alpaca.placeMlegOrder).not.toHaveBeenCalled();
    });

    it('persists the position with all 4 legs', async () => {
      const result = await svc.openCondor(sampleTarget(), '2026-05');
      const position = repo.getPosition(result.positionId);
      expect(position?.status).toBe('open');
      expect(position?.dry_run).toBe(1);
      expect(position?.short_put_strike).toBe(550);

      const legs = repo.listLegsForPosition(result.positionId);
      expect(legs).toHaveLength(4);
      expect(legs.map((l) => l.side).sort()).toEqual([
        'long_call',
        'long_put',
        'short_call',
        'short_put',
      ]);
    });

    it('closes a position and computes realized PnL from current chain mids', async () => {
      const opened = await svc.openCondor(sampleTarget(), '2026-05');
      const position = repo.getPosition(opened.positionId)!;

      // Pretend the chain has cheapened: closing debit is now 0.30
      alpaca.getOptionChain.mockResolvedValue([
        sampleSnapshot('put', 550, 0.1, 0.2), // mid 0.15
        sampleSnapshot('put', 545, 0.05, 0.1), // mid 0.075
        sampleSnapshot('call', 610, 0.1, 0.2),
        sampleSnapshot('call', 615, 0.05, 0.1),
      ]);

      const closed = await svc.closePosition(position, 'manual_test');
      expect(closed.dryRun).toBe(true);
      // Closing debit = 0.15 + 0.15 - 0.075 - 0.075 + 0.05 buffer = 0.20
      expect(closed.estimatedDebit).toBeCloseTo(0.2, 2);

      const updated = repo.getPosition(opened.positionId);
      expect(updated?.status).toBe('closed_manual');
      // Realized = (credit 2.10 - debit 0.20) * 100 * 1 = $190
      expect(updated?.realized_pnl).toBeCloseTo(190, 0);
    });
  });

  describe('live paper mode (env opt-in)', () => {
    let svc: ExecutionService;
    const originalEnv = process.env.ALPACA_OBSERVER_DRY_RUN;

    beforeEach(() => {
      process.env.ALPACA_OBSERVER_DRY_RUN = 'false';
      svc = new ExecutionService(alpaca, repo);
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.ALPACA_OBSERVER_DRY_RUN;
      } else {
        process.env.ALPACA_OBSERVER_DRY_RUN = originalEnv;
      }
    });

    it('submits a real mleg order with negative credit limit price', async () => {
      const fakeOrder: AlpacaOrder = {
        id: 'paper-order-123',
        client_order_id: 'paper-coid-456',
        status: 'accepted',
        qty: '1',
        filled_qty: '0',
        order_class: 'mleg',
        submitted_at: '2026-04-15T14:00:00Z',
      };
      alpaca.placeMlegOrder.mockResolvedValue(fakeOrder);

      const result = await svc.openCondor(sampleTarget(), '2026-05');
      expect(result.dryRun).toBe(false);
      expect(result.alpacaOrderId).toBe('paper-order-123');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(alpaca.placeMlegOrder).toHaveBeenCalledTimes(1);
      const [submitted] = (alpaca.placeMlegOrder as unknown as jest.Mock).mock
        .calls[0] as [
        {
          order_class: string;
          limit_price: string;
          legs: Array<{ side: string; position_intent: string }>;
        },
      ];

      // CRITICAL: credit spread limit price is NEGATIVE
      expect(submitted.order_class).toBe('mleg');
      expect(submitted.limit_price).toBe('-2.10');
      expect(submitted.legs).toHaveLength(4);
      expect(submitted.legs.every((l) => l.position_intent === 'opening')).toBe(
        true,
      );

      const stored = repo.getPosition(result.positionId);
      expect(stored?.status).toBe('open');
      expect(stored?.alpaca_order_id).toBe('paper-order-123');
    });

    it('marks position as errored if Alpaca rejects the open', async () => {
      alpaca.placeMlegOrder.mockRejectedValue(
        new Error('insufficient buying power'),
      );

      await expect(svc.openCondor(sampleTarget(), '2026-05')).rejects.toThrow(
        /insufficient buying power/,
      );

      const positions = repo.listPositions();
      expect(positions).toHaveLength(1);
      expect(positions[0].status).toBe('errored');
      expect(positions[0].exit_reason).toMatch(/open_failed/);
    });

    it('builds a closing order with positive limit price and flipped sides', async () => {
      const opened = await svc
        .openCondor(sampleTarget(), '2026-05')
        .catch(() => null);
      // Reset and re-mock for the close call
      (alpaca.placeMlegOrder as unknown as jest.Mock).mockClear();
      const fakeOrder: AlpacaOrder = {
        id: 'close-order-789',
        client_order_id: 'close-coid',
        status: 'accepted',
        qty: '1',
        filled_qty: '0',
        order_class: 'mleg',
        submitted_at: '2026-05-14T19:00:00Z',
      };
      alpaca.placeMlegOrder.mockResolvedValue(fakeOrder);
      alpaca.getOptionChain.mockResolvedValue([
        sampleSnapshot('put', 550, 0.1, 0.2),
        sampleSnapshot('put', 545, 0.05, 0.1),
        sampleSnapshot('call', 610, 0.1, 0.2),
        sampleSnapshot('call', 615, 0.05, 0.1),
      ]);

      // Insert a position directly to test the close path independently
      const positionId = repo.insertPosition({
        local_id: 'test-close',
        alpaca_order_id: 'open-order-prev',
        cycle_month: '2026-05',
        opened_at: '2026-04-15T14:00:00Z',
        expiration_date: '2026-05-15',
        status: 'open',
        short_put_strike: 550,
        long_put_strike: 545,
        short_call_strike: 610,
        long_call_strike: 615,
        credit_received: 2.1,
        max_loss: 290,
        contracts: 1,
        dry_run: 0,
      });
      const position = repo.getPosition(positionId)!;

      await svc.closePosition(position, 'manual_test');

      const calls = (alpaca.placeMlegOrder as unknown as jest.Mock).mock
        .calls as unknown as Array<
        [
          {
            limit_price: string;
            legs: Array<{
              symbol: string;
              side: string;
              position_intent: string;
            }>;
          },
        ]
      >;
      const submitted = calls[0][0];

      // Closing → positive limit price (paying debit)
      expect(parseFloat(submitted.limit_price)).toBeGreaterThan(0);
      // All legs flipped: shorts become buys, longs become sells
      const legBySide = submitted.legs.reduce<Record<string, string>>(
        (acc, l) => ({ ...acc, [l.symbol]: l.side }),
        {},
      );
      // The short put strike 550 contract should now be SIDE=BUY
      const spSymbol = submitted.legs[0].symbol;
      expect(spSymbol).toContain('P00550000');
      expect(legBySide[spSymbol]).toBe('buy');
      // All legs marked as closing
      expect(submitted.legs.every((l) => l.position_intent === 'closing')).toBe(
        true,
      );
      expect(opened).toBeNull(); // typescript: ensure variable is used
    });
  });

  describe('order request shape', () => {
    let svc: ExecutionService;

    beforeEach(() => {
      delete process.env.ALPACA_OBSERVER_DRY_RUN;
      svc = new ExecutionService(alpaca, repo);
    });

    it('opens with negative limit_price for credit', () => {
      const target = sampleTarget();
      const req = svc.buildOpenOrderRequest(target);
      expect(req.order_class).toBe('mleg');
      expect(req.type).toBe('limit');
      expect(req.limit_price).toBe('-2.10');
      expect(req.legs).toHaveLength(4);
      expect(req.legs[0].side).toBe('sell'); // short put
      expect(req.legs[1].side).toBe('buy'); // long put wing
      expect(req.legs[2].side).toBe('sell'); // short call
      expect(req.legs[3].side).toBe('buy'); // long call wing
      expect(req.legs.every((l) => l.position_intent === 'opening')).toBe(true);
    });

    it('builds closing order with sides flipped and OCC symbols regenerated', () => {
      const position: CondorPositionRow = {
        id: 1,
        local_id: 'x',
        alpaca_order_id: null,
        cycle_month: '2026-05',
        opened_at: '2026-04-15T14:00:00Z',
        expiration_date: '2026-05-15',
        status: 'open',
        short_put_strike: 550,
        long_put_strike: 545,
        short_call_strike: 610,
        long_call_strike: 615,
        credit_received: 2.1,
        max_loss: 290,
        contracts: 1,
        dry_run: 0,
      };
      const req = svc.buildCloseOrderRequest(position, 0.45);
      expect(req.limit_price).toBe('0.45');
      expect(req.legs[0].symbol).toBe('SPY260515P00550000');
      expect(req.legs[0].side).toBe('buy');
      expect(req.legs[0].position_intent).toBe('closing');
      expect(req.legs[1].symbol).toBe('SPY260515P00545000');
      expect(req.legs[1].side).toBe('sell');
    });
  });
});
