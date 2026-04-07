import {
  ObserverRepository,
  TrackedMarketRow,
} from '../storage/observer.repository';
import { DiscrepancyService } from './discrepancy.service';
import { SimulatorService } from './simulator.service';
import { WeatherSignalService } from './weather-signal.service';

describe('DiscrepancyService', () => {
  let repo: ObserverRepository;
  let signals: WeatherSignalService;
  let simulator: SimulatorService;
  let svc: DiscrepancyService;

  const sampleMarket = (
    overrides: Partial<TrackedMarketRow> = {},
  ): TrackedMarketRow => ({
    ticker: 'KXHIGHNY-26APR08-T55',
    event_ticker: 'KXHIGHNY-26APR08',
    series_ticker: 'KXHIGHNY',
    category: 'high_temp',
    region: 'nyc',
    title: 'NY high > 55',
    rules_primary: null,
    threshold_json: JSON.stringify({ op: 'greater', value: 55 }),
    expected_expiration_time: null,
    latest_expiration_time: null,
    resolution_source_json: JSON.stringify({
      agency: 'NWS',
      wfo: 'OKX',
      cli_location_id: 'NYC',
      station_id: 'KNYC',
    }),
    mapped_metar_icao: 'KNYC',
    mapping_confidence: 'high',
    mapping_notes: null,
    status: 'active',
    first_seen_at: '2026-04-08T00:00:00Z',
    last_seen_at: '2026-04-08T00:00:00Z',
    ...overrides,
  });

  const goodPrice = (ticker: string, yesMid: number, liquidity = 500) => {
    repo.insertPriceSample({
      ticker,
      sampled_at: '2026-04-08T15:00:00Z',
      yes_ask: yesMid + 0.01,
      yes_bid: yesMid - 0.01,
      no_ask: 1 - yesMid + 0.01,
      no_bid: 1 - yesMid - 0.01,
      last_price: yesMid,
      volume_24h: 5000,
      open_interest: 1000,
      liquidity,
    });
  };

  const insertMetar = (icao: string, atIso: string, tempC: number) => {
    repo.insertMetarSample({
      icao,
      observed_at: atIso,
      temp_c: tempC,
      dewpoint_c: null,
      wind_kt: null,
      gust_kt: null,
      visibility: null,
      wx_phenomena: null,
      raw: null,
    });
  };

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
    signals = new WeatherSignalService(repo);
    simulator = new SimulatorService(repo);
    svc = new DiscrepancyService(repo, signals, simulator);
  });

  afterEach(() => {
    repo.close();
  });

  it('trades on CLI-resolved YES with enough edge', () => {
    repo.upsertMarket(sampleMarket());
    repo.insertNwsCliSample({
      cli_location_id: 'NYC',
      product_id: 'cli-1',
      issuance_time: '2026-04-09T06:00:00Z',
      observation_date: '2026-04-08',
      max_temp_f: 60,
      min_temp_f: 45,
      precip_in: 0,
      precip_is_trace: 0,
      raw_text: 'raw',
    });
    goodPrice('KXHIGHNY-26APR08-T55', 0.3); // market thinks 30%, CLI says YES

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);

    expect(result.signal.status).toBe('already_resolved_yes');
    expect(result.edge).toBeCloseTo(0.7);
    expect(result.wouldTrade).toBe(true);
    expect(result.side).toBe('yes');
    expect(result.skipReason).toBeNull();
  });

  it('skips when edge is below 0.15 threshold', () => {
    repo.upsertMarket(sampleMarket());
    repo.insertNwsCliSample({
      cli_location_id: 'NYC',
      product_id: 'cli-1',
      issuance_time: '2026-04-09T06:00:00Z',
      observation_date: '2026-04-08',
      max_temp_f: 60,
      min_temp_f: 45,
      precip_in: 0,
      precip_is_trace: 0,
      raw_text: 'raw',
    });
    goodPrice('KXHIGHNY-26APR08-T55', 0.9); // market already at 90%, edge is 0.1

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);

    expect(result.wouldTrade).toBe(false);
    expect(result.skipReason).toMatch(/edge.*below-threshold/);
  });

  it('skips on running_guaranteed_yes with METAR margin < 1.0°F', () => {
    repo.upsertMarket(
      sampleMarket({
        threshold_json: JSON.stringify({ op: 'greater', value: 55 }),
      }),
    );
    // 13°C = 55.4°F, just 0.4°F above threshold 55 — too thin for CLI rounding
    insertMetar('KNYC', '2026-04-08T15:00:00Z', 13.0);
    goodPrice('KXHIGHNY-26APR08-T55', 0.3);

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);

    expect(result.signal.status).toBe('running_guaranteed_yes');
    expect(result.wouldTrade).toBe(false);
    expect(result.skipReason).toMatch(/metar-margin/);
  });

  it('trades on running_guaranteed_yes when METAR margin >= 1.0°F', () => {
    repo.upsertMarket(
      sampleMarket({
        threshold_json: JSON.stringify({ op: 'greater', value: 55 }),
      }),
    );
    // 14°C = 57.2°F, comfortably above 55
    insertMetar('KNYC', '2026-04-08T15:00:00Z', 14.0);
    goodPrice('KXHIGHNY-26APR08-T55', 0.3);

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);

    expect(result.signal.status).toBe('running_guaranteed_yes');
    expect(result.wouldTrade).toBe(true);
    expect(result.side).toBe('yes');
  });

  it('skips when signal is needs_forecast', () => {
    repo.upsertMarket(
      sampleMarket({
        threshold_json: JSON.stringify({ op: 'greater', value: 80 }),
      }),
    );
    insertMetar('KNYC', '2026-04-08T15:00:00Z', 10.0); // 50°F, below 80
    goodPrice('KXHIGHNY-26APR08-T55', 0.3);

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);

    expect(result.signal.status).toBe('needs_forecast');
    expect(result.wouldTrade).toBe(false);
    expect(result.skipReason).toBe('signal-needs_forecast');
  });

  it('skips when spread is too wide', () => {
    repo.upsertMarket(sampleMarket());
    repo.insertNwsCliSample({
      cli_location_id: 'NYC',
      product_id: 'cli-1',
      issuance_time: '2026-04-09T06:00:00Z',
      observation_date: '2026-04-08',
      max_temp_f: 60,
      min_temp_f: 45,
      precip_in: 0,
      precip_is_trace: 0,
      raw_text: 'raw',
    });
    repo.insertPriceSample({
      ticker: 'KXHIGHNY-26APR08-T55',
      sampled_at: '2026-04-08T15:00:00Z',
      yes_ask: 0.4,
      yes_bid: 0.3, // 10-cent spread
      no_ask: null,
      no_bid: null,
      last_price: null,
      volume_24h: null,
      open_interest: null,
      liquidity: 500,
    });

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);
    expect(result.skipReason).toMatch(/spread.*too-wide/);
  });

  it('skips when liquidity is below $200', () => {
    repo.upsertMarket(sampleMarket());
    repo.insertNwsCliSample({
      cli_location_id: 'NYC',
      product_id: 'cli-1',
      issuance_time: '2026-04-09T06:00:00Z',
      observation_date: '2026-04-08',
      max_temp_f: 60,
      min_temp_f: 45,
      precip_in: 0,
      precip_is_trace: 0,
      raw_text: 'raw',
    });
    goodPrice('KXHIGHNY-26APR08-T55', 0.3, 50); // $50 liquidity

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);
    expect(result.skipReason).toMatch(/liquidity-50/);
  });

  it('skips when there is already an open position', () => {
    repo.upsertMarket(sampleMarket());
    repo.insertNwsCliSample({
      cli_location_id: 'NYC',
      product_id: 'cli-1',
      issuance_time: '2026-04-09T06:00:00Z',
      observation_date: '2026-04-08',
      max_temp_f: 60,
      min_temp_f: 45,
      precip_in: 0,
      precip_is_trace: 0,
      raw_text: 'raw',
    });
    goodPrice('KXHIGHNY-26APR08-T55', 0.3);
    repo.openPosition({
      market_ticker: 'KXHIGHNY-26APR08-T55',
      opened_at: '2026-04-08T14:00:00Z',
      side: 'yes',
      size_usd: 50,
      entry_price: 0.31,
    });

    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const result = svc.evaluateMarket(market);
    expect(result.skipReason).toMatch(/position-already-open/);
  });

  it('scanAll persists discrepancy rows for every tracked market', () => {
    repo.upsertMarket(sampleMarket());
    repo.upsertMarket(
      sampleMarket({
        ticker: 'KXHIGHNY-26APR08-T60',
        threshold_json: JSON.stringify({ op: 'greater', value: 60 }),
      }),
    );
    goodPrice('KXHIGHNY-26APR08-T55', 0.3);
    goodPrice('KXHIGHNY-26APR08-T60', 0.3);

    const summary = svc.scanAll();
    expect(summary.evaluated).toBe(2);

    // Verify rows landed
    const db = (
      repo as unknown as {
        db: { prepare: (s: string) => { get: () => { count: number } } };
      }
    ).db;
    const row = db.prepare('SELECT COUNT(*) as count FROM discrepancy').get();
    expect(row.count).toBe(2);
  });
});
