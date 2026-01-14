import { ApiProperty } from '@nestjs/swagger';

export class GetMetadataDto {
  @ApiProperty({
    description: 'A Spotify or Apple Music URL',
    example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  })
  url: string;
}

export class PlatformLink {
  @ApiProperty({
    example: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  })
  url: string;

  @ApiProperty({ example: 'spotify' })
  platform: string;
}

export class MusicMetadataResponse {
  @ApiProperty({ example: 'Never Gonna Give You Up' })
  title: string;

  @ApiProperty({ example: 'Rick Astley' })
  artist: string;

  @ApiProperty({ example: 'Whenever You Need Somebody' })
  album: string;

  @ApiProperty({ example: '1987-11-12', nullable: true })
  releaseDate: string | null;

  @ApiProperty({ example: ['synth-pop', 'dance-pop'], nullable: true })
  genres: string[] | null;

  @ApiProperty({ example: 'https://i.scdn.co/image/...' })
  image: string;

  @ApiProperty({ type: [PlatformLink] })
  platformLinks: PlatformLink[];

  @ApiProperty({ example: 'https://song.link/...' })
  universalLink: string;
}
