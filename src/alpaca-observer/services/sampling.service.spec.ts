import { AlpacaClient } from '../clients/alpaca.client';
import { AlpacaObserverRepository } from '../storage/alpaca-observer.repository';
import { ChainSelectorService } from './chain-selector.service';
import { ExecutionService } from './execution.service';
import { AlpacaSamplingService } from './sampling.service';
import { SignalService } from './signal.service';

describe('AlpacaSamplingService', () => {
  let signal: jest.Mocked<SignalService>;
  let chainSelector: jest.Mocked<ChainSelectorService>;
  let execution: jest.Mocked<ExecutionService>;
  let alpaca: jest.Mocked<AlpacaClient>;
  let repo: AlpacaObserverRepository;
  let svc: AlpacaSamplingService;

  beforeEach(() => {
    delete process.env.ALPACA_OBSERVER_ENABLED;
    delete process.env.ALPACA_OBSERVER_DRY_RUN;

    repo = new AlpacaObserverRepository();
    repo.useInMemoryForTests();

    signal = {
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<SignalService>;
    chainSelector = {
      selectCondorTarget: jest.fn(),
    } as unknown as jest.Mocked<ChainSelectorService>;
    execution = {
      openCondor: jest.fn(),
      closePosition: jest.fn(),
      expireSweep: jest.fn().mockResolvedValue({ swept: 0, closeResults: [] }),
      estimateClosingDebit: jest.fn(),
    } as unknown as jest.Mocked<ExecutionService>;
    alpaca = {
      getOptionChain: jest.fn(),
      getAccount: jest.fn(),
    } as unknown as jest.Mocked<AlpacaClient>;

    svc = new AlpacaSamplingService(
      signal,
      chainSelector,
      execution,
      alpaca,
      repo,
    );
  });

  afterEach(() => {
    repo.close();
  });

  describe('evaluateEntry', () => {
    it('skips when cycle already has a decision', async () => {
      repo.insertEntryDecision({
        cycle_month: '2026-04',
        decided_at: '2026-04-15T13:00:00Z',
        decision: 'open',
        reason: 'previous',
        position_id: null,
      });

      const result = await svc.evaluateEntry(new Date('2026-04-15T15:00:00Z'));
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('cycle_already_decided');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(signal.evaluate).not.toHaveBeenCalled();
    });

    it('skips when signal regime is not eligible', async () => {
      signal.evaluate.mockResolvedValue({
        sampledAt: '2026-04-15T13:00:00Z',
        spySpot: 580,
        vix: 50,
        rv30: 30,
        vrp: 20,
        regime: 'vol_too_high',
        entryEligible: false,
        reason: 'vix_50_above_35',
      });

      const result = await svc.evaluateEntry(new Date('2026-04-15T15:00:00Z'));
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('vix_50_above_35');

      // Persisted as a decision row
      expect(repo.hasDecisionForCycle('2026-04')).toBe(true);
    });

    it('skips when chain selection fails', async () => {
      signal.evaluate.mockResolvedValue({
        sampledAt: '2026-04-15T13:00:00Z',
        spySpot: 580,
        vix: 18,
        rv30: 14,
        vrp: 4,
        regime: 'favorable',
        entryEligible: true,
        reason: 'vix_in_range',
      });
      chainSelector.selectCondorTarget.mockResolvedValue({
        ok: false,
        failure: { reason: 'no_eligible_expiration_in_dte_range' },
      });

      const result = await svc.evaluateEntry(new Date('2026-04-15T15:00:00Z'));
      expect(result.decision).toBe('skip');
      expect(result.reason).toBe('chain_no_eligible_expiration_in_dte_range');
    });

    it('skips when an existing position is open (defense in depth)', async () => {
      signal.evaluate.mockResolvedValue({
        sampledAt: '2026-04-15T13:00:00Z',
        spySpot: 580,
        vix: 18,
        rv30: 14,
        vrp: 4,
        regime: 'favorable',
        entryEligible: true,
        reason: 'vix_in_range',
      });
      repo.insertPosition({
        local_id: 'existing',
        alpaca_order_id: null,
        cycle_month: '2026-03',
        opened_at: '2026-03-01T14:00:00Z',
        expiration_date: '2026-04-17',
        status: 'open',
        short_put_strike: 550,
        long_put_strike: 545,
        short_call_strike: 610,
        long_call_strike: 615,
        credit_received: 1.8,
        max_loss: 320,
        contracts: 1,
        dry_run: 1,
      });

      const result = await svc.evaluateEntry(new Date('2026-04-15T15:00:00Z'));
      expect(result.decision).toBe('skip');
      expect(result.reason).toMatch(/existing_open_position/);
    });

    it('opens a condor on the happy path', async () => {
      signal.evaluate.mockResolvedValue({
        sampledAt: '2026-04-15T13:00:00Z',
        spySpot: 580,
        vix: 18,
        rv30: 14,
        vrp: 4,
        regime: 'favorable',
        entryEligible: true,
        reason: 'vix_in_range',
      });
      chainSelector.selectCondorTarget.mockResolvedValue({
        ok: true,
        target: {
          expirationDate: '2026-05-15',
          shortPut: {
            symbol: 'SPY260515P00550000',
            expirationDate: '2026-05-15',
            strikePrice: 550,
            type: 'put',
            greeks: { delta: -0.2 },
            latestQuote: { bid: 2, ask: 2.2 },
          },
          longPut: {
            symbol: 'SPY260515P00545000',
            expirationDate: '2026-05-15',
            strikePrice: 545,
            type: 'put',
            greeks: { delta: -0.15 },
            latestQuote: { bid: 1, ask: 1.1 },
          },
          shortCall: {
            symbol: 'SPY260515C00610000',
            expirationDate: '2026-05-15',
            strikePrice: 610,
            type: 'call',
            greeks: { delta: 0.2 },
            latestQuote: { bid: 2, ask: 2.2 },
          },
          longCall: {
            symbol: 'SPY260515C00615000',
            expirationDate: '2026-05-15',
            strikePrice: 615,
            type: 'call',
            greeks: { delta: 0.15 },
            latestQuote: { bid: 1, ask: 1.1 },
          },
          estimatedCredit: 2.1,
          maxLoss: 290,
        },
      });
      // The execution mock needs to insert a real row so the FK on
      // entry_decision.position_id resolves. We can't pre-insert because
      // that would trip the listOpenPositions defense-in-depth check.
      execution.openCondor.mockImplementation(() => {
        const realPositionId = repo.insertPosition({
          local_id: 'test-happy-path',
          alpaca_order_id: null,
          cycle_month: '2026-04',
          opened_at: '2026-04-15T15:00:00Z',
          expiration_date: '2026-05-15',
          status: 'open',
          short_put_strike: 550,
          long_put_strike: 545,
          short_call_strike: 610,
          long_call_strike: 615,
          credit_received: 2.1,
          max_loss: 290,
          contracts: 1,
          dry_run: 1,
        });
        return Promise.resolve({
          positionId: realPositionId,
          alpacaOrderId: null,
          dryRun: true,
          estimatedCredit: 2.1,
          maxLoss: 290,
        });
      });

      const result = await svc.evaluateEntry(new Date('2026-04-15T15:00:00Z'));
      expect(result.decision).toBe('open');
      expect(result.positionId).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(execution.openCondor).toHaveBeenCalledTimes(1);
    });
  });

  describe('kill switch', () => {
    it('all ticks short-circuit when ALPACA_OBSERVER_ENABLED is not set', async () => {
      // Default disabled
      const enabledSvc = new AlpacaSamplingService(
        signal,
        chainSelector,
        execution,
        alpaca,
        repo,
      );

      await enabledSvc.tickSignal();
      await enabledSvc.tickEntryDecision();
      await enabledSvc.tickMarkToMarket();
      await enabledSvc.tickAccountSnapshot();
      await enabledSvc.tickExpireSweep();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(signal.evaluate).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(chainSelector.selectCondorTarget).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(execution.openCondor).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(execution.expireSweep).not.toHaveBeenCalled();
    });

    it('ticks fire when ALPACA_OBSERVER_ENABLED=true', async () => {
      process.env.ALPACA_OBSERVER_ENABLED = 'true';
      const enabledSvc = new AlpacaSamplingService(
        signal,
        chainSelector,
        execution,
        alpaca,
        repo,
      );
      signal.evaluate.mockResolvedValue({
        sampledAt: 'now',
        spySpot: 580,
        vix: 18,
        rv30: 14,
        vrp: 4,
        regime: 'favorable',
        entryEligible: true,
        reason: 'ok',
      });

      await enabledSvc.tickSignal();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(signal.evaluate).toHaveBeenCalledTimes(1);
    });
  });
});
