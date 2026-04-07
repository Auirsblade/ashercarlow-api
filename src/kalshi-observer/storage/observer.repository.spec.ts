import { ObserverRepository, TrackedMarketRow } from './observer.repository';

describe('ObserverRepository', () => {
  let repo: ObserverRepository;

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
  });

  afterEach(() => {
    repo.close();
  });

  const sampleMarket: TrackedMarketRow = {
    ticker: 'KXHIGHNY-26APR08-T55',
    event_ticker: 'KXHIGHNY-26APR08',
    series_ticker: 'KXHIGHNY',
    category: 'high_temp',
    region: 'nyc',
    title: 'NY High Temp',
    rules_primary: 'Max temp at KNYC > 55F per NWS CLI',
    threshold_json: JSON.stringify({ op: '>', value: 55 }),
    expected_expiration_time: '2026-04-09T14:00:00Z',
    latest_expiration_time: '2026-04-15T14:00:00Z',
    resolution_source_json: JSON.stringify({ agency: 'NWS', wfo: 'OKX' }),
    mapped_metar_icao: 'KNYC',
    mapping_confidence: 'high',
    mapping_notes: 'Central Park',
    status: 'active',
    first_seen_at: '2026-04-07T10:00:00Z',
    last_seen_at: '2026-04-07T10:00:00Z',
  };

  it('upserts and retrieves markets', () => {
    repo.upsertMarket(sampleMarket);
    const got = repo.getMarket(sampleMarket.ticker);
    expect(got?.series_ticker).toBe('KXHIGHNY');
    expect(got?.mapped_metar_icao).toBe('KNYC');
  });

  it('upsert preserves first_seen_at on update', () => {
    repo.upsertMarket(sampleMarket);
    repo.upsertMarket({
      ...sampleMarket,
      first_seen_at: '2099-01-01T00:00:00Z', // should be ignored on conflict
      last_seen_at: '2026-04-07T11:00:00Z',
      status: 'closed',
    });
    const got = repo.getMarket(sampleMarket.ticker);
    expect(got?.first_seen_at).toBe('2026-04-07T10:00:00Z');
    expect(got?.last_seen_at).toBe('2026-04-07T11:00:00Z');
    expect(got?.status).toBe('closed');
  });

  it('lists markets filtered by status', () => {
    repo.upsertMarket(sampleMarket);
    repo.upsertMarket({
      ...sampleMarket,
      ticker: 'KXHIGHNY-26APR08-T60',
      status: 'closed',
    });
    const active = repo.listTrackedMarkets({ status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].ticker).toBe('KXHIGHNY-26APR08-T55');
  });

  it('inserts price samples', () => {
    repo.upsertMarket(sampleMarket);
    repo.insertPriceSample({
      ticker: sampleMarket.ticker,
      sampled_at: '2026-04-07T10:05:00Z',
      yes_ask: 0.62,
      yes_bid: 0.6,
      no_ask: 0.4,
      no_bid: 0.38,
      last_price: 0.61,
      volume_24h: 12345,
      open_interest: 9999,
      liquidity: 5000,
    });
    // Smoke: no throw is sufficient for Phase 1
  });

  it('opens, closes, and finds simulated positions', () => {
    repo.upsertMarket(sampleMarket);
    const id = repo.openPosition({
      market_ticker: sampleMarket.ticker,
      opened_at: '2026-04-07T10:10:00Z',
      side: 'yes',
      size_usd: 50,
      entry_price: 0.62,
    });

    const open = repo.findOpenPositionForMarket(sampleMarket.ticker);
    expect(open?.id).toBe(id);

    repo.closePosition(id, '2026-04-08T14:00:00Z', 'yes', 30);
    expect(repo.findOpenPositionForMarket(sampleMarket.ticker)).toBeUndefined();
    expect(repo.listOpenPositions()).toHaveLength(0);
  });
});
