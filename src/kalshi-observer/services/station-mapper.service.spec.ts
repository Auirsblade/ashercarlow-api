import { StationMapperService } from './station-mapper.service';

describe('StationMapperService', () => {
  let svc: StationMapperService;

  beforeEach(() => {
    svc = new StationMapperService();
  });

  it('loads all curated regions', () => {
    const regions = svc.listRegions();
    expect(regions).toEqual(
      expect.arrayContaining([
        'nyc',
        'lax',
        'chi_midway',
        'mia',
        'bos',
        'dca',
        'dfw',
      ]),
    );
  });

  it('returns station config with KMDW for chi_midway (not KORD)', () => {
    const cfg = svc.getRegion('chi_midway');
    expect(cfg.primary_station.icao).toBe('KMDW');
    expect(cfg.nws_cli_location_id).toBe('MDW');
    expect(cfg.divergence_notes).toContain('KMDW');
  });

  it('returns KLAX for lax (not KCQT)', () => {
    const cfg = svc.getRegion('lax');
    expect(cfg.primary_station.icao).toBe('KLAX');
  });

  it('returns KDCA for dca (not KIAD)', () => {
    const cfg = svc.getRegion('dca');
    expect(cfg.primary_station.icao).toBe('KDCA');
  });

  it('throws on unknown region', () => {
    expect(() => svc.getRegion('atlanta')).toThrow(/Unknown region/);
  });

  it('asserts correct ICAO for region, rejects mismatched ICAO', () => {
    expect(() => svc.assertIcaoForRegion('chi_midway', 'KMDW')).not.toThrow();
    expect(() => svc.assertIcaoForRegion('chi_midway', 'KORD')).toThrow(
      /Station mismatch/,
    );
    expect(() => svc.assertIcaoForRegion('lax', 'KCQT')).toThrow(
      /Station mismatch/,
    );
  });

  it('lists all unique ICAOs across regions', () => {
    const icaos = svc.listAllIcaos();
    expect(icaos).toEqual(
      expect.arrayContaining([
        'KNYC',
        'KLAX',
        'KMDW',
        'KMIA',
        'KBOS',
        'KDCA',
        'KDFW',
      ]),
    );
    // no duplicates
    expect(new Set(icaos).size).toBe(icaos.length);
  });

  it('lists all CLI locations with WFO pairing', () => {
    const locs = svc.listAllCliLocations();
    expect(locs).toContainEqual({ locationId: 'MDW', wfo: 'LOT' });
    expect(locs).toContainEqual({ locationId: 'NYC', wfo: 'OKX' });
  });
});
