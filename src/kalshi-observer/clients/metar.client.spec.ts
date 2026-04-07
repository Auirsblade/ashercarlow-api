import { MetarClient } from './metar.client';

describe('MetarClient', () => {
  let client: MetarClient;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    client = new MetarClient();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const makeResponse = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }) as Response;

  it('fetches METAR for a list of ICAOs', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse([{ icaoId: 'KNYC', temp: 12.3, obsTime: 1000 }]),
    );

    const out = await client.getMetar(['KNYC', 'KLAX']);
    expect(out[0].icaoId).toBe('KNYC');
    const firstCall = fetchMock.mock.calls[0] as unknown as [string];
    const calledUrl = firstCall[0];
    expect(calledUrl).toContain('ids=KNYC%2CKLAX');
    expect(calledUrl).toContain('format=json');
  });

  it('keeps only the newest observation per station', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse([
        { icaoId: 'KNYC', temp: 10, obsTime: 1000 },
        { icaoId: 'KNYC', temp: 12, obsTime: 2000 },
        { icaoId: 'KLAX', temp: 20, obsTime: 1500 },
      ]),
    );

    const out = await client.getLatestByStation(['KNYC', 'KLAX', 'KMIA']);
    expect(out.get('KNYC')?.temp).toBe(12);
    expect(out.get('KLAX')?.temp).toBe(20);
    expect(out.get('KMIA')).toBeUndefined();
  });

  it('converts celsius to fahrenheit', () => {
    expect(MetarClient.celsiusToFahrenheit(0)).toBe(32);
    expect(MetarClient.celsiusToFahrenheit(100)).toBe(212);
    expect(MetarClient.celsiusToFahrenheit(37)).toBeCloseTo(98.6);
  });

  it('returns empty array for empty input (no fetch)', async () => {
    const out = await client.getMetar([]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
