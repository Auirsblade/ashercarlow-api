import {
  ObserverRepository,
  TrackedMarketRow,
} from '../storage/observer.repository';
import { ReportingService } from './reporting.service';
import { SimulatorService } from './simulator.service';

describe('ReportingService', () => {
  let repo: ObserverRepository;
  let simulator: SimulatorService;
  let svc: ReportingService;

  const market = (
    overrides: Partial<TrackedMarketRow> = {},
  ): TrackedMarketRow => ({
    ticker: 'KXHIGHNY-26APR08-T55',
    event_ticker: 'KXHIGHNY-26APR08',
    series_ticker: 'KXHIGHNY',
    category: 'high_temp',
    region: 'nyc',
    title: 'NY',
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
    ...overrides,
  });

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
    simulator = new SimulatorService(repo);
    svc = new ReportingService(repo, simulator);
  });

  afterEach(() => {
    repo.close();
  });

  it('summary reports zeros on an empty DB', () => {
    const s = svc.getSummary();
    expect(s.phase).toBe('phase-1-observer');
    expect(s.trading).toBe(false);
    expect(s.bankroll.freeBankroll).toBe(1000);
    expect(s.markets.tracked).toBe(0);
    expect(s.discrepancies.total).toBe(0);
  });

  it('summary counts markets, discrepancies, and bankroll', () => {
    repo.upsertMarket(market());
    repo.upsertMarket(
      market({ ticker: 'KXHIGHNY-26APR08-T60', status: 'settled' }),
    );
    repo.insertDiscrepancy({
      market_ticker: 'KXHIGHNY-26APR08-T55',
      sampled_at: new Date().toISOString(),
      market_implied_p: 0.3,
      weather_implied_p: 1.0,
      edge: 0.7,
      would_trade: 1,
      simulated_side: 'yes',
      simulated_size_usd: 50,
      simulated_fill_price: 0.31,
      reasoning: 'test',
    });

    const s = svc.getSummary();
    expect(s.markets.tracked).toBe(2);
    expect(s.markets.active).toBe(1);
    expect(s.markets.settled).toBe(1);
    expect(s.discrepancies.total).toBe(1);
    expect(s.discrepancies.wouldTradeTotal).toBe(1);
    expect(s.discrepancies.last24h).toBe(1);
  });

  it('listDiscrepancies filters and limits', () => {
    repo.upsertMarket(market());
    for (let i = 0; i < 5; i++) {
      repo.insertDiscrepancy({
        market_ticker: market().ticker,
        sampled_at: `2026-04-08T1${i}:00:00Z`,
        market_implied_p: 0.3,
        weather_implied_p: 1.0,
        edge: 0.7,
        would_trade: i % 2 === 0 ? 1 : 0,
        simulated_side: 'yes',
        simulated_size_usd: null,
        simulated_fill_price: null,
        reasoning: `discrepancy ${i}`,
      });
    }
    const all = svc.listDiscrepancies({});
    expect(all).toHaveLength(5);
    expect(all[0].reasoning).toBe('discrepancy 4'); // newest first

    const tradesOnly = svc.listDiscrepancies({ wouldTradeOnly: true });
    expect(tradesOnly).toHaveLength(3);

    const since = svc.listDiscrepancies({ since: '2026-04-08T13:00:00Z' });
    expect(since).toHaveLength(2);

    const limited = svc.listDiscrepancies({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('listPositions filters by open/closed', () => {
    repo.upsertMarket(market());
    const id1 = repo.openPosition({
      market_ticker: market().ticker,
      opened_at: '2026-04-08T15:00:00Z',
      side: 'yes',
      size_usd: 50,
      entry_price: 0.4,
    });
    repo.closePosition(id1, '2026-04-09T14:00:00Z', 'yes', 75);

    repo.openPosition({
      market_ticker: market().ticker,
      opened_at: '2026-04-09T15:00:00Z',
      side: 'no',
      size_usd: 30,
      entry_price: 0.55,
    });

    expect(svc.listPositions({ status: 'open' })).toHaveLength(1);
    expect(svc.listPositions({ status: 'closed' })).toHaveLength(1);
    expect(svc.listPositions()).toHaveLength(2);
  });

  it('listMappingErrors returns positions where definitive signal disagreed with outcome', () => {
    const opened = '2026-04-08T15:00:00Z';
    repo.upsertMarket(market());
    repo.upsertMarket(market({ ticker: 'KXHIGHNY-26APR08-T60' }));

    // Case 1: wP=1 (strong YES) but resolved NO — mapping error
    const id1 = repo.openPosition({
      market_ticker: market().ticker,
      opened_at: opened,
      side: 'yes',
      size_usd: 50,
      entry_price: 0.4,
    });
    repo.insertDiscrepancy({
      market_ticker: market().ticker,
      sampled_at: opened,
      market_implied_p: 0.4,
      weather_implied_p: 1.0,
      edge: 0.6,
      would_trade: 1,
      simulated_side: 'yes',
      simulated_size_usd: 50,
      simulated_fill_price: 0.4,
      reasoning: 'CLI max=56 > 55; resolved YES (or so we thought)',
    });
    repo.closePosition(id1, '2026-04-09T14:00:00Z', 'no', -50);

    // Case 2: wP=0.5 (uncertain) losing position — NOT a mapping error
    const id2 = repo.openPosition({
      market_ticker: 'KXHIGHNY-26APR08-T60',
      opened_at: opened,
      side: 'yes',
      size_usd: 30,
      entry_price: 0.5,
    });
    repo.insertDiscrepancy({
      market_ticker: 'KXHIGHNY-26APR08-T60',
      sampled_at: opened,
      market_implied_p: 0.5,
      weather_implied_p: 0.5,
      edge: 0,
      would_trade: 0,
      simulated_side: 'yes',
      simulated_size_usd: 30,
      simulated_fill_price: 0.5,
      reasoning: 'ambiguous',
    });
    repo.closePosition(id2, '2026-04-09T14:00:00Z', 'no', -30);

    const errors = svc.listMappingErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0].market_ticker).toBe('KXHIGHNY-26APR08-T55');
    expect(errors[0].weather_implied_p_at_open).toBe(1.0);
    expect(errors[0].resolution_outcome).toBe('no');
  });
});
