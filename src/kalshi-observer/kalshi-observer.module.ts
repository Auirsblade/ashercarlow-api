import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { KalshiObserverController } from './kalshi-observer.controller';
import { KalshiClient } from './clients/kalshi.client';
import { MetarClient } from './clients/metar.client';
import { NwsClient } from './clients/nws.client';
import { FaaNasStatusClient } from './clients/faa-nas-status.client';
import { ObserverRepository } from './storage/observer.repository';
import { StationMapperService } from './services/station-mapper.service';
import { MarketScannerService } from './services/market-scanner.service';
import { SamplingService } from './services/sampling.service';
import { WeatherSignalService } from './services/weather-signal.service';
import { DiscrepancyService } from './services/discrepancy.service';
import { SimulatorService } from './services/simulator.service';
import { ResolutionTrackerService } from './services/resolution-tracker.service';
import { ReportingService } from './services/reporting.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [KalshiObserverController],
  providers: [
    KalshiClient,
    MetarClient,
    NwsClient,
    FaaNasStatusClient,
    ObserverRepository,
    StationMapperService,
    MarketScannerService,
    SamplingService,
    WeatherSignalService,
    DiscrepancyService,
    SimulatorService,
    ResolutionTrackerService,
    ReportingService,
  ],
  exports: [
    KalshiClient,
    MetarClient,
    NwsClient,
    FaaNasStatusClient,
    ObserverRepository,
    StationMapperService,
    MarketScannerService,
    SamplingService,
    WeatherSignalService,
    DiscrepancyService,
    SimulatorService,
    ResolutionTrackerService,
    ReportingService,
  ],
})
export class KalshiObserverModule {}
