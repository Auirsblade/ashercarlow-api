import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Read-only inspection endpoints for the Alpaca iron condor observer.
 * Phase 1 stub: just a health ping. Real reporting endpoints will land
 * after the signal/execution/sampling services are wired up.
 */
@ApiTags('alpaca-observer')
@Controller('alpaca-observer')
export class AlpacaObserverController {
  @Get('health')
  @ApiOperation({
    summary: 'Alpaca observer health ping',
    description:
      'Confirms the observer module is mounted. Phase 1 is paper-trading only — never live.',
  })
  health(): { status: string; phase: string; trading: string } {
    return {
      status: 'ok',
      phase: 'phase-1-paper',
      trading: 'paper-only-never-live',
    };
  }
}
