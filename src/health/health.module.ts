import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SimulatorModule } from '../simulator/simulator.module';

@Module({
  imports: [SimulatorModule],
  controllers: [HealthController],
})
export class HealthModule {}
