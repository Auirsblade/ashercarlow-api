import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { MusicMetadataResponse } from './dto/get-metadata.dto';

interface AppleMusicAttributes {
  name: string;
  artistName: string;
  albumName?: string;
  releaseDate?: string;
  genreNames?: string[];
  artwork?: {
    url: string;
    width: number;
    height: number;
  };
  url: string;
  trackCount?: number;
  isSingle?: boolean;
}

interface AppleMusicResource {
  id: string;
  type: string;
  attributes: AppleMusicAttributes;
}

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  private get appleMusicToken(): string {
    const token = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
    if (!token) {
      throw new BadRequestException(
        'APPLE_MUSIC_DEVELOPER_TOKEN environment variable is not set',
      );
    }
    return token;
  }

  async getMetadata(url: string): Promise<MusicMetadataResponse> {
    // Strip any text before the URL (e.g. Spotify share messages)
    const urlMatch = url.match(/(https?:\/\/\S+)/);
    const cleanUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : url;

    if (this.isSpotifyUrl(cleanUrl)) {
      return this.handleSpotifyUrl(cleanUrl);
    }

    if (this.isAppleMusicUrl(cleanUrl)) {
      return this.handleAppleMusicUrl(cleanUrl);
    }

    throw new BadRequestException('URL must be a Spotify or Apple Music link');
  }

  private spotifyContentType(url: string): 'songs' | 'albums' {
    const path = new URL(url).pathname;
    if (path.includes('/album') || path.includes('/prerelease'))
      return 'albums';
    return 'songs';
  }

  private async handleSpotifyUrl(url: string): Promise<MusicMetadataResponse> {
    this.logger.log(`Handling Spotify URL: ${url}`);
    const { title, artist } = await this.scrapeSpotifyMetadata(url);
    const type = this.spotifyContentType(url);
    this.logger.log(
      `Spotify embed scraped — title: "${title}", artist: "${artist}", type: ${type}`,
    );

    const resource = await this.searchAppleMusic(title, artist, type);

    if (!resource) {
      this.logger.warn(
        `Apple Music search returned no results for "${title}" by "${artist}"`,
      );
      throw new BadRequestException(
        'Could not find matching track on Apple Music',
      );
    }

    this.logger.log(
      `Apple Music match found: "${resource.attributes.name}" (${resource.id})`,
    );

    const attrs = resource.attributes;

    return {
      title: attrs.name,
      artist: attrs.artistName,
      album: resource.type === 'albums' ? attrs.name : (attrs.albumName ?? ''),
      releaseDate: this.formatDate(attrs.releaseDate),
      genres: this.filterGenres(attrs.genreNames),
      image: this.artworkUrl(attrs.artwork) ?? '',
      spotifyUrl: url,
      appleMusicUrl: attrs.url,
    };
  }

  private async handleAppleMusicUrl(
    url: string,
  ): Promise<MusicMetadataResponse> {
    this.logger.log(`Handling Apple Music URL: ${url}`);
    const resource = await this.fetchAppleMusicMetadata(url);
    const attrs = resource.attributes;
    this.logger.log(
      `Apple Music metadata fetched — "${attrs.name}" by "${attrs.artistName}"`,
    );

    const type = resource.type === 'albums' ? 'albums' : 'songs';
    const spotifyUrl = await this.searchSpotifyUrl(
      attrs.name,
      attrs.artistName,
      type,
    );

    if (spotifyUrl) {
      this.logger.log(`Spotify URL found: ${spotifyUrl}`);
    } else {
      this.logger.warn(
        `Spotify search returned null for "${attrs.name}" by "${attrs.artistName}"`,
      );
    }

    return {
      title: attrs.name,
      artist: attrs.artistName,
      album: resource.type === 'albums' ? attrs.name : (attrs.albumName ?? ''),
      releaseDate: this.formatDate(attrs.releaseDate),
      genres: this.filterGenres(attrs.genreNames),
      image: this.artworkUrl(attrs.artwork) ?? '',
      spotifyUrl,
      appleMusicUrl: url,
    };
  }

  private isSpotifyUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'open.spotify.com' || hostname === 'spotify.com';
    } catch {
      return false;
    }
  }

  private isAppleMusicUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'music.apple.com';
    } catch {
      return false;
    }
  }

  private async scrapeSpotifyMetadata(
    url: string,
  ): Promise<{ title: string; artist: string }> {
    // Extract path from the Spotify URL to build the embed URL
    const parsed = new URL(url);
    const embedUrl = `https://open.spotify.com/embed${parsed.pathname}`;

    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch Spotify embed page: ${response.statusText}`,
      );
    }

    const html = await response.text();

    // Parse __NEXT_DATA__ JSON from the embed page
    const nextDataMatch = html.match(
      /__NEXT_DATA__[^>]*>(\{.*?\})\s*<\/script/s,
    );
    if (!nextDataMatch) {
      throw new BadRequestException(
        'Could not parse Spotify embed page metadata',
      );
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
    // Tracks use artists array, albums use subtitle
    const artist = entity?.artists?.[0]?.name ?? entity?.subtitle ?? '';

    if (!title) {
      this.logger.warn(`Spotify embed returned empty title for ${url}`);
    }
    if (!artist) {
      this.logger.warn(`Spotify embed could not extract artist for ${url}`);
    }

    return { title, artist };
  }

  private normalize(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private similarityScore(a: string, b: string): number {
    const na = this.normalize(a);
    const nb = this.normalize(b);

    if (na === nb) return 1.0;

    // Containment check — only if the shorter string is a meaningful
    // portion of the longer one (at least 40%), so single-letter titles
    // like "U" don't match "Wish U Well"
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length <= nb.length ? nb : na;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.4) {
      return 0.9;
    }

    // Word-level Jaccard similarity
    const wordsA = new Set(na.split(' '));
    const wordsB = new Set(nb.split(' '));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const jaccard = union === 0 ? 0 : intersection / union;

    // Character-level edit distance ratio for stylized names
    // (e.g. "Pink" vs "P!nk" → "pink" vs "pnk")
    // Only use when strings are similar in length to avoid false positives
    const minLen = Math.min(na.length, nb.length);
    const maxLen = Math.max(na.length, nb.length);
    const lengthRatio = maxLen === 0 ? 1 : minLen / maxLen;
    let charSimilarity = 0;
    if (lengthRatio >= 0.6) {
      const editDist = this.levenshtein(na, nb);
      charSimilarity = 1 - editDist / maxLen;
    }

    return Math.max(jaccard, charSimilarity);
  }

  private levenshtein(a: string, b: string): number {
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

  private meetsMatchThreshold(
    searchTitle: string,
    searchArtist: string,
    resultTitle: string,
    resultArtist: string,
  ): { pass: boolean; score: number; titleScore: number; artistScore: number } {
    const titleScore = this.similarityScore(searchTitle, resultTitle);
    const artistScore = this.similarityScore(searchArtist, resultArtist);
    const score = artistScore * 0.6 + titleScore * 0.4;

    const pass = titleScore >= 0.15 && artistScore >= 0.15 && score >= 0.3;
    return { pass, score, titleScore, artistScore };
  }

  private async searchAppleMusic(
    title: string,
    artist: string,
    type: 'songs' | 'albums' = 'songs',
  ): Promise<AppleMusicResource | null> {
    const term = encodeURIComponent(`${title} ${artist}`);
    const apiUrl = `https://api.music.apple.com/v1/catalog/us/search?term=${term}&types=${type}&limit=25`;

    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${this.appleMusicToken}` },
    });

    if (!response.ok) {
      this.logger.warn(
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
      this.logger.warn(
        `Apple Music search returned empty results for term: "${title} ${artist}"`,
      );
      return null;
    }

    let bestResult: AppleMusicResource = results[0];
    let bestMatch = { pass: false, score: -1, titleScore: 0, artistScore: 0 };

    for (const result of results) {
      const match = this.meetsMatchThreshold(
        title,
        artist,
        result.attributes.name,
        result.attributes.artistName,
      );

      this.logger.debug(
        `Apple Music candidate: "${result.attributes.name}" by "${result.attributes.artistName}" — title=${match.titleScore.toFixed(2)} artist=${match.artistScore.toFixed(2)} total=${match.score.toFixed(2)}`,
      );

      if (match.score > bestMatch.score) {
        bestMatch = match;
        bestResult = result;
      }
    }

    if (!bestMatch.pass) {
      this.logger.warn(
        `Best Apple Music match scored ${bestMatch.score.toFixed(2)} (title=${bestMatch.titleScore.toFixed(2)}, artist=${bestMatch.artistScore.toFixed(2)}), below threshold`,
      );
      return null;
    }

    this.logger.log(
      `Best Apple Music match: "${bestResult.attributes.name}" by "${bestResult.attributes.artistName}" (score=${bestMatch.score.toFixed(2)})`,
    );

    return bestResult;
  }

  private async searchSpotifyUrl(
    title: string,
    artist: string,
    type: 'songs' | 'albums' = 'songs',
  ): Promise<string | null> {
    const spotifyType = type === 'albums' ? 'album' : 'track';

    // Try type-constrained search first, then fall back to unconstrained
    const queries = [
      `site:open.spotify.com/${spotifyType} "${title}" "${artist}"`,
      `site:open.spotify.com "${title}" "${artist}"`,
    ];

    for (const rawQuery of queries) {
      const url = await this.googleFeelingLucky(rawQuery);
      if (!url) continue;

      // Verify the result by scraping and scoring
      try {
        const scraped = await this.scrapeSpotifyMetadata(url);
        const match = this.meetsMatchThreshold(
          title,
          artist,
          scraped.title,
          scraped.artist,
        );

        this.logger.debug(
          `Spotify verification: "${scraped.title}" by "${scraped.artist}" — title=${match.titleScore.toFixed(2)} artist=${match.artistScore.toFixed(2)} total=${match.score.toFixed(2)}`,
        );

        if (match.pass) {
          this.logger.log(
            `Spotify match verified: "${scraped.title}" by "${scraped.artist}" (score=${match.score.toFixed(2)})`,
          );
          return url;
        }

        this.logger.warn(
          `Spotify result rejected: "${scraped.title}" by "${scraped.artist}" (score=${match.score.toFixed(2)}, title=${match.titleScore.toFixed(2)}, artist=${match.artistScore.toFixed(2)})`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to verify Spotify result ${url}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.warn(
      `No verified Spotify URL found for "${title}" by "${artist}"`,
    );
    return null;
  }

  private async googleFeelingLucky(rawQuery: string): Promise<string | null> {
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
      this.logger.debug(`Google redirect resolved to: ${finalUrl}`);

      const spotifyPattern =
        /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:track|album|prerelease)\/[a-zA-Z0-9]+/;

      // Google wraps the redirect in a /url?q= param
      const googleRedirect = finalUrl.match(/[?&]q=(https?[^&]+)/);
      if (googleRedirect) {
        const decoded = decodeURIComponent(googleRedirect[1]);
        const match = decoded.match(spotifyPattern);
        if (match) {
          this.logger.log(
            `Spotify URL extracted from Google redirect: ${match[0]}`,
          );
          return match[0];
        }
        this.logger.debug(`Google redirected to non-Spotify URL: ${decoded}`);
      }

      // Direct match if Google redirected straight to Spotify
      const directMatch = finalUrl.match(spotifyPattern);
      if (directMatch) {
        this.logger.log(`Spotify URL from direct redirect: ${directMatch[0]}`);
        return directMatch[0];
      }

      return null;
    } catch (error) {
      this.logger.error('Google search threw an error', (error as Error).stack);
      return null;
    }
  }

  private async fetchAppleMusicMetadata(
    appleMusicUrl: string,
  ): Promise<AppleMusicResource> {
    const parsed = new URL(appleMusicUrl);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const storefront = pathParts[0] ?? 'us';
    const kind = pathParts[1];
    const catalogId = pathParts[3];
    const trackId = parsed.searchParams.get('i');

    if (trackId) {
      return this.fetchFromCatalog(storefront, 'songs', trackId);
    }

    if (kind === 'song') {
      return this.fetchFromCatalog(storefront, 'songs', catalogId);
    }

    return this.fetchFromCatalog(storefront, 'albums', catalogId);
  }

  private async fetchFromCatalog(
    storefront: string,
    type: 'songs' | 'albums',
    id: string,
  ): Promise<AppleMusicResource> {
    const apiUrl = `https://api.music.apple.com/v1/catalog/${storefront}/${type}/${id}`;

    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${this.appleMusicToken}` },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Apple Music API request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      data?: AppleMusicResource[];
    };
    const resource = data?.data?.[0];

    if (!resource) {
      throw new BadRequestException('No data returned from Apple Music API');
    }

    return resource;
  }

  private artworkUrl(
    artwork: AppleMusicAttributes['artwork'],
    size = 600,
  ): string | null {
    if (!artwork?.url) return null;
    return artwork.url
      .replace('{w}', String(size))
      .replace('{h}', String(size));
  }

  private filterGenres(genreNames?: string[]): string[] | null {
    if (!genreNames?.length) return null;
    const filtered = genreNames.filter((g) => g !== 'Music');
    return filtered.length > 0 ? filtered : null;
  }

  private formatDate(releaseDate?: string): string | null {
    if (!releaseDate) return null;
    return new Date(releaseDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}
