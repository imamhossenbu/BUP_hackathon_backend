import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';
import CircuitBreaker from 'opossum';
import { TtlCache } from '../common/ttl-cache';
import {
  SimulationInstance,
  Region,
  Depot,
  Station,
  Route,
  SupplyArrival,
  DomainEvent,
  Allocation,
  DemandHistoryRow,
  SimulatorMetrics,
  SimulatorSnapshot,
} from './simulator.types';
import {
  SimulationInstanceSchema,
  RegionSchema,
  DepotSchema,
  StationSchema,
  RouteSchema,
  SupplyArrivalSchema,
  DomainEventSchema,
  AllocationSchema,
  DemandHistoryRowSchema,
  SimulatorMetricsSchema,
} from './simulator.schemas';
import { parseSimulatorError, SimulatorException } from './simulator.errors';
import { z } from 'zod';

export interface CreateAllocationDto {
  idempotency_key: string;
  source_depot_id: string;
  destination_station_id: string;
  route_id: string;
  fuel_type: 'DIESEL' | 'PETROL' | 'OCTANE';
  quantity: number;
}

@Injectable()
export class SimulatorClient {
  private readonly logger = new Logger(SimulatorClient.name);
  private readonly http: AxiosInstance;
  private readonly breaker: CircuitBreaker<[string, unknown?], AxiosResponse>;
  private readonly cache = new TtlCache<unknown>(15000);
  private lastStaleHeader = false;
  private lastGoodSnapshot: SimulatorSnapshot | null = null;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>('simulatorBaseUrl', 'http://simulator-api:8000');
    const timeout = this.configService.get<number>('simTimeoutMs', 3000);

    this.http = axios.create({ baseURL, timeout });

    axiosRetry(this.http, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 503;
      },
    });

    const executeRequest = async (url: string, config?: unknown) => {
      return this.http.get(url, config as any);
    };

    this.breaker = new CircuitBreaker(executeRequest, {
      timeout,
      errorThresholdPercentage: 50,
      resetTimeout: 10000,
    });

    this.breaker.on('open', () => this.logger.warn('Circuit breaker OPEN for SimulatorClient'));
    this.breaker.on('halfOpen', () => this.logger.log('Circuit breaker HALF_OPEN'));
    this.breaker.on('close', () => this.logger.log('Circuit breaker CLOSED'));
  }

  getBreakerState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    if (this.breaker.opened) return 'OPEN';
    if (this.breaker.halfOpen) return 'HALF_OPEN';
    return 'CLOSED';
  }

  isStale(): boolean {
    return this.lastStaleHeader;
  }

  setLastGoodSnapshot(snapshot: SimulatorSnapshot): void {
    this.lastGoodSnapshot = snapshot;
  }

  getLastGoodSnapshot(): SimulatorSnapshot | null {
    return this.lastGoodSnapshot;
  }

  private async fetchWithBreaker<T>(path: string, schema: z.ZodSchema<T>): Promise<T> {
    try {
      const response = await this.breaker.fire(path);
      if (response.headers && response.headers['x-simulator-stale'] === 'true') {
        this.lastStaleHeader = true;
        this.logger.warn(`Stale data header detected on ${path}`);
      } else {
        this.lastStaleHeader = false;
      }

      const parseResult = schema.safeParse(response.data);
      if (!parseResult.success) {
        this.logger.error(`Validation error on ${path}: ${parseResult.error.message}`);
        throw new SimulatorException('INVALID_SIMULATOR_PAYLOAD', parseResult.error.message);
      }

      this.cache.set(path, parseResult.data);
      return parseResult.data;
    } catch (err) {
      const cached = this.cache.get(path) as T | null;
      if (cached !== null) {
        this.logger.warn(`Simulator fetch failed for ${path}, returning cached copy.`);
        return cached;
      }
      const parsed = parseSimulatorError(err);
      throw new SimulatorException(parsed.code, parsed.message, parsed.statusCode);
    }
  }

  async getHealth(): Promise<{ status: string; database: string; simulation: unknown }> {
    const res = await this.http.get('/v1/health');
    return res.data;
  }

  async getInstance(): Promise<SimulationInstance> {
    return this.fetchWithBreaker('/v1/instance', SimulationInstanceSchema);
  }

  async getRegions(): Promise<Region[]> {
    return this.fetchWithBreaker('/v1/regions', z.array(RegionSchema));
  }

  async getDepots(): Promise<Depot[]> {
    return this.fetchWithBreaker('/v1/depots', z.array(DepotSchema));
  }

  async getStations(): Promise<Station[]> {
    return this.fetchWithBreaker('/v1/stations', z.array(StationSchema));
  }

  async getRoutes(): Promise<Route[]> {
    return this.fetchWithBreaker('/v1/routes', z.array(RouteSchema));
  }

  async getSupplyArrivals(): Promise<SupplyArrival[]> {
    return this.fetchWithBreaker('/v1/supply-arrivals', z.array(SupplyArrivalSchema));
  }

  async getEvents(): Promise<DomainEvent[]> {
    return this.fetchWithBreaker('/v1/events', z.array(DomainEventSchema));
  }

  async getAllocations(): Promise<Allocation[]> {
    return this.fetchWithBreaker('/v1/allocations', z.array(AllocationSchema));
  }

  async getDemandHistory(limit: number = 200, stationId?: string): Promise<DemandHistoryRow[]> {
    const query = stationId ? `?station_id=${stationId}&limit=${limit}` : `?limit=${limit}`;
    return this.fetchWithBreaker(`/v1/demand-history${query}`, z.array(DemandHistoryRowSchema));
  }

  async getMetrics(): Promise<SimulatorMetrics> {
    return this.fetchWithBreaker('/v1/metrics', SimulatorMetricsSchema);
  }

  async createAllocation(dto: CreateAllocationDto): Promise<Allocation> {
    try {
      const res = await this.http.post('/v1/allocations', dto);
      return AllocationSchema.parse(res.data);
    } catch (err) {
      const parsed = parseSimulatorError(err);
      throw new SimulatorException(parsed.code, parsed.message, parsed.statusCode);
    }
  }

  async cancelAllocation(id: number): Promise<Allocation> {
    try {
      const res = await this.http.post(`/v1/allocations/${id}/cancel`);
      return AllocationSchema.parse(res.data);
    } catch (err) {
      const parsed = parseSimulatorError(err);
      throw new SimulatorException(parsed.code, parsed.message, parsed.statusCode);
    }
  }

  async step(): Promise<unknown> {
    const res = await this.http.post('/admin/step');
    return res.data;
  }

  async pause(): Promise<unknown> {
    const res = await this.http.post('/admin/pause');
    return res.data;
  }

  async run(): Promise<unknown> {
    const res = await this.http.post('/admin/run');
    return res.data;
  }

  async reset(): Promise<unknown> {
    const res = await this.http.post('/admin/reset');
    return res.data;
  }

  async injectEvent(payload: unknown): Promise<unknown> {
    const res = await this.http.post('/admin/events', payload);
    return res.data;
  }

  async injectFault(payload: unknown): Promise<unknown> {
    const res = await this.http.post('/admin/faults', payload);
    return res.data;
  }
}

