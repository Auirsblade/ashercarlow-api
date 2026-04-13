import { ApiProperty } from '@nestjs/swagger';

export class AlpacaPositionCountsDto {
  @ApiProperty() total!: number;
  @ApiProperty() open!: number;
  @ApiProperty() closed!: number;
  @ApiProperty() errored!: number;
}

export class AlpacaPnlDto {
  @ApiProperty() realizedTotal!: number;
  @ApiProperty() closedCount!: number;
  @ApiProperty({ nullable: true, type: Number })
  winRate!: number | null;
  @ApiProperty({ nullable: true, type: Number })
  averageRealizedPerPosition!: number | null;
}

export class AlpacaObserverSummaryDto {
  @ApiProperty({ example: 'phase-1-paper' })
  phase!: string;

  @ApiProperty({ example: 'paper-only-never-live' })
  trading!: string;

  @ApiProperty({ enum: ['enabled', 'disabled'] })
  scheduler!: 'enabled' | 'disabled';

  @ApiProperty()
  dryRun!: boolean;

  @ApiProperty()
  credentialsLoaded!: boolean;

  @ApiProperty({ type: AlpacaPositionCountsDto })
  positions!: AlpacaPositionCountsDto;

  @ApiProperty({ type: AlpacaPnlDto })
  pnl!: AlpacaPnlDto;

  @ApiProperty({ nullable: true, type: Object })
  recentSignal!: Record<string, unknown> | null;
}
