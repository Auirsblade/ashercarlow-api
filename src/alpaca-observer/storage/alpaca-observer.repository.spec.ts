import {
  AlpacaObserverRepository,
  CondorPositionRow,
} from './alpaca-observer.repository';

describe('AlpacaObserverRepository', () => {
  let repo: AlpacaObserverRepository;

  beforeEach(() => {
    repo = new AlpacaObserverRepository();
    repo.useInMemoryForTests();
  });

  afterEach(() => {
    repo.close();
  });

  const samplePosition = (
    overrides: Partial<CondorPositionRow> = {},
  ): CondorPositionRow => ({
    local_id: 'test-uuid-1',
    alpaca_order_id: null,
    cycle_month: '2026-05',
    opened_at: '2026-04-15T13:30:00Z',
    expiration_date: '2026-05-15',
    status: 'pending',
    short_put_strike: 555,
    long_put_strike: 550,
    short_call_strike: 605,
    long_call_strike: 610,
    credit_received: null,
    max_loss: 500,
    contracts: 1,
    dry_run: 1,
    ...overrides,
  });

  it('inserts and retrieves a condor position', () => {
    const id = repo.insertPosition(samplePosition());
    const got = repo.getPosition(id);
    expect(got?.local_id).toBe('test-uuid-1');
    expect(got?.status).toBe('pending');
    expect(got?.short_put_strike).toBe(555);
  });

  it('updates status and PnL on close', () => {
    const id = repo.insertPosition(samplePosition({ status: 'open' }));
    repo.updatePositionStatus(id, 'closed_expired', {
      closed_at: '2026-05-15T20:00:00Z',
      realized_pnl: 175,
      exit_reason: 'expired_in_box',
      credit_received: 1.75,
    });
    const got = repo.getPosition(id);
    expect(got?.status).toBe('closed_expired');
    expect(got?.realized_pnl).toBe(175);
    expect(got?.exit_reason).toBe('expired_in_box');
    expect(got?.credit_received).toBe(1.75);
  });

  it('lists open positions filtering by status', () => {
    repo.insertPosition(samplePosition({ local_id: 'a', status: 'open' }));
    repo.insertPosition(
      samplePosition({ local_id: 'b', status: 'closed_expired' }),
    );
    repo.insertPosition(samplePosition({ local_id: 'c', status: 'pending' }));
    const open = repo.listOpenPositions();
    expect(open).toHaveLength(2);
    expect(open.map((p) => p.local_id).sort()).toEqual(['a', 'c']);
  });

  it('inserts legs and retrieves them in order', () => {
    const positionId = repo.insertPosition(samplePosition());
    repo.insertLeg({
      position_id: positionId,
      side: 'short_put',
      contract_symbol: 'SPY260515P00555000',
      strike: 555,
      expiration: '2026-05-15',
      alpaca_leg_order_id: null,
      fill_price: 1.2,
      fill_qty: 1,
    });
    repo.insertLeg({
      position_id: positionId,
      side: 'long_put',
      contract_symbol: 'SPY260515P00550000',
      strike: 550,
      expiration: '2026-05-15',
      alpaca_leg_order_id: null,
      fill_price: 0.8,
      fill_qty: 1,
    });
    const legs = repo.listLegsForPosition(positionId);
    expect(legs).toHaveLength(2);
    expect(legs[0].side).toBe('short_put');
    expect(legs[1].side).toBe('long_put');
  });

  it('records entry decisions and detects existing cycle decisions', () => {
    expect(repo.hasDecisionForCycle('2026-05')).toBe(false);
    repo.insertEntryDecision({
      cycle_month: '2026-05',
      decided_at: '2026-04-15T13:30:00Z',
      decision: 'skip',
      reason: 'vix_too_high',
      position_id: null,
    });
    expect(repo.hasDecisionForCycle('2026-05')).toBe(true);
    expect(repo.hasDecisionForCycle('2026-06')).toBe(false);
  });

  it('inserts signal and account snapshot rows without throwing', () => {
    repo.insertSignalSample({
      sampled_at: '2026-04-07T13:30:00Z',
      spy_spot: 580.12,
      vix: 25.78,
      rv30: 18.17,
      vrp: 7.61,
      regime: 'favorable',
      entry_eligible: 1,
    });
    repo.insertAccountSnapshot({
      sampled_at: '2026-04-07T13:30:00Z',
      cash: 5000,
      equity: 5000,
      buying_power: 5000,
      open_positions: 0,
    });
  });
});
