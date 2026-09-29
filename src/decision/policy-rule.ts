import { FuelType, Depot, Station, Route } from '../simulator/simulator.types';
import { StationFuelForecast } from '../forecast/forecast.service';
import { AllocationCandidate, prevalidateAllocation } from './prevalidate';

export interface PolicyResult {
  candidate: AllocationCandidate | null;
  quantityL: number;
  chosenRouteId: string | null;
  rejectedRoutes: Array<{ routeId: string; reason: string }>;
  reason: string;
}

/**
 * Policy A — Rule-based greedy allocation.
 * Picks the fastest AVAILABLE route and sizes quantity to cover
 * forecast demand until re-supply without overflowing the tank.
 */
export function policyRuleAllocation(
  forecast: StationFuelForecast,
  depots: Depot[],
  stations: Station[],
  routes: Route[],
  pendingDispatchThisTick: number,
  horizonTicks: number,
): PolicyResult {
  const { stationId, fuelType, demandPerTick } = forecast;

  // Candidate routes: those connecting any depot to this station, sorted by transit_ticks
  const candidateRoutes = routes
    .filter(r => r.destination_station_id === stationId)
    .sort((a, b) => a.transit_ticks - b.transit_ticks);

  const station = stations.find(s => s.id === stationId);
  if (!station) return { candidate: null, quantityL: 0, chosenRouteId: null, rejectedRoutes: [], reason: 'Station not found' };

  const rejectedRoutes: Array<{ routeId: string; reason: string }> = [];

  for (const route of candidateRoutes) {
    const depot = depots.find(d => d.id === route.source_depot_id);
    if (!depot) {
      rejectedRoutes.push({ routeId: route.id, reason: 'Source depot not found' });
      continue;
    }

    // Size: enough to cover demand until transit completes + buffer horizon
    const coverTicks = route.transit_ticks + Math.min(horizonTicks / 4, 24);
    const neededL = Math.ceil(demandPerTick * coverTicks);

    // Respect constraints
    const stationHeadroom = station.capacity[fuelType] - station.inventory[fuelType];
    const depotAvailable = depot.inventory[fuelType];
    const dispatchRemaining = depot.dispatch_capacity_per_tick - pendingDispatchThisTick;

    const maxPossible = Math.min(
      route.max_shipment,
      stationHeadroom,
      depotAvailable,
      dispatchRemaining,
    );

    const quantity = Math.min(neededL, maxPossible);

    if (quantity <= 0) {
      rejectedRoutes.push({ routeId: route.id, reason: `No capacity: headroom=${stationHeadroom} depot=${depotAvailable} dispatch_remaining=${dispatchRemaining}` });
      continue;
    }

    const candidate: AllocationCandidate = {
      sourceDepotId: depot.id,
      destinationStationId: stationId,
      routeId: route.id,
      fuelType,
      quantity,
    };

    const validation = prevalidateAllocation(candidate, depots, stations, routes, pendingDispatchThisTick);
    if (!validation.valid) {
      rejectedRoutes.push({ routeId: route.id, reason: validation.failureReason ?? 'Pre-validation failed' });
      continue;
    }

    return {
      candidate,
      quantityL: quantity,
      chosenRouteId: route.id,
      rejectedRoutes,
      reason: `Policy A: fastest feasible route (transit ${route.transit_ticks} ticks), quantity covers ~${Math.round(coverTicks)} ticks of demand`,
    };
  }

  return {
    candidate: null,
    quantityL: 0,
    chosenRouteId: null,
    rejectedRoutes,
    reason: 'No feasible route found for Policy A',
  };
}
