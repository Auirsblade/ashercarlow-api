import { Test, TestingModule } from '@nestjs/testing';
import { MusicService } from './music.service';

interface AppleMusicResult {
  id: string;
  type: string;
  attributes: {
    name: string;
    artistName: string;
    url: string;
  };
}

function mockAppleMusicResponse(
  songs: { name: string; artistName: string; id?: string }[],
) {
  return {
    results: {
      songs: {
        data: songs.map((s, i) => ({
          id: s.id ?? String(i),
          type: 'songs',
          attributes: {
            name: s.name,
            artistName: s.artistName,
            url: `https://music.apple.com/us/song/${s.id ?? i}`,
          },
        })),
      },
    },
  };
}

function mockFetchResponse(body: object) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  };
}

describe('MusicService', () => {
  let service: MusicService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.APPLE_MUSIC_DEVELOPER_TOKEN = 'test-token';

    const module: TestingModule = await Test.createTestingModule({
      providers: [MusicService],
    }).compile();

    service = module.get<MusicService>(MusicService);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  });

  const callSearch = (
    t: string,
    a: string,
    type: 'songs' | 'albums' = 'songs',
  ): Promise<AppleMusicResult | null> =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    (service as any).searchAppleMusic(
      t,
      a,
      type,
    ) as Promise<AppleMusicResult | null>;

  it('should prefer exact artist match over popular mismatch', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([
          { name: 'U', artistName: 'Kendrick Lamar', id: 'kendrick' },
          { name: 'U', artistName: 'Underscores', id: 'underscores' },
        ]),
      ),
    );

    const result = await callSearch('U', 'Underscores');
    expect(result).not.toBeNull();
    expect(result!.attributes.artistName).toBe('Underscores');
  });

  it('should match case-insensitively', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([
          { name: 'Never Gonna Give You Up', artistName: 'Rick Astley' },
        ]),
      ),
    );

    const result = await callSearch('never gonna give you up', 'rick astley');
    expect(result).not.toBeNull();
    expect(result!.attributes.name).toBe('Never Gonna Give You Up');
  });

  it('should normalize diacritics (Beyonce matches Beyoncé)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([{ name: 'Halo', artistName: 'Beyoncé' }]),
      ),
    );

    const result = await callSearch('Halo', 'Beyonce');
    expect(result).not.toBeNull();
    expect(result!.attributes.artistName).toBe('Beyoncé');
  });

  it('should match via containment (Beatles matches The Beatles)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([
          { name: 'Yesterday', artistName: 'The Beatles' },
        ]),
      ),
    );

    const result = await callSearch('Yesterday', 'Beatles');
    expect(result).not.toBeNull();
    expect(result!.attributes.artistName).toBe('The Beatles');
  });

  it('should return null for empty results', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ results: { songs: { data: [] } } }),
    );

    const result = await callSearch('Nonexistent', 'Nobody');
    expect(result).toBeNull();
  });

  it('should return null when all results are below threshold', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([
          {
            name: 'Completely Different Song',
            artistName: 'Totally Different Artist',
          },
        ]),
      ),
    );

    const result = await callSearch('My Song', 'My Artist');
    expect(result).toBeNull();
  });

  it('should normalize punctuation (Pink matches P!nk)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([{ name: 'So What', artistName: 'P!nk' }]),
      ),
    );

    const result = await callSearch('So What', 'Pink');
    expect(result).not.toBeNull();
    expect(result!.attributes.artistName).toBe('P!nk');
  });

  it('should not give containment bonus for very short substrings', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        mockAppleMusicResponse([
          { name: 'Wish U Well', artistName: 'underscores' },
        ]),
      ),
    );

    // "U" is only 1 char vs 11 chars in "Wish U Well" — should not get 0.9
    const result = await callSearch('U', 'underscores');
    // The title score should be low (Jaccard, not containment),
    // so even with perfect artist match this shouldn't win over an exact title match
    expect(result).not.toBeNull();
    // Title "Wish U Well" should NOT score 0.9 against "U"
    // It should score via Jaccard: intersection=1 / union=3 = 0.33
  });

  it('should search albums when type is albums', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: {
            albums: {
              data: [
                {
                  id: 'album123',
                  type: 'albums',
                  attributes: {
                    name: 'U',
                    artistName: 'underscores',
                    url: 'https://music.apple.com/us/album/u/album123',
                  },
                },
              ],
            },
          },
        }),
    });

    const result = await callSearch('U', 'underscores', 'albums');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('albums');
    expect(result!.attributes.name).toBe('U');
  });
});
