import { Controller, Post, Body } from '@nestjs/common';
import { SimulatorClient } from './simulator.client';
import { SimulatorPoller } from './simulator.poller';

@Controller('api/simulator/control')
export class SimulatorControlController {
  constructor(
    private readonly client: SimulatorClient,
    private readonly poller: SimulatorPoller,
  ) {}

  @Post('step')
  async step() {
    const res = await this.client.step();
    await this.poller.poll();
    return res;
  }

  @Post('run')
  async run() {
    return this.client.run();
  }

  @Post('pause')
  async pause() {
    return this.client.pause();
  }

  @Post('reset')
  async reset() {
    const res = await this.client.reset();
    await this.poller.poll();
    return res;
  }

  @Post('event')
  async injectEvent(@Body() payload: unknown) {
    return this.client.injectEvent(payload);
  }

  @Post('fault')
  async injectFault(@Body() payload: unknown) {
    return this.client.injectFault(payload);
  }

  /** Manual operator allocation — bypasses AI recommendation flow */
  @Post('allocate')
  async manualAllocate(
    @Body()
    body: {
      source_depot_id: string;
      destination_station_id: string;
      route_id: string;
      fuel_type: 'DIESEL' | 'PETROL' | 'OCTANE';
      quantity: number;
      idempotency_key?: string;
    },
  ) {
    const dto = {
      idempotency_key:
        body.idempotency_key ||
        `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source_depot_id: body.source_depot_id,
      destination_station_id: body.destination_station_id,
      route_id: body.route_id,
      fuel_type: body.fuel_type,
      quantity: body.quantity,
    };
    const result = await this.client.createAllocation(dto);
    await this.poller.poll();
    return result;
  }
}

