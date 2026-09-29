import { Injectable, Logger } from '@nestjs/common';
import { SimulatorPoller } from '../simulator/simulator.poller';
import { FuelType, Station, Allocation, SupplyArrival, DemandHistoryRow } from '../simulator/simulator.types';
import { DemandProfile, baselineDemandPerTick } from './baseline';
import { ResidualStats, fitResidual } from './residual';
import { StockoutResult, computeStockout } from './stockout';
import { ConfigService } from '@nestjs/config';
import { MLClient } from './ml.client';


export type SeverityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface StationFuelForecast {
  stationId: string;
  stationName: string;
  fuelType: FuelType;
  regionId: string;
  inventory: number;
  currentInventory: number; // alias for backwards compatibility
  capacity: number;
  fillPct: number;          // 0 to 100%
  demandRate: number;       // Liters / tick (blended recent ring-buffer + dynamic upcoming forecast)
  hoursToStockout: number;  // Integrated tick-by-tick (999 if no stockout in horizon)
  ticksToStockout: number | null;
  unmetSignal: boolean;     // true if recent unmet_liters > 0
  unmetLitersRecent: number;
  severity: SeverityTier;   // CRITICAL < 6h, HIGH 6-12h, MEDIUM 12-24h, LOW > 24h
  baselineDailyDemand: number;
  demandPerTick: number;
  stockout: StockoutResult;
  residual: ResidualStats;
  inTransitLiters: number;
  mlPredictedDemand?: number;
}

const STATION_PROFILES: Record<string, DemandProfile> = {
  'station-mirpur':     'urban_high',
  'station-tongi':      'industrial',
  'station-karnaphuli': 'highway',
  'station-coxsbazar':  'regional',
};

const BASELINE_DAILY_DEMANDS: Record<string, number> = {
  'station-karnaphuli': 27700,
  'station-mirpur':     24600,
  'station-tongi':      20700,
  'station-coxsbazar':  18400,
};

const STATION_DEPOT: Record<string, string> = {
  'station-mirpur':     'depot-gazipur',
  'station-tongi':      'depot-gazipur',
  'station-karnaphuli': 'depot-patiya',
  'station-coxsbazar':  'depot-patiya',
};

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);
  private mlCache = new Map<string, number>();
  private mlCacheTick = -1;

  constructor(
    private readonly poller: SimulatorPoller,
    private readonly config: ConfigService,
    private readonly mlClient: MLClient,
  ) {}

  getStationDepot(stationId: string): string {
    return STATION_DEPOT[stationId] ?? 'depot-gazipur';
  }

  private getProfile(stationId: string): DemandProfile {
    return STATION_PROFILES[stationId] ?? 'regional';
  }


  computeAll(): StationFuelForecast[] {
    const snapshot = this.poller.getSnapshot();
    if (!snapshot) return [];

    const { stations, recentDemand, recentAllocations, supplyArrivals, instance } = snapshot;
    const currentTick = instance.tick;
    const tickMinutes = instance.tick_minutes;
    const horizonTicks = this.config.get<number>('forecastHorizonTicks', 96);
    const mcRuns = this.config.get<number>('monteCarloRuns', 200);

    const critHours = this.config.get<number>('urgencyCriticalHours', 6);
    const highHours = this.config.get<number>('urgencyHighHours', 12);
    const medHours  = this.config.get<number>('urgencyMediumHours', 24);

    const results: StationFuelForecast[] = [];

    // Invalidate ML cache on new tick
    if (currentTick !== this.mlCacheTick) {
      this.mlCache.clear();
      this.mlCacheTick = currentTick;
    }

    for (const station of stations) {
      if (station.status === 'OUTAGE') continue;
      const profile = this.getProfile(station.id);
      const depotId = STATION_DEPOT[station.id] ?? 'depot-gazipur';
      const baselineTotal = BASELINE_DAILY_DEMANDS[station.id] ?? 20000;

      for (const fuelType of ['DIESEL', 'PETROL', 'OCTANE'] as FuelType[]) {
        const currentInventory = station.inventory[fuelType] ?? 0;
        const capacity = station.capacity[fuelType] ?? 15000;
        const fillPct = Math.min(100, Math.max(0, (currentInventory / capacity) * 100));


        // Filter recent demand records for this station & fuel (ring buffer)
        const stationDemandHistory = recentDemand.filter(
          d => d.station_id === station.id && d.fuel_type === fuelType,
        );

        // Check recent unmet liters (last 10 ticks)
        const recentUnmetLiters = stationDemandHistory
          .slice(-10)
          .reduce((sum, d) => sum + (d.unmet_liters ?? 0), 0);
        const unmetSignal = recentUnmetLiters > 0;

        // Residual calibration
        const residual = fitResidual(
          recentDemand,
          station.id,
          fuelType,
          profile,
          station.region_id,
          tickMinutes,
        );

        // In-transit allocations
        const stationAllocations = recentAllocations.filter(
          a => a.destination_station_id === station.id && a.fuel_type === fuelType,
        );

        // ML prediction lookup from cache
        const mlKey = `${station.id}:${fuelType}`;
        const mlDemand = this.mlCache.get(mlKey);

        const stockout = computeStockout(
          currentInventory,
          currentTick,
          tickMinutes,
          horizonTicks,
          profile,
          fuelType,
          station.region_id,
          station.demand_multiplier,
          residual,
          stationAllocations,
          supplyArrivals,
          depotId,
          true,
          mcRuns,
          Math.min(5000, capacity - currentInventory), // default hypothetical resupply for Monte Carlo
        );

        const baselineDemandTick = baselineDemandPerTick(
          currentTick, tickMinutes, profile, fuelType, station.region_id, station.demand_multiplier,
        ) * residual.correctionFactor;

        // 8.2b: demandRate = recent average from ring buffer + forecast for upcoming ticks (hour factor blended)
        const recentAvg = stationDemandHistory.length > 0
          ? stationDemandHistory.slice(-10).reduce((sum, d) => sum + d.demand_liters, 0) / Math.min(10, stationDemandHistory.length)
          : baselineDemandTick;
        
        // Blend past recent average (40%) and upcoming forecast (60%)
        const demandRate = round2(0.4 * recentAvg + 0.6 * (mlDemand ?? baselineDemandTick));

        // 8.2b: hoursToStockout from tick-by-tick forward integration (999 if no stockout)
        const hoursToStockout = stockout.hoursToStockout !== null
          ? round1(stockout.hoursToStockout)
          : 999.0;

        // 8.2b: Severity tiers:
        // CRITICAL < 6h or ongoing unmet; HIGH 6-12h; MEDIUM 12-24h; LOW > 24h
        // If an allocation is in transit (inTransitTotal > 0), emergency replenishment is en route!
        // Mitigate severity so operator sees risk reduction immediately upon dispatch!
        let severity: SeverityTier = 'LOW';
        const inTransitL = stockout.inTransitTotal;

        if (unmetSignal && inTransitL === 0) {
          severity = 'CRITICAL';
        } else if (hoursToStockout < critHours) {
          severity = inTransitL > 0 ? 'HIGH' : 'CRITICAL';
        } else if (hoursToStockout < highHours) {
          severity = inTransitL > 0 ? 'MEDIUM' : 'HIGH';
        } else if (hoursToStockout < medHours) {
          severity = inTransitL > 0 ? 'LOW' : 'MEDIUM';
        } else {
          severity = 'LOW';
        }

        results.push({
          stationId: station.id,
          stationName: station.name,
          fuelType,
          regionId: station.region_id,
          inventory: round1(currentInventory),
          currentInventory: round1(currentInventory),
          capacity: round1(capacity),
          fillPct: round1(fillPct),
          demandRate,
          hoursToStockout,
          ticksToStockout: stockout.ticksToStockout,
          unmetSignal,
          unmetLitersRecent: round1(recentUnmetLiters),
          severity,
          baselineDailyDemand: baselineTotal,
          demandPerTick: mlDemand ?? baselineDemandTick,
          stockout,
          residual,
          inTransitLiters: round1(inTransitL),
          mlPredictedDemand: mlDemand,
        });
      }
    }

    // Refresh ML cache asynchronously
    this.refreshMLCache(stations, currentTick, instance.tick_minutes).catch(() => {});

    // 8.2b: Priority is decided by hoursToStockout (lowest first), not by demand size.
    // Tie-breakers, in order: higher demandRate, lower fillPct, ongoing unmet.
    return results.sort((a, b) => {
      // Primary: hoursToStockout ASC
      if (a.hoursToStockout !== b.hoursToStockout) {
        return a.hoursToStockout - b.hoursToStockout;
      }
      // Tie-breaker 1: higher demandRate DESC
      if (b.demandRate !== a.demandRate) {
        return b.demandRate - a.demandRate;
      }
      // Tie-breaker 2: lower fillPct ASC
      if (a.fillPct !== b.fillPct) {
        return a.fillPct - b.fillPct;
      }
      // Tie-breaker 3: ongoing unmet (true first)
      if (a.unmetSignal !== b.unmetSignal) {
        return a.unmetSignal ? -1 : 1;
      }
      return 0;
    });
  }

  private async refreshMLCache(stations: Station[], tick: number, tickMinutes: number): Promise<void> {
    if (!this.mlClient.getAvailability()) return;

    const requests = stations.flatMap(station => {
      if (station.status === 'OUTAGE') return [];
      return (['DIESEL', 'PETROL', 'OCTANE'] as FuelType[]).map(fuelType => ({
        station_id: station.id,
        fuel_type: fuelType,
        tick,
        demand_multiplier: station.demand_multiplier,
        inventory_level: station.inventory[fuelType] ?? 0,
      }));
    });

    if (requests.length === 0) return;

    const preds = await this.mlClient.predictBatch(requests);
    for (const pred of preds) {
      const key = `${pred.station_id}:${pred.fuel_type}`;
      this.mlCache.set(key, pred.demand_liters);
    }
  }

  getUrgentItems(): StationFuelForecast[] {
    return this.computeAll().filter(f => f.severity !== 'LOW');
  }
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}
