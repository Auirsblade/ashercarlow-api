import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MusicModule } from './music/music.module';
import { KalshiObserverModule } from './kalshi-observer/kalshi-observer.module';

@Module({
  imports: [MusicModule, KalshiObserverModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
