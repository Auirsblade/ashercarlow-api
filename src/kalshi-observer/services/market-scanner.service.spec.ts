import { KalshiClient } from '../clients/kalshi.client';
import { ObserverRepository } from '../storage/observer.repository';
import { MarketScannerService } from './market-scanner.service';
import { StationMapperService } from './station-mapper.service';

describe('MarketScannerService', () => {
  let kalshi: jest.Mocked<KalshiClient>;
  let stations: StationMapperService;
  let repo: ObserverRepository;
  let scanner: MarketScannerService;

  beforeEach(() => {
    stations = new StationMapperService();
    repo = new ObserverRepository();
    repo.useInMemoryForTests();

    kalshi = {
      listEvents: jest.fn(),
      listMarkets: jest.fn(),
    } as unknown as jest.Mocked<KalshiClient>;

    scanner = new MarketScannerService(kalshi, stations, repo);
  });

  afterEach(() => {
    repo.close();
  });

  it('loads curated configs and validates station mappings at construction', () => {
    const configs = scanner.getCuratedConfigs();
    expect(configs.length).toBeGreaterThanOrEqual(7);
    const nyHigh = configs.find((c) => c.series_ticker === 'KXHIGHNY');
    expect(nyHigh?.mapped_metar_icao).toBe('KNYC');
    const chi = configs.find((c) => c.series_ticker === 'KXHIGHCHI');
    expect(chi?.mapped_metar_icao).toBe('KMDW');
  });

  it('refresh() walks series -> events -> markets and upserts rows', async () => {
    kalshi.listEvents.mockResolvedValue([
      {
        event_ticker: 'KXHIGHNY-26APR08',
        series_ticker: 'KXHIGHNY',
        title: 'NY high Apr 8',
      },
    ]);
    kalshi.listMarkets.mockResolvedValue([
      {
        ticker: 'KXHIGHNY-26APR08-T55',
        event_ticker: 'KXHIGHNY-26APR08',
        rules_primary: 'Max temp at Central Park > 55F',
        strike_type: 'greater',
        floor_strike: 55,
        yes_ask_dollars: '0.62',
        status: 'active',
      },
      {
        ticker: 'KXHIGHNY-26APR08-B50.5',
        event_ticker: 'KXHIGHNY-26APR08',
        rules_primary: 'Max temp at Central Park between 50 and 51F',
        strike_type: 'between',
        floor_strike: 50,
        cap_strike: 51,
        yes_ask_dollars: '0.34',
        status: 'active',
      },
    ]);

    const summary = await scanner.refresh();

    // 10 curated series, each calls listEvents/listMarkets (mocked uniformly)
    expect(summary.seriesScanned).toBeGreaterThanOrEqual(10);
    expect(summary.marketsUpserted).toBeGreaterThan(0);
    expect(summary.errors).toHaveLength(0);

    const stored = repo.getMarket('KXHIGHNY-26APR08-T55');
    expect(stored?.series_ticker).toBe('KXHIGHNY');
    expect(stored?.mapped_metar_icao).toBe('KNYC');
    expect(stored?.region).toBe('nyc');
    expect(stored?.threshold_json).toBe('{"op":"greater","value":55}');
    expect(stored?.mapping_confidence).toBe('high');

    const bucket = repo.getMarket('KXHIGHNY-26APR08-B50.5');
    expect(bucket?.threshold_json).toContain('between');
    expect(bucket?.threshold_json).toContain('"floor":50');
    expect(bucket?.threshold_json).toContain('"cap":51');
  });

  it('records errors per-series and keeps going', async () => {
    kalshi.listEvents.mockImplementation(({ series_ticker }) => {
      if (series_ticker === 'KXHIGHNY') {
        return Promise.reject(new Error('kaboom'));
      }
      return Promise.resolve([]);
    });
    kalshi.listMarkets.mockResolvedValue([]);

    const summary = await scanner.refresh();
    expect(summary.errors.some((e) => e.series === 'KXHIGHNY')).toBe(true);
    expect(summary.seriesScanned).toBeGreaterThan(1);
  });
});
