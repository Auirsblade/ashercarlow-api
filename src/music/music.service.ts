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
    if (this.isSpotifyUrl(url)) {
      return this.handleSpotifyUrl(url);
    }

    if (this.isAppleMusicUrl(url)) {
      return this.handleAppleMusicUrl(url);
    }

    throw new BadRequestException('URL must be a Spotify or Apple Music link');
  }

  private async handleSpotifyUrl(url: string): Promise<MusicMetadataResponse> {
    this.logger.log(`Handling Spotify URL: ${url}`);
    const { title, artist } = await this.scrapeSpotifyMetadata(url);
    this.logger.log(
      `Spotify oEmbed scraped — title: "${title}", artist: "${artist}"`,
    );

    const resource = await this.searchAppleMusic(title, artist);

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

    const spotifyUrl = await this.searchSpotifyUrl(
      attrs.name,
      attrs.artistName,
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
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(oembedUrl);

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch Spotify metadata: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      title?: string;
      description?: string;
    };
    const title = data.title ?? '';

    // description is formatted as "Title · Artist · Album · Year"
    const description = data.description ?? '';
    const parts = description.split(' · ');
    const artist = parts.length >= 2 ? parts[1] : '';

    if (!title) {
      this.logger.warn(`Spotify oEmbed returned empty title for ${url}`);
    }
    if (!artist) {
      this.logger.warn(
        `Spotify oEmbed could not extract artist from description: "${description}"`,
      );
    }

    return { title, artist };
  }

  private async searchAppleMusic(
    title: string,
    artist: string,
  ): Promise<AppleMusicResource | null> {
    const term = encodeURIComponent(`${title} ${artist}`);
    const apiUrl = `https://api.music.apple.com/v1/catalog/us/search?term=${term}&types=songs`;

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
      results?: { songs?: { data?: AppleMusicResource[] } };
    };
    const firstResult = data?.results?.songs?.data?.[0];

    if (!firstResult) {
      this.logger.warn(
        `Apple Music search returned empty results for term: "${title} ${artist}"`,
      );
    }

    return firstResult ?? null;
  }

  private async searchSpotifyUrl(
    title: string,
    artist: string,
  ): Promise<string | null> {
    try {
      const query = encodeURIComponent(`"${title}" "${artist}" spotify track`);
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

      this.logger.warn(
        `No Spotify URL found via Google for "${title}" by "${artist}"`,
      );
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
