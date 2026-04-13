import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AlpacaClient } from './clients/alpaca.client';
import { MarketDataClient } from './clients/market-data.client';
import { AlpacaObserverController } from './alpaca-observer.controller';
import { ChainSelectorService } from './services/chain-selector.service';
import { ExecutionService } from './services/execution.service';
import { AlpacaReportingService } from './services/reporting.service';
import { AlpacaSamplingService } from './services/sampling.service';
import { SignalService } from './services/signal.service';
import { AlpacaObserverRepository } from './storage/alpaca-observer.repository';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AlpacaObserverController],
  providers: [
    AlpacaClient,
    MarketDataClient,
    AlpacaObserverRepository,
    SignalService,
    ChainSelectorService,
    ExecutionService,
    AlpacaSamplingService,
    AlpacaReportingService,
  ],
  exports: [
    AlpacaClient,
    MarketDataClient,
    AlpacaObserverRepository,
    SignalService,
    ChainSelectorService,
    ExecutionService,
    AlpacaSamplingService,
    AlpacaReportingService,
  ],
})
export class AlpacaObserverModule {}
