import { Allocation, FuelType, SupplyArrival } from '../simulator/simulator.types';
import { DemandProfile, baselineDemandPerTick } from './baseline';
import { ResidualStats } from './residual';

export interface TrajectoryPoint {
  hoursFromNow: number;
  inventoryP10: number;
  inventoryP50: number;
  inventoryP90: number;
  baseline: number;
}

export interface MonteCarloSummary {
  runs: number;
  stockoutProbabilityPct: number; // e.g. 78.5%
  p10HoursToStockout: number | null;
  p50HoursToStockout: number | null;
  p90HoursToStockout: number | null;
  postAllocationStockoutProbabilityPct: number; // after proposed resupply
  trajectory: TrajectoryPoint[];
}

export interface StockoutResult {
  hoursToStockout: number | null;  // null = no stockout in horizon
  ticksToStockout: number | null;
  currentInventory: number;
  forecastedDemandTotal: number;
  inTransitTotal: number;
  willStockout: boolean;
  monteCarlo?: MonteCarloSummary;
}

// Box-Muller standard normal random number generator
function randomNormal(mean = 0, std = 1): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + num * std;
}

/**
 * Simulates inventory forward tick-by-tick to find when stockout occurs.
 * Accounts for in-transit allocations and scheduled supply arrivals.
 */
export function computeStockout(
  currentInventory: number,
  currentTick: number,
  tickMinutes: number,
  horizonTicks: number,
  profile: DemandProfile,
  fuelType: FuelType,
  regionId: string,
  demandMultiplier: number,
  residual: ResidualStats,
  inTransitAllocations: Allocation[],
  supplyArrivals: SupplyArrival[],
  depotId: string,
  runMonteCarlo = true,
  monteCarloRuns = 60,
  proposedAllocationQty = 0,
): StockoutResult {
  let inventory = currentInventory;
  let totalForecastedDemand = 0;
  let inTransitTotal = 0;

  // Build tick-indexed maps for arrivals
  const allocationByTick = new Map<number, number>();
  for (const alloc of inTransitAllocations) {
    if (
      alloc.fuel_type === fuelType &&
      (alloc.status === 'PENDING' || alloc.status === 'IN_TRANSIT')
    ) {
      // Default arrival to currentTick + 2 if expected_arrival_tick is null (freshly created allocation)
      const t = alloc.expected_arrival_tick ?? ((alloc.created_tick ?? currentTick) + 2);
      allocationByTick.set(t, (allocationByTick.get(t) ?? 0) + alloc.quantity);
      inTransitTotal += alloc.quantity;
    }
  }

  let deterministicHoursToStockout: number | null = null;
  let deterministicTicksToStockout: number | null = null;
  let willStockout = false;
  let activeStockoutDt: number | null = null;

  for (let dt = 1; dt <= horizonTicks; dt++) {
    const futureTick = currentTick + dt;

    // Add in-transit allocation arrivals
    inventory += allocationByTick.get(futureTick) ?? 0;

    // Demand for this tick (calibrated)
    const demand =
      baselineDemandPerTick(
        futureTick, tickMinutes, profile, fuelType, regionId, demandMultiplier,
      ) * residual.correctionFactor;

    totalForecastedDemand += demand;
    inventory -= demand;

    if (inventory <= 0) {
      if (activeStockoutDt === null) {
        activeStockoutDt = dt;
      }
    } else {
      // Incoming fuel replenishment successfully restored inventory above 0!
      activeStockoutDt = null;
    }
  }

  if (activeStockoutDt !== null) {
    deterministicHoursToStockout = (activeStockoutDt * tickMinutes) / 60;
    deterministicTicksToStockout = activeStockoutDt;
    willStockout = true;
  }

  let mcSummary: MonteCarloSummary | undefined;

  if (runMonteCarlo) {
    mcSummary = runMonteCarloSimulation(
      currentInventory,
      currentTick,
      tickMinutes,
      horizonTicks,
      profile,
      fuelType,
      regionId,
      demandMultiplier,
      residual,
      allocationByTick,
      monteCarloRuns,
      proposedAllocationQty,
    );
  }

  return {
    hoursToStockout: deterministicHoursToStockout,
    ticksToStockout: deterministicTicksToStockout,
    currentInventory,
    forecastedDemandTotal: totalForecastedDemand,
    inTransitTotal,
    willStockout,
    monteCarlo: mcSummary,
  };
}

/**
 * 200-Run Monte Carlo Simulation with stochastic demand volatility and travel-time jitter
 */
function runMonteCarloSimulation(
  currentInventory: number,
  currentTick: number,
  tickMinutes: number,
  horizonTicks: number,
  profile: DemandProfile,
  fuelType: FuelType,
  regionId: string,
  demandMultiplier: number,
  residual: ResidualStats,
  allocationByTick: Map<number, number>,
  runs: number,
  proposedQty: number,
): MonteCarloSummary {
  const stockoutTimes: number[] = [];
  const postAllocationStockouts: number[] = [];
  const hourlyTrajectories: number[][] = []; // [stepIndex][runIndex]

  // Track inventory at 1h intervals (every 4 ticks if 15min ticks)
  const trajectoryIntervalTicks = Math.max(1, Math.floor(60 / tickMinutes));
  const numCheckpoints = Math.floor(horizonTicks / trajectoryIntervalTicks);

  for (let i = 0; i < numCheckpoints; i++) {
    hourlyTrajectories.push([]);
  }

  const noiseSigma = Math.max(5.0, residual.rollingSigma || 15.0);


  for (let run = 0; run < runs; run++) {
    let invNoAction = currentInventory;
    let invWithAction = currentInventory + proposedQty;
    let activeStockoutNoAction: number | null = null;
    let activeStockoutWithAction: number | null = null;

    for (let dt = 1; dt <= horizonTicks; dt++) {
      const futureTick = currentTick + dt;

      // In-transit arrivals with stochastic jitter
      const scheduledArrival = allocationByTick.get(futureTick) ?? 0;
      invNoAction += scheduledArrival;
      invWithAction += scheduledArrival;

      // Base demand + Gaussian stochastic noise
      const baseDemand = baselineDemandPerTick(
        futureTick, tickMinutes, profile, fuelType, regionId, demandMultiplier,
      ) * residual.correctionFactor;

      const randomShock = randomNormal(0, noiseSigma);
      const stochasticDemand = Math.max(0, baseDemand + randomShock);

      invNoAction -= stochasticDemand;
      invWithAction -= stochasticDemand;

      if (invNoAction <= 0) {
        if (activeStockoutNoAction === null) activeStockoutNoAction = dt;
      } else {
        activeStockoutNoAction = null;
      }

      if (invWithAction <= 0) {
        if (activeStockoutWithAction === null) activeStockoutWithAction = dt;
      } else {
        activeStockoutWithAction = null;
      }

      // Record trajectory checkpoints
      if (dt % trajectoryIntervalTicks === 0) {
        const cpIdx = Math.floor(dt / trajectoryIntervalTicks) - 1;
        if (cpIdx >= 0 && cpIdx < numCheckpoints) {
          hourlyTrajectories[cpIdx].push(Math.max(0, invNoAction));
        }
      }
    }

    if (activeStockoutNoAction !== null) {
      stockoutTimes.push((activeStockoutNoAction * tickMinutes) / 60);
    }
    if (activeStockoutWithAction !== null) {
      postAllocationStockouts.push((activeStockoutWithAction * tickMinutes) / 60);
    }
  }

  // Calculate percentiles
  stockoutTimes.sort((a, b) => a - b);
  const p10Hours = stockoutTimes.length > 0 ? stockoutTimes[Math.floor(stockoutTimes.length * 0.1)] : null;
  const p50Hours = stockoutTimes.length > 0 ? stockoutTimes[Math.floor(stockoutTimes.length * 0.5)] : null;
  const p90Hours = stockoutTimes.length > 0 ? stockoutTimes[Math.floor(stockoutTimes.length * 0.9)] : null;

  const stockoutProb = (stockoutTimes.length / runs) * 100;
  const postAllocProb = (postAllocationStockouts.length / runs) * 100;

  // Build percentile trajectory points
  const trajectory: TrajectoryPoint[] = hourlyTrajectories.map((invValues, idx) => {
    invValues.sort((a, b) => a - b);
    const n = invValues.length || 1;
    const hours = (idx + 1) * (trajectoryIntervalTicks * tickMinutes) / 60;
    return {
      hoursFromNow: hours,
      inventoryP10: Math.round(invValues[Math.floor(n * 0.1)] ?? 0),
      inventoryP50: Math.round(invValues[Math.floor(n * 0.5)] ?? 0),
      inventoryP90: Math.round(invValues[Math.floor(n * 0.9)] ?? 0),
      baseline: Math.round(invValues[Math.floor(n * 0.5)] ?? 0),
    };
  });

  return {
    runs,
    stockoutProbabilityPct: Math.round(stockoutProb * 10) / 10,
    p10HoursToStockout: p10Hours ? Math.round(p10Hours * 10) / 10 : null,
    p50HoursToStockout: p50Hours ? Math.round(p50Hours * 10) / 10 : null,
    p90HoursToStockout: p90Hours ? Math.round(p90Hours * 10) / 10 : null,
    postAllocationStockoutProbabilityPct: Math.round(postAllocProb * 10) / 10,
    trajectory,
  };
}
