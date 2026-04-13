import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AlpacaObserverSummaryDto } from './dto/reports.dto';
import { AlpacaReportingService } from './services/reporting.service';

/**
 * Read-only inspection endpoints for the Alpaca iron condor observer.
 * Phase 1 is paper-trading only — never live.
 */
@ApiTags('alpaca-observer')
@Controller('alpaca-observer')
export class AlpacaObserverController {
  constructor(private readonly reporting: AlpacaReportingService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health ping',
    description:
      'Confirms the observer module is mounted. Phase 1 is paper-only — never live.',
  })
  health(): { status: string; phase: string; trading: string } {
    return {
      status: 'ok',
      phase: 'phase-1-paper',
      trading: 'paper-only-never-live',
    };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Observer summary',
    description:
      'Position counts, realized PnL, win rate, scheduler state, and most recent signal sample.',
  })
  @ApiOkResponse({ type: AlpacaObserverSummaryDto })
  summary(): AlpacaObserverSummaryDto {
    return this.reporting.getSummary() as AlpacaObserverSummaryDto;
  }

  @Get('positions')
  @ApiOperation({
    summary: 'Iron condor positions',
    description:
      'All paper iron condors with their strikes, credit, max loss, status and realized PnL.',
  })
  @ApiQuery({ name: 'status', required: false })
  positions(@Query('status') status?: string): unknown[] {
    return this.reporting.listPositions({ status });
  }

  @Get('signals')
  @ApiOperation({
    summary: 'Recent signal samples',
    description:
      'VRP/VIX/RV/regime classification samples taken by the cron loop.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  signals(@Query('limit') limit?: string): unknown[] {
    return this.reporting.listRecentSignals(limit ? parseInt(limit, 10) : 50);
  }

  @Get('decisions')
  @ApiOperation({
    summary: 'Recent entry decisions',
    description:
      'Audit log of every cycle entry decision (open or skip) with the reason.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  decisions(@Query('limit') limit?: string): unknown[] {
    return this.reporting.listRecentDecisions(limit ? parseInt(limit, 10) : 50);
  }
}
