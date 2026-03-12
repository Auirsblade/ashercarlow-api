import { Injectable, BadRequestException } from '@nestjs/common';
import { MusicMetadataResponse, PlatformLink } from './dto/get-metadata.dto';

interface OdesliResponse {
  entityUniqueId: string;
  userCountry: string;
  pageUrl: string;
  linksByPlatform: Record<
    string,
    {
      url: string;
      entityUniqueId: string;
    }
  >;
  entitiesByUniqueId: Record<
    string,
    {
      id: string;
      type: string;
      title: string;
      artistName: string;
      thumbnailUrl: string;
      thumbnailWidth: number;
      thumbnailHeight: number;
      apiProvider: string;
      platforms: string[];
    }
  >;
}

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
    // Step 1: Call Odesli API to get platform links
    const odesliResponse = await this.fetchOdesliLinks(url);

    // Step 2: Extract platform links
    const platformLinks = this.extractPlatformLinks(odesliResponse);

    // Step 3: Get Apple Music URL from Odesli
    const appleMusicLink = odesliResponse.linksByPlatform?.appleMusic;
    const appleMusicUrl = appleMusicLink?.url;

    // Step 4: Get metadata from Apple Music API or fallback to Odesli
    let title: string;
    let artist: string;
    let album: string;
    let releaseDate: string | null = null;
    let genres: string[] | null = null;
    let image: string;

    if (appleMusicUrl) {
      try {
        const resource = await this.fetchAppleMusicMetadata(appleMusicUrl);
        const attrs = resource.attributes;

        if (resource.type === 'albums') {
          title = attrs.name;
          artist = attrs.artistName;
          album = attrs.name;
          releaseDate = attrs.releaseDate ?? null;
          genres = this.filterGenres(attrs.genreNames);
          image = this.artworkUrl(attrs.artwork) ?? '';
        } else {
          // songs
          title = attrs.name;
          artist = attrs.artistName;
          album = attrs.albumName ?? '';
          releaseDate = attrs.releaseDate ?? null;
          genres = this.filterGenres(attrs.genreNames);
          image = this.artworkUrl(attrs.artwork) ?? '';
        }
      } catch {
        // Fallback to Odesli data if Apple Music API fails
        const entity = this.getPrimaryEntity(odesliResponse);
        title = entity.title;
        artist = entity.artistName;
        album = '';
        image = entity.thumbnailUrl;
      }
    } else {
      // Use Odesli data if no Apple Music link available
      const entity = this.getPrimaryEntity(odesliResponse);
      title = entity.title;
      artist = entity.artistName;
      album = '';
      image = entity.thumbnailUrl;
    }

    releaseDate = new Date(releaseDate ?? '')?.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" })

    return {
      title,
      artist,
      album,
      releaseDate,
      genres,
      image,
      platformLinks,
      universalLink: odesliResponse.pageUrl,
    };
  }

  private async fetchOdesliLinks(url: string): Promise<OdesliResponse> {
    const encodedUrl = encodeURIComponent(url);
    const apiUrl = `https://api.song.link/v1-alpha.1/links?url=${encodedUrl}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch links from Odesli: ${response.statusText}`,
      );
    }

    return response.json() as Promise<OdesliResponse>;
  }

  /**
   * Parse an Apple Music URL and fetch metadata from the catalog API.
   * Handles URLs like:
   *   https://music.apple.com/us/album/album-name/12345
   *   https://music.apple.com/us/album/album-name/12345?i=67890  (track within album)
   *   https://music.apple.com/us/song/song-name/12345
   */
  private async fetchAppleMusicMetadata(
    appleMusicUrl: string,
  ): Promise<AppleMusicResource> {
    const parsed = new URL(appleMusicUrl);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    // pathParts: ["us", "album"|"song", "name-slug", "id"]
    const storefront = pathParts[0] ?? 'us';
    const kind = pathParts[1]; // "album" or "song"
    const catalogId = pathParts[3];

    // Check for ?i= param which indicates a specific track within an album
    const trackId = parsed.searchParams.get('i');

    if (trackId) {
      // Fetch the specific song
      return this.fetchFromCatalog(storefront, 'songs', trackId);
    }

    if (kind === 'song') {
      return this.fetchFromCatalog(storefront, 'songs', catalogId);
    }

    // Default: album
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

    const data = await response.json();
    const resource = data?.data?.[0];

    if (!resource) {
      throw new BadRequestException(
        'No data returned from Apple Music API',
      );
    }

    return resource as AppleMusicResource;
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

  /**
   * Filter out the generic "Music" genre that Apple Music includes on everything.
   */
  private filterGenres(genreNames?: string[]): string[] | null {
    if (!genreNames?.length) return null;
    const filtered = genreNames.filter((g) => g !== 'Music');
    return filtered.length > 0 ? filtered : null;
  }

  private extractPlatformLinks(
    odesliResponse: OdesliResponse,
  ): PlatformLink[] {
    const links: PlatformLink[] = [];

    for (const [platform, data] of Object.entries(
      odesliResponse.linksByPlatform || {},
    )) {
      links.push({
        platform,
        url: data.url,
      });
    }

    return links;
  }

  private getPrimaryEntity(odesliResponse: OdesliResponse) {
    const entityId = odesliResponse.entityUniqueId;
    const entity = odesliResponse.entitiesByUniqueId?.[entityId];

    if (!entity) {
      throw new BadRequestException(
        'Could not find entity data in Odesli response',
      );
    }

    return entity;
  }
}
