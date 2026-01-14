declare module 'spotify-url-info' {
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

  interface SpotifyUrlInfo {
    getData: (url: string) => Promise<unknown>;
    getPreview: (url: string) => Promise<SpotifyPreview>;
    getTracks: (url: string) => Promise<unknown[]>;
    getDetails: (
      url: string,
    ) => Promise<{ preview: SpotifyPreview; tracks: unknown[] }>;
  }

  function spotifyUrlInfo(fetch: typeof globalThis.fetch): SpotifyUrlInfo;

  export = spotifyUrlInfo;
}
