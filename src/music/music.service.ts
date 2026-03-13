import { Injectable, BadRequestException } from '@nestjs/common';
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
    const { title, artist } = await this.scrapeSpotifyMetadata(url);
    const resource = await this.searchAppleMusic(title, artist);

    if (!resource) {
      throw new BadRequestException(
        'Could not find matching track on Apple Music',
      );
    }

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
    const resource = await this.fetchAppleMusicMetadata(url);
    const attrs = resource.attributes;

    const spotifyUrl = await this.searchSpotifyUrl(
      attrs.name,
      attrs.artistName,
    );

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
      return null;
    }

    const data = (await response.json()) as {
      results?: { songs?: { data?: AppleMusicResource[] } };
    };
    const firstResult = data?.results?.songs?.data?.[0];
    return firstResult ?? null;
  }

  private async searchSpotifyUrl(
    title: string,
    artist: string,
  ): Promise<string | null> {
    try {
      const query = encodeURIComponent(
        `site:open.spotify.com ${title} ${artist}`,
      );
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${query}`;

      const response = await fetch(ddgUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) return null;

      const html = await response.text();
      const match = html.match(
        /https?:\/\/open\.spotify\.com\/(?:track|album)\/[a-zA-Z0-9]+/,
      );
      return match ? match[0] : null;
    } catch {
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
