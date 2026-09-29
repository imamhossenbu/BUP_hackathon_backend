import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SimulatorClient } from '../simulator/simulator.client';

export interface HealthStatusResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  components: {
    backend: { status: string };
    database: { status: string };
    simulator: { status: string; detail?: unknown };
    circuitBreaker: { state: string };
  };
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulatorClient: SimulatorClient,
  ) {}

  @Get()
  async check(): Promise<HealthStatusResponse> {
    let dbStatus = 'healthy';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'unhealthy';
    }

    let simStatus = 'healthy';
    let simDetail: unknown = null;
    try {
      simDetail = await this.simulatorClient.getHealth();
    } catch (err: unknown) {
      simStatus = 'unhealthy';
      simDetail = err instanceof Error ? err.message : String(err);
    }

    const breakerState = this.simulatorClient.getBreakerState();
    const isDegraded = breakerState !== 'CLOSED' || dbStatus !== 'healthy' || simStatus !== 'healthy';

    return {
      status: isDegraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      components: {
        backend: { status: 'healthy' },
        database: { status: dbStatus },
        simulator: { status: simStatus, detail: simDetail },
        circuitBreaker: { state: breakerState },
      },
    };
  }
}
