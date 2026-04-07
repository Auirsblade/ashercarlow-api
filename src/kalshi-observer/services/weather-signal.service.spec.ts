import {
  ObserverRepository,
  TrackedMarketRow,
} from '../storage/observer.repository';
import { WeatherSignalService } from './weather-signal.service';

describe('WeatherSignalService', () => {
  let repo: ObserverRepository;
  let svc: WeatherSignalService;

  const baseMarket = (
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
    expected_expiration_time: '2026-04-09T14:00:00Z',
    latest_expiration_time: '2026-04-15T14:00:00Z',
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

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
    svc = new WeatherSignalService(repo);
  });

  afterEach(() => {
    repo.close();
  });

  describe('high_temp', () => {
    it('returns p=1.0 when running METAR max already clears threshold', () => {
      repo.upsertMarket(baseMarket());
      // METAR samples on Apr 8 UTC window — 60°F > 55 threshold
      repo.insertMetarSample({
        icao: 'KNYC',
        observed_at: '2026-04-08T15:00:00Z',
        temp_c: 15.56, // 60°F
        dewpoint_c: null,
        wind_kt: null,
        gust_kt: null,
        visibility: null,
        wx_phenomena: null,
        raw: null,
      });

      const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('running_guaranteed_yes');
      expect(sig.weatherImpliedP).toBe(1.0);
      expect(sig.reasoning).toMatch(/60/);
    });

    it('returns p=0.5 with needs_forecast when below threshold', () => {
      repo.upsertMarket(baseMarket());
      repo.insertMetarSample({
        icao: 'KNYC',
        observed_at: '2026-04-08T15:00:00Z',
        temp_c: 10.0, // 50°F, below 55
        dewpoint_c: null,
        wind_kt: null,
        gust_kt: null,
        visibility: null,
        wx_phenomena: null,
        raw: null,
      });

      const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('needs_forecast');
      expect(sig.weatherImpliedP).toBe(0.5);
    });

    it('uses CLI as ground truth when available for the observation day', () => {
      repo.upsertMarket(baseMarket());
      repo.insertNwsCliSample({
        cli_location_id: 'NYC',
        product_id: 'cli-nyc-1',
        issuance_time: '2026-04-09T06:00:00Z', // issued next morning for Apr 8
        observation_date: '2026-04-08',
        max_temp_f: 57,
        min_temp_f: 42,
        precip_in: 0,
        precip_is_trace: 0,
        raw_text: 'raw',
      });

      const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('already_resolved_yes');
      expect(sig.weatherImpliedP).toBe(1.0);
      expect(sig.reasoning).toContain('CLI');
    });

    it('handles "between" bucket threshold', () => {
      repo.upsertMarket(
        baseMarket({
          ticker: 'KXHIGHNY-26APR08-B55.5',
          threshold_json: JSON.stringify({ op: 'between', floor: 55, cap: 56 }),
        }),
      );
      // 14°C = 57.2°F, which is above the [55, 56] bucket cap — "between"
      // triggers guaranteed_no since daily max can only go up from here.
      repo.insertMetarSample({
        icao: 'KNYC',
        observed_at: '2026-04-08T15:00:00Z',
        temp_c: 14.0,
        dewpoint_c: null,
        wind_kt: null,
        gust_kt: null,
        visibility: null,
        wx_phenomena: null,
        raw: null,
      });

      const market = repo.getMarket('KXHIGHNY-26APR08-B55.5')!;
      const sig = svc.estimate(market);
      // 57.2°F > cap 56: max is locked above the bucket — guaranteed NO.
      expect(sig.status).toBe('running_guaranteed_no');
      expect(sig.weatherImpliedP).toBe(0.0);
    });

    it('returns needs_forecast when running max is inside the between bucket', () => {
      repo.upsertMarket(
        baseMarket({
          ticker: 'KXHIGHNY-26APR08-B55.5',
          threshold_json: JSON.stringify({ op: 'between', floor: 55, cap: 56 }),
        }),
      );
      // 13°C = 55.4°F, inside [55, 56]. Can still bust above as the day
      // warms, so we don't know yet — needs_forecast.
      repo.insertMetarSample({
        icao: 'KNYC',
        observed_at: '2026-04-08T15:00:00Z',
        temp_c: 13.0,
        dewpoint_c: null,
        wind_kt: null,
        gust_kt: null,
        visibility: null,
        wx_phenomena: null,
        raw: null,
      });

      const market = repo.getMarket('KXHIGHNY-26APR08-B55.5')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('needs_forecast');
    });

    it('returns insufficient_data when no METAR samples in window', () => {
      repo.upsertMarket(baseMarket());
      const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('insufficient_data');
      expect(sig.weatherImpliedP).toBe(0.5);
    });
  });

  describe('low_temp', () => {
    it('returns p=0.0 (guaranteed_no) when running min already fell below threshold', () => {
      repo.upsertMarket(
        baseMarket({
          ticker: 'KXLOWTNYC-26APR08-T39',
          event_ticker: 'KXLOWTNYC-26APR08',
          series_ticker: 'KXLOWTNYC',
          category: 'low_temp',
          threshold_json: JSON.stringify({ op: 'greater', value: 39 }),
        }),
      );
      repo.insertMetarSample({
        icao: 'KNYC',
        observed_at: '2026-04-08T10:00:00Z',
        temp_c: 2.0, // ~35°F
        dewpoint_c: null,
        wind_kt: null,
        gust_kt: null,
        visibility: null,
        wx_phenomena: null,
        raw: null,
      });

      const market = repo.getMarket('KXLOWTNYC-26APR08-T39')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('running_guaranteed_no');
      expect(sig.weatherImpliedP).toBe(0.0);
    });
  });

  describe('precip_daily', () => {
    it('returns already_resolved_yes when CLI precip clears threshold', () => {
      repo.upsertMarket(
        baseMarket({
          ticker: 'KXRAINNYC-26APR08-T0',
          event_ticker: 'KXRAINNYC-26APR08',
          series_ticker: 'KXRAINNYC',
          category: 'precip_daily',
          threshold_json: JSON.stringify({ op: 'greater', value: 0 }),
        }),
      );
      repo.insertNwsCliSample({
        cli_location_id: 'NYC',
        product_id: 'cli-nyc-rain',
        issuance_time: '2026-04-09T06:00:00Z',
        observation_date: '2026-04-08',
        max_temp_f: null,
        min_temp_f: null,
        precip_in: 0.12,
        precip_is_trace: 0,
        raw_text: 'raw',
      });

      const market = repo.getMarket('KXRAINNYC-26APR08-T0')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('already_resolved_yes');
      expect(sig.weatherImpliedP).toBe(1.0);
    });

    it('returns insufficient_data when no CLI available', () => {
      repo.upsertMarket(
        baseMarket({
          ticker: 'KXRAINNYC-26APR08-T0',
          event_ticker: 'KXRAINNYC-26APR08',
          category: 'precip_daily',
          threshold_json: JSON.stringify({ op: 'greater', value: 0 }),
        }),
      );
      const market = repo.getMarket('KXRAINNYC-26APR08-T0')!;
      const sig = svc.estimate(market);
      expect(sig.status).toBe('insufficient_data');
    });
  });

  it('returns unknown_category gracefully', () => {
    repo.upsertMarket(baseMarket({ category: 'tornado_count' }));
    const market = repo.getMarket('KXHIGHNY-26APR08-T55')!;
    const sig = svc.estimate(market);
    expect(sig.status).toBe('unknown_category');
  });
});
