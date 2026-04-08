import { Module } from '@nestjs/common';
import { AlpacaClient } from './clients/alpaca.client';
import { AlpacaObserverController } from './alpaca-observer.controller';
import { AlpacaObserverRepository } from './storage/alpaca-observer.repository';

@Module({
  controllers: [AlpacaObserverController],
  providers: [AlpacaClient, AlpacaObserverRepository],
  exports: [AlpacaClient, AlpacaObserverRepository],
})
export class AlpacaObserverModule {}
