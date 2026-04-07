import { FaaNasStatusClient } from '../clients/faa-nas-status.client';
import { MetarClient } from '../clients/metar.client';
import { NwsClient } from '../clients/nws.client';
import { ObserverRepository } from '../storage/observer.repository';
import { DiscrepancyService } from './discrepancy.service';
import { MarketScannerService } from './market-scanner.service';
import { ResolutionTrackerService } from './resolution-tracker.service';
import { SamplingService } from './sampling.service';
import { StationMapperService } from './station-mapper.service';

describe('SamplingService', () => {
  let repo: ObserverRepository;
  let stations: StationMapperService;
  let scanner: jest.Mocked<MarketScannerService>;
  let metar: jest.Mocked<MetarClient>;
  let nws: jest.Mocked<NwsClient>;
  let faa: jest.Mocked<FaaNasStatusClient>;
  let discrepancy: jest.Mocked<DiscrepancyService>;
  let resolutions: jest.Mocked<ResolutionTrackerService>;
  let svc: SamplingService;

  beforeEach(() => {
    repo = new ObserverRepository();
    repo.useInMemoryForTests();
    stations = new StationMapperService();

    scanner = {
      refresh: jest.fn().mockResolvedValue({
        seriesScanned: 10,
        eventsFound: 19,
        marketsUpserted: 100,
        priceSamplesInserted: 100,
        errors: [],
      }),
    } as unknown as jest.Mocked<MarketScannerService>;

    metar = {
      getMetar: jest.fn(),
    } as unknown as jest.Mocked<MetarClient>;

    nws = {
      getLatestCli: jest.fn(),
    } as unknown as jest.Mocked<NwsClient>;

    faa = {
      getEventsForAirports: jest.fn(),
    } as unknown as jest.Mocked<FaaNasStatusClient>;

    discrepancy = {
      scanAll: jest.fn().mockReturnValue({
        evaluated: 0,
        withSignal: 0,
        wouldTradeCount: 0,
        openedCount: 0,
        topEdges: [],
      }),
    } as unknown as jest.Mocked<DiscrepancyService>;

    resolutions = {
      checkResolutions: jest.fn().mockResolvedValue({
        openPositionsChecked: 0,
        closed: 0,
        errors: 0,
      }),
    } as unknown as jest.Mocked<ResolutionTrackerService>;

    svc = new SamplingService(
      scanner,
      stations,
      metar,
      nws,
      faa,
      repo,
      discrepancy,
      resolutions,
    );
  });

  afterEach(() => {
    repo.close();
  });

  describe('sampleMetar', () => {
    it('fetches METAR for all station ICAOs and persists rows', async () => {
      metar.getMetar.mockResolvedValue([
        {
          icaoId: 'KNYC',
          obsTime: 1712500000,
          temp: 10.5,
          dewp: 5,
          wspd: 8,
          rawOb: 'KNYC 071500Z ...',
        },
        {
          icaoId: 'KMDW',
          obsTime: 1712500000,
          temp: 1.1,
          dewp: -2,
          wspd: 12,
          rawOb: 'KMDW 071500Z ...',
        },
      ]);

      const out = await svc.sampleMetar();
      expect(out.stationsQueried).toBeGreaterThanOrEqual(7);
      expect(out.samplesInserted).toBe(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(metar.getMetar).toHaveBeenCalledWith(
        expect.arrayContaining(['KNYC', 'KMDW', 'KLAX']),
        1,
      );
    });

    it('skips observations without obsTime', async () => {
      metar.getMetar.mockResolvedValue([
        { icaoId: 'KNYC', temp: 10 }, // no obsTime
      ]);
      const out = await svc.sampleMetar();
      expect(out.samplesInserted).toBe(0);
    });
  });

  describe('sampleNwsCli', () => {
    it('fetches + persists CLI for every curated location', async () => {
      nws.getLatestCli.mockResolvedValue({
        issuanceTime: '2026-04-07T08:00:00Z',
        productId: 'cli-nyc-1',
        issuingOffice: 'OKX',
        maxTempF: 57,
        minTempF: 41,
        precipIn: 0.02,
        precipIsTrace: false,
        rawText: 'RAW CLI TEXT',
      });

      const out = await svc.sampleNwsCli();
      expect(out.locationsQueried).toBeGreaterThanOrEqual(7);
      expect(out.samplesInserted).toBeGreaterThanOrEqual(7);
    });

    it('swallows per-location errors and keeps going', async () => {
      nws.getLatestCli.mockImplementation((loc: string) => {
        if (loc === 'MDW') return Promise.reject(new Error('flaky'));
        return Promise.resolve({
          issuanceTime: '2026-04-07T08:00:00Z',
          productId: `cli-${loc}`,
          issuingOffice: 'X',
          rawText: 'raw',
        });
      });

      const out = await svc.sampleNwsCli();
      expect(out.samplesInserted).toBeGreaterThan(0);
      expect(out.samplesInserted).toBeLessThan(out.locationsQueried);
    });
  });

  describe('sampleFaa', () => {
    it('counts airports with any event type', async () => {
      faa.getEventsForAirports.mockResolvedValue(
        new Map([
          ['NYC', { airportId: 'NYC', groundDelay: { airportId: 'NYC' } }],
          ['LAX', { airportId: 'LAX' }],
        ]),
      );
      const out = await svc.sampleFaa();
      expect(out.airportsWithEvents).toBe(1);
    });
  });

  describe('tick guards', () => {
    it('tickKalshi delegates to scanner.refresh and runs discrepancy scan', async () => {
      await svc.tickKalshi();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(scanner.refresh).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(discrepancy.scanAll).toHaveBeenCalledTimes(1);
    });

    it('tickMetar swallows errors without throwing', async () => {
      metar.getMetar.mockRejectedValue(new Error('boom'));
      await expect(svc.tickMetar()).resolves.toBeUndefined();
    });
  });

  describe('KALSHI_OBSERVER_ENABLED kill switch', () => {
    const originalEnv = process.env.KALSHI_OBSERVER_ENABLED;
    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.KALSHI_OBSERVER_ENABLED;
      } else {
        process.env.KALSHI_OBSERVER_ENABLED = originalEnv;
      }
    });

    it('disables all tick methods when env flag is false', async () => {
      process.env.KALSHI_OBSERVER_ENABLED = 'false';
      const disabledSvc = new SamplingService(
        scanner,
        stations,
        metar,
        nws,
        faa,
        repo,
        discrepancy,
        resolutions,
      );

      await disabledSvc.tickKalshi();
      await disabledSvc.tickMetar();
      await disabledSvc.tickNwsCli();
      await disabledSvc.tickResolutions();
      await disabledSvc.tickFaa();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(scanner.refresh).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(discrepancy.scanAll).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(metar.getMetar).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(nws.getLatestCli).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(faa.getEventsForAirports).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(resolutions.checkResolutions).not.toHaveBeenCalled();
    });
  });
});
