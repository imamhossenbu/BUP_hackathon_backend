import { Module } from '@nestjs/common';
import { SimulatorModule } from '../simulator/simulator.module';
import { ForecastModule } from '../forecast/forecast.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DecisionService } from './decision.service';
import { DecisionController } from './decision.controller';

@Module({
  imports: [SimulatorModule, ForecastModule, PrismaModule],
  providers: [DecisionService],
  controllers: [DecisionController],
  exports: [DecisionService],
})
export class DecisionModule {}
