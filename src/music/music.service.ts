import { Injectable, BadRequestException } from '@nestjs/common';
import type SpotifyUrlInfo from 'spotify-url-info';
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

interface SpotifyPreview {
  title: string;
  type: string;
  track: string;
  artist: string;
  image: string;
  audio: string;
  link: string;
  embed: string;
  date: string;
  description: string;
}

@Injectable()
export class MusicService {
  private spotifyUrlInfo: ReturnType<typeof SpotifyUrlInfo> | null = null;

  private async getSpotifyUrlInfo(): Promise<
    ReturnType<typeof SpotifyUrlInfo>
  > {
    if (!this.spotifyUrlInfo) {
      const spotifyUrlInfoFactory = (await import('spotify-url-info')).default;
      this.spotifyUrlInfo = spotifyUrlInfoFactory(fetch);
    }
    return this.spotifyUrlInfo;
  }

  async getMetadata(url: string): Promise<MusicMetadataResponse> {
    // Step 1: Call Odesli API to get platform links
    const odesliResponse = await this.fetchOdesliLinks(url);

    // Step 2: Extract platform links
    const platformLinks = this.extractPlatformLinks(odesliResponse);

    // Step 3: Get Spotify URL if available
    const spotifyLink = odesliResponse.linksByPlatform?.spotify;
    const spotifyUrl = spotifyLink?.url;

    // Step 4: Get metadata from Spotify or fallback to Odesli data
    let title: string;
    let artist: string;
    let album: string;
    let releaseDate: string | null = null;
    let image: string;

    if (spotifyUrl) {
      try {
        const spotifyData = await this.fetchSpotifyMetadata(spotifyUrl);
        title = spotifyData.track || spotifyData.title;
        artist = spotifyData.artist;
        album =
          spotifyData.title !== spotifyData.track ? spotifyData.title : '';
        releaseDate = spotifyData.date || null;
        image = spotifyData.image;
      } catch {
        // Fallback to Odesli data if Spotify scraping fails
        const entity = this.getPrimaryEntity(odesliResponse);
        title = entity.title;
        artist = entity.artistName;
        album = '';
        image = entity.thumbnailUrl;
      }
    } else {
      // Use Odesli data if no Spotify link available
      const entity = this.getPrimaryEntity(odesliResponse);
      title = entity.title;
      artist = entity.artistName;
      album = '';
      image = entity.thumbnailUrl;
    }

    return {
      title,
      artist,
      album,
      releaseDate,
      genres: null, // Spotify doesn't provide genres for tracks, only artists
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

  private async fetchSpotifyMetadata(
    spotifyUrl: string,
  ): Promise<SpotifyPreview> {
    const { getPreview } = await this.getSpotifyUrlInfo();
    return getPreview(spotifyUrl);
  }

  private extractPlatformLinks(odesliResponse: OdesliResponse): PlatformLink[] {
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
