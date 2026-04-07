import { NwsClient } from './nws.client';

describe('NwsClient', () => {
  let client: NwsClient;

  beforeEach(() => {
    client = new NwsClient();
  });

  describe('parseCli', () => {
    const sampleCli = `
CLIMATE REPORT
NATIONAL WEATHER SERVICE NEW YORK NY
400 AM EDT MON APR 7 2026

...THE CENTRAL PARK NY CLIMATE SUMMARY FOR APRIL 6 2026...

CLIMATE NORMAL PERIOD 1991 TO 2020
CLIMATE RECORD PERIOD 1869 TO 2026

                        YESTERDAY
                        ---------
WEATHER ITEM   OBSERVED TIME    RECORD YEAR NORMAL
                VALUE   (LST)   VALUE       VALUE
...................................................
TEMPERATURE (F)
 MAXIMUM         57R   324 PM   89    1929   59
 MINIMUM         39    558 AM   27    1923   42

PRECIPITATION (IN)
 YESTERDAY       0.02
 MONTH TO DATE   0.45
`;

    it('extracts max and min temperature', () => {
      const parsed = client.parseCli({
        id: 'CLI-NYC-1',
        issuanceTime: '2026-04-07T08:00:00Z',
        productCode: 'CLI',
        issuingOffice: 'OKX',
        productText: sampleCli,
      });

      expect(parsed.maxTempF).toBe(57);
      expect(parsed.minTempF).toBe(39);
      expect(parsed.precipIn).toBe(0.02);
      expect(parsed.precipIsTrace).toBe(false);
      expect(parsed.issuingOffice).toBe('OKX');
    });

    it('normalizes observation date to YYYY-MM-DD with numeric month', () => {
      // Regression: parser previously emitted "2026-APRIL-6" which never
      // matches the market day format "2026-04-06", causing stale CLIs to
      // be used against wrong markets.
      const parsed = client.parseCli({
        id: 'CLI-NYC-1',
        issuanceTime: '2026-04-07T08:00:00Z',
        productCode: 'CLI',
        issuingOffice: 'OKX',
        productText: sampleCli,
      });
      expect(parsed.observationDate).toBe('2026-04-06');
    });

    it('handles single-digit day in observation date', () => {
      const text = sampleCli.replace('APRIL 6 2026', 'APRIL 9 2026');
      const parsed = client.parseCli({
        id: 'CLI-NYC-2',
        issuanceTime: '2026-04-10T08:00:00Z',
        productCode: 'CLI',
        issuingOffice: 'OKX',
        productText: text,
      });
      expect(parsed.observationDate).toBe('2026-04-09');
    });

    it('handles trace precipitation as null, not zero', () => {
      const traceCli = sampleCli.replace(
        'YESTERDAY       0.02',
        'YESTERDAY       T   ',
      );
      const parsed = client.parseCli({
        id: 'CLI-NYC-2',
        issuanceTime: '2026-04-07T08:00:00Z',
        productCode: 'CLI',
        issuingOffice: 'OKX',
        productText: traceCli,
      });

      expect(parsed.precipIsTrace).toBe(true);
      expect(parsed.precipIn).toBeNull();
    });

    it('handles MM (missing) precipitation as undefined', () => {
      const mmCli = sampleCli.replace(
        'YESTERDAY       0.02',
        'YESTERDAY       MM  ',
      );
      const parsed = client.parseCli({
        id: 'CLI-NYC-3',
        issuanceTime: '2026-04-07T08:00:00Z',
        productCode: 'CLI',
        issuingOffice: 'OKX',
        productText: mmCli,
      });

      expect(parsed.precipIn).toBeUndefined();
    });

    it('handles sub-zero min temperatures', () => {
      const coldCli = sampleCli.replace(
        'MINIMUM         39',
        'MINIMUM         -5',
      );
      const parsed = client.parseCli({
        id: 'CLI-NYC-4',
        issuanceTime: '2026-01-15T08:00:00Z',
        productCode: 'CLI',
        issuingOffice: 'OKX',
        productText: coldCli,
      });

      expect(parsed.minTempF).toBe(-5);
    });
  });
});
