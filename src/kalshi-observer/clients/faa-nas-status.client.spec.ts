import { FaaNasStatusClient } from './faa-nas-status.client';

describe('FaaNasStatusClient', () => {
  let client: FaaNasStatusClient;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    client = new FaaNasStatusClient();
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

  it('filters events to only the requested airports', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse([
        {
          airportId: 'SFO',
          groundDelay: { airportId: 'SFO', avgDelay: 32, maxDelay: 99 },
        },
        { airportId: 'MIA', departureDelay: { reason: 'TM:WX' } },
        { airportId: 'LAX', airportClosure: null },
      ]),
    );

    const out = await client.getEventsForAirports(['MIA', 'LAX']);
    expect(out.size).toBe(2);
    expect(out.get('MIA')).toBeDefined();
    expect(out.get('LAX')).toBeDefined();
    expect(out.get('SFO')).toBeUndefined();
  });

  it('normalizes airport codes to uppercase', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse([{ airportId: 'MDW', groundDelay: null }]),
    );

    const out = await client.getEventsForAirports(['mdw']);
    expect(out.get('MDW')).toBeDefined();
  });
});
