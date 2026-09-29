import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SimulatorClient } from './simulator.client';
import { SimulatorPoller } from './simulator.poller';
import { SnapshotController } from './snapshot.controller';
import { SimulatorControlController } from './simulator.control.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SnapshotController, SimulatorControlController],
  providers: [SimulatorClient, SimulatorPoller],
  exports: [SimulatorClient, SimulatorPoller],
})
export class SimulatorModule {}

