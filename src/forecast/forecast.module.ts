import { Module } from '@nestjs/common';
import { SimulatorModule } from '../simulator/simulator.module';
import { ForecastService } from './forecast.service';
import { ForecastController } from './forecast.controller';
import { MLClient } from './ml.client';

@Module({
  imports: [SimulatorModule],
  providers: [ForecastService, MLClient],
  controllers: [ForecastController],
  exports: [ForecastService, MLClient],
})
export class ForecastModule {}
