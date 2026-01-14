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

        // getData() returns different structures for tracks vs albums
        if (spotifyData.type === 'album') {
          // For albums: use album name as title
          title = spotifyData.name || spotifyData.title;
          artist =
            spotifyData.subtitle ||
            spotifyData.artists?.[0]?.name ||
            spotifyData.artist;
          album = title; // Album field is same as title for album URLs
          image =
            spotifyData.visualIdentity?.backgroundBase?.backgroundImageUrl ||
            spotifyData.image;

          // Scrape release date from album page HTML
          releaseDate = await this.extractReleaseDateFromPage(spotifyUrl);
        } else {
          // For tracks: extract basic metadata
          title = spotifyData.name || spotifyData.title || spotifyData.track;
          artist =
            spotifyData.artists?.[0]?.name ||
            spotifyData.artist ||
            spotifyData.subtitle;
          releaseDate = spotifyData.releaseDate?.isoString || null;
          image =
            spotifyData.visualIdentity?.backgroundBase?.backgroundImageUrl ||
            spotifyData.image;

          // Try to get album information by scraping the track page
          const albumUrl = await this.extractAlbumUrlFromTrackPage(spotifyUrl);
          if (albumUrl) {
            try {
              const albumData = await this.fetchSpotifyMetadata(albumUrl);
              album = albumData.name || albumData.title || '';
            } catch {
              album = '';
            }
          } else {
            album = '';
          }
        }
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

    releaseDate = new Date(releaseDate)?.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" })

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
  ): Promise<any> {
    const { getData } = await this.getSpotifyUrlInfo();
    return getData(spotifyUrl);
  }

  /**
   * Scrapes the Spotify page HTML to extract album URL from a track page
   */
  private async extractAlbumUrlFromTrackPage(
    trackUrl: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(trackUrl);
      const html = await response.text();
      const albumUrlMatch = html.match(
        /https:\/\/open\.spotify\.com\/album\/[a-zA-Z0-9]+/,
      );
      return albumUrlMatch ? albumUrlMatch[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Extracts release date from JSON-LD structured data in Spotify page HTML
   */
  private async extractReleaseDateFromPage(
    url: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(url);
      const html = await response.text();
      const jsonLdMatch = html.match(
        /<script type="application\/ld\+json">(.+?)<\/script>/s,
      );

      if (jsonLdMatch) {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        return jsonData.datePublished || null;
      }
      return null;
    } catch {
      return null;
    }
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
