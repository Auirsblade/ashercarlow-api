import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetMetadataDto, MusicMetadataResponse } from './dto/get-metadata.dto';
import { MusicService } from './music.service';

@ApiTags('music')
@Controller('music')
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  @Get('getMetadata')
  @ApiOperation({
    summary: 'Get music metadata from a Spotify or Apple Music URL',
    description:
      'Scrapes Spotify metadata and uses Apple Music API to return cross-platform URLs and rich metadata',
  })
  @ApiResponse({
    status: 200,
    description: 'Music metadata retrieved successfully',
    type: MusicMetadataResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL or unable to fetch metadata',
  })
  async getMetadata(
    @Query() query: GetMetadataDto,
  ): Promise<MusicMetadataResponse> {
    return this.musicService.getMetadata(query.url);
  }
}
