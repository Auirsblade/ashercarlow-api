import { MarketDataClient } from './market-data.client';

describe('MarketDataClient', () => {
  let client: MarketDataClient;

  beforeEach(() => {
    client = new MarketDataClient();
  });

  describe('parseYahooChart', () => {
    it('parses a Yahoo chart response into daily bars', () => {
      const response = {
        chart: {
          result: [
            {
              timestamp: [1744070400, 1744156800], // 2026-04-08, 2026-04-09
              indicators: {
                quote: [
                  {
                    open: [25.0, 26.0],
                    high: [26.5, 27.0],
                    low: [24.5, 25.5],
                    close: [25.78, 26.42],
                  },
                ],
              },
            },
          ],
          error: null,
        },
      };
      const bars = client.parseYahooChart(response);
      expect(bars).toHaveLength(2);
      expect(bars[0].close).toBe(25.78);
      expect(bars[1].close).toBe(26.42);
      // Date is derived from the unix timestamp (UTC)
      expect(bars[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('skips bars with null close prices', () => {
      const response = {
        chart: {
          result: [
            {
              timestamp: [1744070400, 1744156800, 1744243200],
              indicators: {
                quote: [
                  {
                    open: [25.0, null, 27.0],
                    high: [26.5, null, 28.0],
                    low: [24.5, null, 26.5],
                    close: [25.78, null, 27.42],
                  },
                ],
              },
            },
          ],
          error: null,
        },
      };
      const bars = client.parseYahooChart(response);
      expect(bars).toHaveLength(2);
    });

    it('returns empty array on error response', () => {
      const response = {
        chart: {
          error: { code: 'unauthorized', description: 'User not logged in' },
        },
      };
      expect(client.parseYahooChart(response)).toEqual([]);
    });

    it('returns empty array when result is missing', () => {
      expect(client.parseYahooChart({ chart: {} })).toEqual([]);
    });
  });

  describe('parseStooqCsv (legacy fallback)', () => {
    it('parses a normal Stooq CSV with Volume column', () => {
      const csv = [
        'Date,Open,High,Low,Close,Volume',
        '2026-04-07,25.10,26.50,24.80,25.78,0',
        '2026-04-04,24.20,25.30,23.90,25.10,0',
      ].join('\n');
      const bars = client.parseStooqCsv(csv);
      expect(bars).toHaveLength(2);
      expect(bars[0]).toEqual({
        date: '2026-04-07',
        open: 25.1,
        high: 26.5,
        low: 24.8,
        close: 25.78,
      });
    });

    it('tolerates a CSV without Volume column', () => {
      const csv = [
        'Date,Open,High,Low,Close',
        '2026-04-07,25.10,26.50,24.80,25.78',
      ].join('\n');
      const bars = client.parseStooqCsv(csv);
      expect(bars).toHaveLength(1);
      expect(bars[0].close).toBe(25.78);
    });

    it('returns empty for malformed CSV', () => {
      expect(client.parseStooqCsv('')).toEqual([]);
      expect(client.parseStooqCsv('garbage')).toEqual([]);
    });

    it('skips lines with invalid close values', () => {
      const csv = [
        'Date,Open,High,Low,Close',
        '2026-04-07,25.10,26.50,24.80,25.78',
        '2026-04-08,N/A,N/A,N/A,N/A',
        '2026-04-09,26.00,27.00,25.50,26.40',
      ].join('\n');
      const bars = client.parseStooqCsv(csv);
      expect(bars).toHaveLength(2);
      expect(bars.map((b) => b.date)).toEqual(['2026-04-07', '2026-04-09']);
    });
  });
});
