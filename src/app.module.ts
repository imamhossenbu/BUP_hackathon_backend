import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { SimulatorModule } from './simulator/simulator.module';
import { HealthModule } from './health/health.module';
import { ForecastModule } from './forecast/forecast.module';
import { DecisionModule } from './decision/decision.module';
import { AIModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SimulatorModule,
    HealthModule,
    ForecastModule,
    DecisionModule,
    AIModule,
  ],
})
export class AppModule {}

