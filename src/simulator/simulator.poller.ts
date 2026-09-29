import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SimulatorClient } from './simulator.client';
import { SimulatorSnapshot } from './simulator.types';

@Injectable()
export class SimulatorPoller implements OnModuleInit {
  private readonly logger = new Logger(SimulatorPoller.name);
  private currentSnapshot: SimulatorSnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(
    private readonly client: SimulatorClient,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.configService.get<number>('pollIntervalMs', 3000);
    this.poll(); // initial poll immediately
    this.timer = setInterval(() => this.poll(), interval);
  }

  async poll(): Promise<SimulatorSnapshot | null> {
    if (this.isPolling) return this.currentSnapshot;
    this.isPolling = true;

    try {
      const [
        instance,
        regions,
        depots,
        stations,
        routes,
        supplyArrivals,
        events,
        recentAllocations,
        recentDemand,
        metrics,
      ] = await Promise.all([
        this.client.getInstance(),
        this.client.getRegions(),
        this.client.getDepots(),
        this.client.getStations(),
        this.client.getRoutes(),
        this.client.getSupplyArrivals(),
        this.client.getEvents(),
        this.client.getAllocations(),
        this.client.getDemandHistory(100),
        this.client.getMetrics(),
      ]);

      const snapshot: SimulatorSnapshot = {
        instance,
        regions,
        depots,
        stations,
        routes,
        supplyArrivals,
        events,
        recentAllocations,
        recentDemand,
        metrics,
        capturedAt: Date.now(),
        isStaleHeader: this.client.isStale(),
        circuitBreakerState: this.client.getBreakerState(),
      };

      this.currentSnapshot = snapshot;
      this.client.setLastGoodSnapshot(snapshot);
      return snapshot;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Polling failed: ${errorMsg}. Falling back to cached snapshot.`);
      const lastGood = this.client.getLastGoodSnapshot();
      if (lastGood) {
        this.currentSnapshot = {
          ...lastGood,
          isStaleHeader: true,
          circuitBreakerState: this.client.getBreakerState(),
        };
      }
      return this.currentSnapshot;
    } finally {
      this.isPolling = false;
    }
  }

  getSnapshot(): SimulatorSnapshot | null {
    return this.currentSnapshot;
  }
}
