import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  DiscrepancyViewDto,
  MappingErrorViewDto,
  ObserverSummaryDto,
  PositionViewDto,
} from './dto/reports.dto';
import { ReportingService } from './services/reporting.service';

/**
 * Read-only inspection endpoints for the Kalshi weather observer.
 * None of these endpoints mutate state. Phase 1 is observation-only.
 */
@ApiTags('kalshi-observer')
@Controller('kalshi-observer')
export class KalshiObserverController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health ping',
    description:
      'Confirms the observer module is mounted. Phase 1 is read-only.',
  })
  health(): { status: string; phase: string; trading: boolean } {
    return { status: 'ok', phase: 'phase-1-observer', trading: false };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Observer summary',
    description:
      'Bankroll, market counts, discrepancy counts, and open-position exposure.',
  })
  @ApiOkResponse({ type: ObserverSummaryDto })
  summary(): ObserverSummaryDto {
    return this.reporting.getSummary() as ObserverSummaryDto;
  }

  @Get('discrepancies')
  @ApiOperation({
    summary: 'Recent discrepancies',
    description:
      'Returns discrepancy records, newest first. Optionally filter by since (ISO8601) or would_trade=true.',
  })
  @ApiQuery({ name: 'since', required: false, example: '2026-04-07T00:00:00Z' })
  @ApiQuery({ name: 'wouldTradeOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: DiscrepancyViewDto, isArray: true })
  discrepancies(
    @Query('since') since?: string,
    @Query('wouldTradeOnly') wouldTradeOnly?: string,
    @Query('limit') limit?: string,
  ): DiscrepancyViewDto[] {
    return this.reporting.listDiscrepancies({
      since,
      wouldTradeOnly: wouldTradeOnly === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
    }) as DiscrepancyViewDto[];
  }

  @Get('markets')
  @ApiOperation({
    summary: 'Tracked markets',
    description:
      'All curated markets currently stored with their mapped station and resolution source.',
  })
  @ApiQuery({ name: 'status', required: false, example: 'active' })
  markets(@Query('status') status?: string): unknown[] {
    return this.reporting.listMarkets({ status });
  }

  @Get('positions')
  @ApiOperation({
    summary: 'Simulated (paper) positions',
    description:
      'Open and closed paper positions. Phase 1 never places real orders.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['open', 'closed'],
  })
  @ApiOkResponse({ type: PositionViewDto, isArray: true })
  positions(@Query('status') status?: 'open' | 'closed'): PositionViewDto[] {
    return this.reporting.listPositions({ status }) as PositionViewDto[];
  }

  @Get('mapping-errors')
  @ApiOperation({
    summary: 'Signal mapping errors',
    description:
      'Closed losing positions where the signal was definitive (wP=0 or 1) but the market resolved the other way. These indicate station/CLI mapping bugs or METAR-vs-CLI drift that exceeded the safety margin.',
  })
  @ApiOkResponse({ type: MappingErrorViewDto, isArray: true })
  mappingErrors(): MappingErrorViewDto[] {
    return this.reporting.listMappingErrors() as MappingErrorViewDto[];
  }
}
