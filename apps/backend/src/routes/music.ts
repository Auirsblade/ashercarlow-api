import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';

// ---------------------------------------------------------------------------
// Schemas (OpenAPI / Zod)
// ---------------------------------------------------------------------------

const MusicMetadataResponse = z
  .object({
    title: z.string().openapi({ example: 'Never Gonna Give You Up' }),
    artist: z.string().openapi({ example: 'Rick Astley' }),
    album: z.string().openapi({ example: 'Whenever You Need Somebody' }),
    releaseDate: z.string().nullable().openapi({ example: '11/12/1987' }),
    genres: z
      .array(z.string())
      .nullable()
      .openapi({ example: ['Pop', 'Rock'] }),
    image: z.string().openapi({ example: 'https://i.scdn.co/image/...' }),
    spotifyUrl: z.string().nullable().openapi({
      example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    }),
    appleMusicUrl: z.string().nullable().openapi({
      example: 'https://music.apple.com/us/song/never-gonna-give-you-up/1558533900',
    }),
  })
  .openapi('MusicMetadata');

type MusicMetadata = z.infer<typeof MusicMetadataResponse>;

const ErrorResponse = z.object({ message: z.string() });

// ---------------------------------------------------------------------------
// Apple Music types
// ---------------------------------------------------------------------------

interface AppleMusicAttributes {
  name: string;
  artistName: string;
  albumName?: string;
  releaseDate?: string;
  genreNames?: string[];
  artwork?: { url: string; width: number; height: number };
  url: string;
  trackCount?: number;
  isSingle?: boolean;
}

interface AppleMusicResource {
  id: string;
  type: string;
  attributes: AppleMusicAttributes;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const log = {
  log: (msg: string) => console.log(`[music] ${msg}`),
  warn: (msg: string) => console.warn(`[music] ${msg}`),
  error: (msg: string, stack?: string) =>
    console.error(`[music] ${msg}${stack ? `\n${stack}` : ''}`),
  debug: (msg: string) => console.debug(`[music] ${msg}`),
};

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

function appleMusicToken(): string {
  const token = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  if (!token) {
    throw new HTTPException(400, {
      message: 'APPLE_MUSIC_DEVELOPER_TOKEN environment variable is not set',
    });
  }
  return token;
}

// ---------------------------------------------------------------------------
// Public: getMetadata
// ---------------------------------------------------------------------------

export async function getMusicMetadata(url: string): Promise<MusicMetadata> {
  const urlMatch = url.match(/(https?:\/\/\S+)/);
  const cleanUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : url;

  if (isSpotifyUrl(cleanUrl)) {
    return handleSpotifyUrl(cleanUrl);
  }

  if (isAppleMusicUrl(cleanUrl)) {
    return handleAppleMusicUrl(cleanUrl);
  }

  throw new HTTPException(400, {
    message: 'URL must be a Spotify or Apple Music link',
  });
}

// ---------------------------------------------------------------------------
// URL detection + content type
// ---------------------------------------------------------------------------

function isSpotifyUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'open.spotify.com' || hostname === 'spotify.com';
  } catch {
    return false;
  }
}

function isAppleMusicUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'music.apple.com';
  } catch {
    return false;
  }
}

function spotifyContentType(url: string): 'songs' | 'albums' {
  const path = new URL(url).pathname;
  if (path.includes('/album') || path.includes('/prerelease')) return 'albums';
  return 'songs';
}

// ---------------------------------------------------------------------------
// Per-platform handlers
// ---------------------------------------------------------------------------

async function handleSpotifyUrl(url: string): Promise<MusicMetadata> {
  log.log(`Handling Spotify URL: ${url}`);
  const { title, artist } = await scrapeSpotifyMetadata(url);
  const type = spotifyContentType(url);
  log.log(
    `Spotify embed scraped — title: "${title}", artist: "${artist}", type: ${type}`,
  );

  const resource = await searchAppleMusic(title, artist, type);

  if (!resource) {
    log.warn(
      `Apple Music search returned no results for "${title}" by "${artist}"`,
    );
    throw new HTTPException(400, {
      message: 'Could not find matching track on Apple Music',
    });
  }

  log.log(`Apple Music match found: "${resource.attributes.name}" (${resource.id})`);

  const attrs = resource.attributes;

  return {
    title: attrs.name,
    artist: attrs.artistName,
    album: resource.type === 'albums' ? attrs.name : (attrs.albumName ?? ''),
    releaseDate: formatDate(attrs.releaseDate),
    genres: filterGenres(attrs.genreNames),
    image: artworkUrl(attrs.artwork) ?? '',
    spotifyUrl: url,
    appleMusicUrl: attrs.url,
  };
}

async function handleAppleMusicUrl(url: string): Promise<MusicMetadata> {
  log.log(`Handling Apple Music URL: ${url}`);
  const resource = await fetchAppleMusicMetadata(url);
  const attrs = resource.attributes;
  log.log(
    `Apple Music metadata fetched — "${attrs.name}" by "${attrs.artistName}"`,
  );

  const type = resource.type === 'albums' ? 'albums' : 'songs';
  const spotifyUrl = await searchSpotifyUrl(attrs.name, attrs.artistName, type);

  if (spotifyUrl) {
    log.log(`Spotify URL found: ${spotifyUrl}`);
  } else {
    log.warn(
      `Spotify search returned null for "${attrs.name}" by "${attrs.artistName}"`,
    );
  }

  return {
    title: attrs.name,
    artist: attrs.artistName,
    album: resource.type === 'albums' ? attrs.name : (attrs.albumName ?? ''),
    releaseDate: formatDate(attrs.releaseDate),
    genres: filterGenres(attrs.genreNames),
    image: artworkUrl(attrs.artwork) ?? '',
    spotifyUrl,
    appleMusicUrl: url,
  };
}

// ---------------------------------------------------------------------------
// Spotify scrape
// ---------------------------------------------------------------------------

async function scrapeSpotifyMetadata(
  url: string,
): Promise<{ title: string; artist: string }> {
  const parsed = new URL(url);
  const embedUrl = `https://open.spotify.com/embed${parsed.pathname}`;

  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new HTTPException(400, {
      message: `Failed to fetch Spotify embed page: ${response.statusText}`,
    });
  }

  const html = await response.text();

  const nextDataMatch = html.match(/__NEXT_DATA__[^>]*>(\{.*?\})\s*<\/script/s);
  if (!nextDataMatch) {
    throw new HTTPException(400, {
      message: 'Could not parse Spotify embed page metadata',
    });
  }

  const nextData = JSON.parse(nextDataMatch[1]) as {
    props?: {
      pageProps?: {
        state?: {
          data?: {
            entity?: {
              title?: string;
              name?: string;
              subtitle?: string;
              artists?: { name: string }[];
            };
          };
        };
      };
    };
  };

  const entity = nextData?.props?.pageProps?.state?.data?.entity;
  const title = entity?.title ?? entity?.name ?? '';
  const artist = entity?.artists?.[0]?.name ?? entity?.subtitle ?? '';

  if (!title) log.warn(`Spotify embed returned empty title for ${url}`);
  if (!artist) log.warn(`Spotify embed could not extract artist for ${url}`);

  return { title, artist };
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) return 1.0;

  // Containment check — only if the shorter string is a meaningful portion of
  // the longer one (>= 40%), so single-letter titles like "U" don't match
  // "Wish U Well".
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.4) {
    return 0.9;
  }

  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Character-level edit-distance ratio for stylized names like "P!nk".
  const minLen = Math.min(na.length, nb.length);
  const maxLen = Math.max(na.length, nb.length);
  const lengthRatio = maxLen === 0 ? 1 : minLen / maxLen;
  let charSimilarity = 0;
  if (lengthRatio >= 0.6) {
    const editDist = levenshtein(na, nb);
    charSimilarity = 1 - editDist / maxLen;
  }

  return Math.max(jaccard, charSimilarity);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from(
    { length: m + 1 },
    () => Array(n + 1).fill(0) as number[],
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function meetsMatchThreshold(
  searchTitle: string,
  searchArtist: string,
  resultTitle: string,
  resultArtist: string,
): { pass: boolean; score: number; titleScore: number; artistScore: number } {
  const titleScore = similarityScore(searchTitle, resultTitle);
  const artistScore = similarityScore(searchArtist, resultArtist);
  const score = artistScore * 0.6 + titleScore * 0.4;
  const pass = titleScore >= 0.15 && artistScore >= 0.15 && score >= 0.3;
  return { pass, score, titleScore, artistScore };
}

// ---------------------------------------------------------------------------
// Apple Music search + fetch
// ---------------------------------------------------------------------------

async function searchAppleMusic(
  title: string,
  artist: string,
  type: 'songs' | 'albums' = 'songs',
): Promise<AppleMusicResource | null> {
  const term = encodeURIComponent(`${title} ${artist}`);
  const apiUrl = `https://api.music.apple.com/v1/catalog/us/search?term=${term}&types=${type}&limit=25`;

  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${appleMusicToken()}` },
  });

  if (!response.ok) {
    log.warn(
      `Apple Music search failed: ${response.status} ${response.statusText}`,
    );
    return null;
  }

  const data = (await response.json()) as {
    results?: {
      songs?: { data?: AppleMusicResource[] };
      albums?: { data?: AppleMusicResource[] };
    };
  };
  const results =
    type === 'albums'
      ? data?.results?.albums?.data
      : data?.results?.songs?.data;

  if (!results?.length) {
    log.warn(
      `Apple Music search returned empty results for term: "${title} ${artist}"`,
    );
    return null;
  }

  let bestResult: AppleMusicResource = results[0];
  let bestMatch = { pass: false, score: -1, titleScore: 0, artistScore: 0 };

  for (const result of results) {
    const match = meetsMatchThreshold(
      title,
      artist,
      result.attributes.name,
      result.attributes.artistName,
    );

    log.debug(
      `Apple Music candidate: "${result.attributes.name}" by "${result.attributes.artistName}" — title=${match.titleScore.toFixed(2)} artist=${match.artistScore.toFixed(2)} total=${match.score.toFixed(2)}`,
    );

    if (match.score > bestMatch.score) {
      bestMatch = match;
      bestResult = result;
    }
  }

  if (!bestMatch.pass) {
    log.warn(
      `Best Apple Music match scored ${bestMatch.score.toFixed(2)} (title=${bestMatch.titleScore.toFixed(2)}, artist=${bestMatch.artistScore.toFixed(2)}), below threshold`,
    );
    return null;
  }

  log.log(
    `Best Apple Music match: "${bestResult.attributes.name}" by "${bestResult.attributes.artistName}" (score=${bestMatch.score.toFixed(2)})`,
  );

  return bestResult;
}

async function fetchAppleMusicMetadata(
  appleMusicUrl: string,
): Promise<AppleMusicResource> {
  const parsed = new URL(appleMusicUrl);
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const storefront = pathParts[0] ?? 'us';
  const kind = pathParts[1];
  const catalogId = pathParts[3];
  const trackId = parsed.searchParams.get('i');

  if (trackId) {
    return fetchFromCatalog(storefront, 'songs', trackId);
  }

  if (kind === 'song') {
    return fetchFromCatalog(storefront, 'songs', catalogId);
  }

  return fetchFromCatalog(storefront, 'albums', catalogId);
}

async function fetchFromCatalog(
  storefront: string,
  type: 'songs' | 'albums',
  id: string,
): Promise<AppleMusicResource> {
  const apiUrl = `https://api.music.apple.com/v1/catalog/${storefront}/${type}/${id}`;

  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${appleMusicToken()}` },
  });

  if (!response.ok) {
    throw new HTTPException(400, {
      message: `Apple Music API request failed: ${response.status} ${response.statusText}`,
    });
  }

  const data = (await response.json()) as { data?: AppleMusicResource[] };
  const resource = data?.data?.[0];

  if (!resource) {
    throw new HTTPException(400, {
      message: 'No data returned from Apple Music API',
    });
  }

  return resource;
}

// ---------------------------------------------------------------------------
// Spotify URL search (Apple Music → Spotify direction)
// ---------------------------------------------------------------------------

async function searchSpotifyUrl(
  title: string,
  artist: string,
  type: 'songs' | 'albums' = 'songs',
): Promise<string | null> {
  const spotifyType = type === 'albums' ? 'album' : 'track';

  const queries = [
    `site:open.spotify.com/${spotifyType} "${title}" "${artist}"`,
    `site:open.spotify.com "${title}" "${artist}"`,
  ];

  for (const rawQuery of queries) {
    const url = await googleFeelingLucky(rawQuery);
    if (!url) continue;

    try {
      const scraped = await scrapeSpotifyMetadata(url);
      const match = meetsMatchThreshold(title, artist, scraped.title, scraped.artist);

      log.debug(
        `Spotify verification: "${scraped.title}" by "${scraped.artist}" — title=${match.titleScore.toFixed(2)} artist=${match.artistScore.toFixed(2)} total=${match.score.toFixed(2)}`,
      );

      if (match.pass) {
        log.log(
          `Spotify match verified: "${scraped.title}" by "${scraped.artist}" (score=${match.score.toFixed(2)})`,
        );
        return url;
      }

      log.warn(
        `Spotify result rejected: "${scraped.title}" by "${scraped.artist}" (score=${match.score.toFixed(2)}, title=${match.titleScore.toFixed(2)}, artist=${match.artistScore.toFixed(2)})`,
      );
    } catch (error) {
      log.warn(`Failed to verify Spotify result ${url}: ${(error as Error).message}`);
    }
  }

  log.warn(`No verified Spotify URL found for "${title}" by "${artist}"`);
  return null;
}

async function googleFeelingLucky(rawQuery: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(rawQuery);
    const googleUrl = `https://www.google.com/search?q=${query}&btnI=1`;

    const response = await fetch(googleUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });

    const finalUrl = response.url;
    log.debug(`Google redirect resolved to: ${finalUrl}`);

    const spotifyPattern =
      /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:track|album|prerelease)\/[a-zA-Z0-9]+/;

    const googleRedirect = finalUrl.match(/[?&]q=(https?[^&]+)/);
    if (googleRedirect) {
      const decoded = decodeURIComponent(googleRedirect[1]);
      const match = decoded.match(spotifyPattern);
      if (match) {
        log.log(`Spotify URL extracted from Google redirect: ${match[0]}`);
        return match[0];
      }
      log.debug(`Google redirected to non-Spotify URL: ${decoded}`);
    }

    const directMatch = finalUrl.match(spotifyPattern);
    if (directMatch) {
      log.log(`Spotify URL from direct redirect: ${directMatch[0]}`);
      return directMatch[0];
    }

    return null;
  } catch (error) {
    log.error('Google search threw an error', (error as Error).stack);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function artworkUrl(
  artwork: AppleMusicAttributes['artwork'],
  size = 600,
): string | null {
  if (!artwork?.url) return null;
  return artwork.url.replace('{w}', String(size)).replace('{h}', String(size));
}

function filterGenres(genreNames?: string[]): string[] | null {
  if (!genreNames?.length) return null;
  const filtered = genreNames.filter((g) => g !== 'Music');
  return filtered.length > 0 ? filtered : null;
}

function formatDate(releaseDate?: string): string | null {
  if (!releaseDate) return null;
  return new Date(releaseDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const getMetadataRoute = createRoute({
  method: 'get',
  path: '/music/getMetadata',
  tags: ['music'],
  summary: 'Get music metadata from a Spotify or Apple Music URL',
  description:
    'Scrapes Spotify metadata and uses Apple Music API to return cross-platform URLs and rich metadata.',
  request: {
    query: z.object({
      url: z.string().openapi({
        param: { name: 'url', in: 'query' },
        example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
        description: 'A Spotify or Apple Music URL',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Music metadata retrieved successfully',
      content: { 'application/json': { schema: MusicMetadataResponse } },
    },
    400: {
      description: 'Invalid URL or unable to fetch metadata',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

export function registerMusicRoutes(app: OpenAPIHono): void {
  app.openapi(getMetadataRoute, async (c) => {
    const { url } = c.req.valid('query');
    const result = await getMusicMetadata(url);
    return c.json(result, 200);
  });
}
