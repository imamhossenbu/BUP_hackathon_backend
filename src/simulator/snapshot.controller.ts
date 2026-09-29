import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SimulatorPoller } from './simulator.poller';
import { SimulatorSnapshot } from './simulator.types';

@Controller('api')
export class SnapshotController {
  constructor(private readonly poller: SimulatorPoller) {}

  @Get('snapshot')
  getSnapshot(): SimulatorSnapshot {
    const snapshot = this.poller.getSnapshot();
    if (!snapshot) {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Simulator snapshot initializing, please retry shortly',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return snapshot;
  }
}
