import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger DTOs for the observer's read-only inspection endpoints.
 * These are declaration-only — the actual data comes from ReportingService.
 */

export class BankrollSummaryDto {
  @ApiProperty() starting!: number;
  @ApiProperty() realizedPnl!: number;
  @ApiProperty() openExposure!: number;
  @ApiProperty() freeBankroll!: number;
  @ApiProperty() openPositions!: number;
  @ApiProperty() closedPositions!: number;
  @ApiProperty({ nullable: true, type: Number })
  winRate!: number | null;
}

export class MarketCountsDto {
  @ApiProperty() tracked!: number;
  @ApiProperty() active!: number;
  @ApiProperty() settled!: number;
}

export class DiscrepancyCountsDto {
  @ApiProperty() total!: number;
  @ApiProperty() wouldTradeTotal!: number;
  @ApiProperty() last24h!: number;
}

export class ObserverSummaryDto {
  @ApiProperty({
    example: 'phase-1-observer',
    description: 'Current observer phase.',
  })
  phase!: string;

  @ApiProperty({
    example: false,
    description:
      'Whether the observer is configured to place real trades. Phase 1 is ALWAYS false.',
  })
  trading!: false;

  @ApiProperty({ type: BankrollSummaryDto })
  bankroll!: BankrollSummaryDto;

  @ApiProperty({ type: MarketCountsDto })
  markets!: MarketCountsDto;

  @ApiProperty({ type: DiscrepancyCountsDto })
  discrepancies!: DiscrepancyCountsDto;
}

export class DiscrepancyViewDto {
  @ApiProperty() id!: number;
  @ApiProperty() market_ticker!: string;
  @ApiProperty() sampled_at!: string;
  @ApiProperty() market_implied_p!: number;
  @ApiProperty() weather_implied_p!: number;
  @ApiProperty() edge!: number;
  @ApiProperty() would_trade!: boolean;
  @ApiProperty({ nullable: true, type: String }) side!: string | null;
  @ApiProperty({ nullable: true, type: Number }) size_usd!: number | null;
  @ApiProperty({ nullable: true, type: Number }) fill_price!: number | null;
  @ApiProperty() reasoning!: string;
}

export class PositionViewDto {
  @ApiProperty() id!: number;
  @ApiProperty() market_ticker!: string;
  @ApiProperty() opened_at!: string;
  @ApiProperty() side!: string;
  @ApiProperty() size_usd!: number;
  @ApiProperty() entry_price!: number;
  @ApiProperty({ nullable: true, type: String }) closed_at!: string | null;
  @ApiProperty({ nullable: true, type: String })
  resolution_outcome!: string | null;
  @ApiProperty({ nullable: true, type: Number })
  realized_pnl_usd!: number | null;
}

export class MappingErrorViewDto {
  @ApiProperty() position_id!: number;
  @ApiProperty() market_ticker!: string;
  @ApiProperty() opened_at!: string;
  @ApiProperty() side!: string;
  @ApiProperty() entry_price!: number;
  @ApiProperty() weather_implied_p_at_open!: number;
  @ApiProperty() resolution_outcome!: string;
  @ApiProperty() realized_pnl_usd!: number;
  @ApiProperty() reasoning_at_open!: string;
}
