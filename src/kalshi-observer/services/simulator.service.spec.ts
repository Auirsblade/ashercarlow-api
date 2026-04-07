import {
  ObserverRepository,
  PriceSampleRow,
  TrackedMarketRow,
} from '../storage/observer.repository';
import { SimulatorService } from './simulator.service';

describe('SimulatorService', () => {
  let repo: ObserverRepository;
  let svc: SimulatorService;

  const market: TrackedMarketRow = {
    ticker: 'KXHIGHNY-26APR08-T55',
    event_ticker: 'KXHIGHNY-26APR08',
    series_ticker: 'KXHIGHNY',
    category: 'high_temp',
    region: 'nyc',
    title: null,
    rules_primary: null,
    threshold_json: JSON.stringify({ op: 'greater', value: 55 }),
    expected_expiration_time: null,
    latest_expiration_time: null,
    resolution_source_json: '{}',
    mapped_metar_icao: 'KNYC',
    mapping_confidence: 'high',
    mapping_notes: null,
    status: 'active',
    first_seen_at: '2026-04-08T00:00:00Z',
    last_seen_at: '2026-04-08T00:00:00Z',
  };

  const price = (overrides: Partial<PriceSampleRow> = {}): PriceSampleRow => ({
    ticker: market.ticker,
    sampled_at: '2026-04-08T15:00:00Z',
    yes_ask: 0.4,
    yes_bid: 0.38,
    no_ask: 0.62,
    no_bid: 0.6,
    last_price: 0.39,
    volume_24h: 5000,
    open_interest: 1000,
    liquidity: 500,
    ...overrides,
  });

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
    svc = new SimulatorService(repo);
    repo.upsertMarket(market);
  });

  afterEach(() => {
    repo.close();
  });

  it('starts with $1000 free bankroll', () => {
    expect(svc.computeFreeBankroll()).toBe(1000);
  });

  it('opens a YES position at yes_ask', () => {
    const pos = svc.tryOpen(market, price(), 'yes', '2026-04-08T15:00:00Z');
    expect(pos).not.toBeNull();
    expect(pos!.side).toBe('yes');
    expect(pos!.entryPrice).toBe(0.4);
    // 5% of 1000 = 50, but capped at MAX_POSITION_USD = 50
    expect(pos!.sizeUsd).toBe(50);
    expect(svc.computeFreeBankroll()).toBe(950);
  });

  it('opens a NO position at no_ask', () => {
    const pos = svc.tryOpen(market, price(), 'no', '2026-04-08T15:00:00Z');
    expect(pos!.side).toBe('no');
    expect(pos!.entryPrice).toBe(0.62);
  });

  it('refuses invalid entry prices', () => {
    expect(
      svc.tryOpen(market, price({ yes_ask: null }), 'yes', 'now'),
    ).toBeNull();
    expect(svc.tryOpen(market, price({ yes_ask: 0 }), 'yes', 'now')).toBeNull();
    expect(svc.tryOpen(market, price({ yes_ask: 1 }), 'yes', 'now')).toBeNull();
  });

  it('closes a winning YES position with positive PnL', () => {
    const pos = svc.tryOpen(market, price(), 'yes', 'now')!;
    const pnl = svc.closePosition(pos.id, 'yes', '2026-04-09T14:00:00Z');
    // 50 / 0.4 = 125 contracts, each pays (1 - 0.4) = 0.6, total = 75
    expect(pnl).toBeCloseTo(75);
    expect(svc.computeFreeBankroll()).toBeCloseTo(1075);
  });

  it('closes a losing position with full size loss', () => {
    const pos = svc.tryOpen(market, price(), 'yes', 'now')!;
    const pnl = svc.closePosition(pos.id, 'no', '2026-04-09T14:00:00Z');
    expect(pnl).toBe(-50);
    expect(svc.computeFreeBankroll()).toBeCloseTo(950);
  });

  it('returns $0 PnL for void outcomes', () => {
    const pos = svc.tryOpen(market, price(), 'yes', 'now')!;
    const pnl = svc.closePosition(pos.id, 'void', '2026-04-09T14:00:00Z');
    expect(pnl).toBe(0);
    expect(svc.computeFreeBankroll()).toBeCloseTo(1000);
  });

  it('respects bankroll limits when sizing positions', () => {
    // Drain bankroll: open several positions back-to-back
    for (let i = 0; i < 5; i++) {
      repo.upsertMarket({ ...market, ticker: `MKT${i}` });
      svc.tryOpen(
        { ...market, ticker: `MKT${i}` },
        price({ ticker: `MKT${i}` }),
        'yes',
        'now',
      );
    }
    // Fixed-fraction sizing: each new position is 5% of CURRENT free bankroll,
    // so sizes shrink as bankroll drops. After 5 positions:
    //   1000 → 950 → 902.5 → 857.375 → 814.506 → 773.781
    expect(svc.computeFreeBankroll()).toBeCloseTo(773.78, 2);
  });

  it('summary reports win rate correctly', () => {
    // Open 3 positions, close 2 winners + 1 loser
    const tickers = ['M1', 'M2', 'M3'];
    for (const t of tickers) {
      repo.upsertMarket({ ...market, ticker: t });
    }
    const p1 = svc.tryOpen(
      { ...market, ticker: 'M1' },
      price({ ticker: 'M1' }),
      'yes',
      'now',
    )!;
    const p2 = svc.tryOpen(
      { ...market, ticker: 'M2' },
      price({ ticker: 'M2' }),
      'yes',
      'now',
    )!;
    const p3 = svc.tryOpen(
      { ...market, ticker: 'M3' },
      price({ ticker: 'M3' }),
      'yes',
      'now',
    )!;
    svc.closePosition(p1.id, 'yes', 'now');
    svc.closePosition(p2.id, 'yes', 'now');
    svc.closePosition(p3.id, 'no', 'now');

    const s = svc.summary();
    expect(s.closedPositions).toBe(3);
    expect(s.openPositions).toBe(0);
    expect(s.winRate).toBeCloseTo(2 / 3);
    // Fixed-fraction sizing shrinks each subsequent position:
    //   p1: size 50 @ 0.4 → win: 50/0.4 * 0.6 = 75
    //   p2: size 47.5 @ 0.4 → win: 47.5/0.4 * 0.6 = 71.25
    //   p3: size 45.125 @ 0.4 → loss: -45.125
    //   total = 75 + 71.25 - 45.125 = 101.125
    expect(s.realizedPnl).toBeCloseTo(101.125);
  });

  it('refuses to open when bankroll is below minimum', () => {
    // Force bankroll below min by creating a big losing closed position first
    const pos = svc.tryOpen(market, price(), 'yes', 'now')!;
    svc.closePosition(pos.id, 'no', 'now'); // -$50, bankroll = $950

    // Manually insert a very bad closed position to burn bankroll fast
    // (simpler than opening 20 positions)
    const db = (
      repo as unknown as {
        db: { prepare: (s: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    db.prepare(
      `INSERT INTO simulated_position (market_ticker, opened_at, side, size_usd, entry_price, closed_at, resolution_outcome, realized_pnl_usd)
       VALUES ('drain', 'now', 'yes', 1, 0.5, 'now', 'no', -985)`,
    ).run();

    expect(svc.computeFreeBankroll()).toBeLessThan(20);
    const refused = svc.tryOpen(market, price({ ticker: 'new' }), 'yes', 'now');
    expect(refused).toBeNull();
  });
});
