import { Module } from '@nestjs/common';
import { SimulatorModule } from '../simulator/simulator.module';
import { ForecastModule } from '../forecast/forecast.module';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';

@Module({
  imports: [SimulatorModule, ForecastModule],
  providers: [AIService],
  controllers: [AIController],
  exports: [AIService],
})
export class AIModule {}
