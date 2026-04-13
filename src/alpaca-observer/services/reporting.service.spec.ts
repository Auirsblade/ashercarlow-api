import {
  AlpacaObserverRepository,
  CondorPositionRow,
} from '../storage/alpaca-observer.repository';
import { AlpacaReportingService } from './reporting.service';

describe('AlpacaReportingService', () => {
  let repo: AlpacaObserverRepository;
  let svc: AlpacaReportingService;

  const samplePosition = (
    overrides: Partial<CondorPositionRow> = {},
  ): CondorPositionRow => ({
    local_id: `uuid-${Math.random()}`,
    alpaca_order_id: null,
    cycle_month: '2026-05',
    opened_at: '2026-04-15T13:30:00Z',
    expiration_date: '2026-05-15',
    status: 'open',
    short_put_strike: 555,
    long_put_strike: 550,
    short_call_strike: 605,
    long_call_strike: 610,
    credit_received: 1.8,
    max_loss: 320,
    contracts: 1,
    dry_run: 1,
    ...overrides,
  });

  beforeEach(() => {
    repo = new AlpacaObserverRepository();
    repo.useInMemoryForTests();
    svc = new AlpacaReportingService(repo);
  });

  afterEach(() => {
    repo.close();
  });

  it('summary on empty DB returns zeros and null win rate', () => {
    const s = svc.getSummary();
    expect(s.phase).toBe('phase-1-paper');
    expect(s.positions.total).toBe(0);
    expect(s.pnl.realizedTotal).toBe(0);
    expect(s.pnl.winRate).toBeNull();
    expect(s.recentSignal).toBeNull();
  });

  it('counts positions by bucket', () => {
    repo.insertPosition(samplePosition({ status: 'open' }));
    repo.insertPosition(
      samplePosition({ status: 'closed_expired', realized_pnl: 175 }),
    );
    repo.insertPosition(
      samplePosition({ status: 'closed_stop', realized_pnl: -200 }),
    );
    repo.insertPosition(samplePosition({ status: 'errored' }));

    const s = svc.getSummary();
    expect(s.positions.total).toBe(4);
    expect(s.positions.open).toBe(1);
    expect(s.positions.closed).toBe(2);
    expect(s.positions.errored).toBe(1);
  });

  it('computes realized PnL totals and win rate', () => {
    repo.insertPosition(
      samplePosition({ status: 'closed_expired', realized_pnl: 175 }),
    );
    repo.insertPosition(
      samplePosition({ status: 'closed_expired', realized_pnl: 150 }),
    );
    repo.insertPosition(
      samplePosition({ status: 'closed_stop', realized_pnl: -300 }),
    );

    const s = svc.getSummary();
    expect(s.pnl.realizedTotal).toBe(25);
    expect(s.pnl.closedCount).toBe(3);
    expect(s.pnl.winRate).toBeCloseTo(2 / 3);
    expect(s.pnl.averageRealizedPerPosition).toBeCloseTo(25 / 3);
  });

  it('returns the most recent signal sample with the summary', () => {
    repo.insertSignalSample({
      sampled_at: '2026-04-07T13:00:00Z',
      spy_spot: 580,
      vix: 25.78,
      rv30: 18.17,
      vrp: 7.61,
      regime: 'favorable',
      entry_eligible: 1,
    });
    repo.insertSignalSample({
      sampled_at: '2026-04-07T14:00:00Z',
      spy_spot: 581,
      vix: 25.5,
      rv30: 18.2,
      vrp: 7.3,
      regime: 'favorable',
      entry_eligible: 1,
    });

    const s = svc.getSummary();
    expect(s.recentSignal?.sampled_at).toBe('2026-04-07T14:00:00Z');
    expect(s.recentSignal?.vix).toBe(25.5);
  });

  it('listRecentSignals returns newest first with a default limit', () => {
    for (let i = 0; i < 60; i++) {
      repo.insertSignalSample({
        sampled_at: `2026-04-07T${String(i % 24).padStart(2, '0')}:00:00Z`,
        spy_spot: 580,
        vix: 20 + i * 0.01,
        rv30: 15,
        vrp: 5,
        regime: 'favorable',
        entry_eligible: 1,
      });
    }
    const out = svc.listRecentSignals();
    expect(out).toHaveLength(50);
  });

  it('listRecentDecisions returns newest first', () => {
    repo.insertEntryDecision({
      cycle_month: '2026-04',
      decided_at: '2026-04-01T13:00:00Z',
      decision: 'skip',
      reason: 'vix_too_high',
      position_id: null,
    });
    repo.insertEntryDecision({
      cycle_month: '2026-05',
      decided_at: '2026-05-01T13:00:00Z',
      decision: 'skip',
      reason: 'cycle_already_decided',
      position_id: null,
    });

    const out = svc.listRecentDecisions();
    expect(out).toHaveLength(2);
    expect(out[0].cycle_month).toBe('2026-05');
  });
});
