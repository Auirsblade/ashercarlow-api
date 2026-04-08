import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MusicModule } from './music/music.module';
import { KalshiObserverModule } from './kalshi-observer/kalshi-observer.module';
import { AlpacaObserverModule } from './alpaca-observer/alpaca-observer.module';

@Module({
  imports: [MusicModule, KalshiObserverModule, AlpacaObserverModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
