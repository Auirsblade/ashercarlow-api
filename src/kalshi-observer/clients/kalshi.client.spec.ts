import { KalshiClient, parseKalshiNumber } from './kalshi.client';

describe('KalshiClient', () => {
  let client: KalshiClient;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    client = new KalshiClient();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const makeResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }) as Response;

  it('lists series and filters by category', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        series: [
          {
            ticker: 'KXHIGHNY',
            title: 'NYC High',
            category: 'Climate and Weather',
          },
          { ticker: 'KXSPORTS1', title: 'Sports', category: 'Sports' },
        ],
      }),
    );

    const out = await client.listSeries({ category: 'Climate and Weather' });

    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe('KXHIGHNY');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/trade-api/v2/series?limit=500'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('parses the _dollars/_fp market field naming (strings in, numbers out)', async () => {
    // Kalshi returns these as strings, not numbers. Verified live.
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        markets: [
          {
            ticker: 'KXHIGHNY-26APR07-T55',
            yes_ask_dollars: '0.6200',
            yes_bid_dollars: '0.6000',
            volume_fp: '12345.00',
            open_interest_fp: '9999.00',
            rules_primary: 'Max temp at Central Park > 55F per NWS CLI',
          },
        ],
      }),
    );

    const out = await client.listMarkets({ series_ticker: 'KXHIGHNY' });
    expect(out[0].yes_ask_dollars).toBe('0.6200');
    expect(parseKalshiNumber(out[0].yes_ask_dollars)).toBeCloseTo(0.62);
    expect(parseKalshiNumber(out[0].volume_fp)).toBe(12345);
    expect(out[0].rules_primary).toContain('NWS CLI');
  });

  it('parseKalshiNumber handles strings, numbers, null, and garbage', () => {
    expect(parseKalshiNumber('0.06')).toBeCloseTo(0.06);
    expect(parseKalshiNumber(0.06)).toBeCloseTo(0.06);
    expect(parseKalshiNumber(undefined)).toBeUndefined();
    expect(parseKalshiNumber(null)).toBeUndefined();
    expect(parseKalshiNumber('not-a-number')).toBeUndefined();
  });

  it('backs off and retries on 429', async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse({}, 429))
      .mockResolvedValueOnce(makeResponse({ series: [] }));

    const out = await client.listSeries();
    expect(out).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('signRequest throws in Phase 1 (read-only guard)', () => {
    expect(() => client.signRequest('GET', '/portfolio', Date.now())).toThrow(
      /Phase 1/,
    );
  });
});
