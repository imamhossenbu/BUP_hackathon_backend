import { FuelType, Route, Depot, Station, Allocation } from '../simulator/simulator.types';

export interface AllocationCandidate {
  sourceDepotId: string;
  destinationStationId: string;
  routeId: string;
  fuelType: FuelType;
  quantity: number;
}

export type ValidationFailureCode =
  | 'DEPOT_NOT_FOUND'
  | 'STATION_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'ROUTE_MISMATCH'
  | 'DEPOT_CLOSED'
  | 'STATION_CLOSED'
  | 'ROUTE_DISRUPTED'
  | 'ROUTE_CAPACITY_EXCEEDED'
  | 'INSUFFICIENT_INVENTORY'
  | 'DISPATCH_CAPACITY_EXCEEDED'
  | 'DESTINATION_CAPACITY_EXCEEDED';

export interface ValidationResult {
  valid: boolean;
  failureCode?: ValidationFailureCode;
  failureReason?: string;
}

/**
 * Locally replicates the simulator's 10-step allocation validation.
 * Running this before POSTing to /v1/allocations avoids 409 errors.
 *
 * @param pendingDispatchThisTick cumulative quantity already planned this tick from same depot
 */
export function prevalidateAllocation(
  candidate: AllocationCandidate,
  depots: Depot[],
  stations: Station[],
  routes: Route[],
  pendingDispatchThisTick: number,
): ValidationResult {
  const depot = depots.find(d => d.id === candidate.sourceDepotId);
  if (!depot) return { valid: false, failureCode: 'DEPOT_NOT_FOUND', failureReason: 'Depot not found' };

  const station = stations.find(s => s.id === candidate.destinationStationId);
  if (!station) return { valid: false, failureCode: 'STATION_NOT_FOUND', failureReason: 'Station not found' };

  const route = routes.find(r => r.id === candidate.routeId);
  if (!route) return { valid: false, failureCode: 'ROUTE_NOT_FOUND', failureReason: 'Route not found' };

  // Step 3: Route must connect correct depot→station
  if (route.source_depot_id !== candidate.sourceDepotId ||
      route.destination_station_id !== candidate.destinationStationId) {
    return { valid: false, failureCode: 'ROUTE_MISMATCH', failureReason: 'Route does not connect this depot to this station' };
  }

  // Step 4: Depot must be OPEN or CONSTRAINED (both allow dispatch)
  if (depot.status !== 'OPEN' && depot.status !== 'CONSTRAINED') {
    return { valid: false, failureCode: 'DEPOT_CLOSED', failureReason: `Depot ${depot.name} is not open` };
  }

  // Step 5: Station must be OPEN
  if (station.status !== 'OPEN') {
    return { valid: false, failureCode: 'STATION_CLOSED', failureReason: `Station ${station.name} is in OUTAGE` };
  }

  // Step 6: Route must be AVAILABLE
  if (route.status === 'DISRUPTED') {
    return { valid: false, failureCode: 'ROUTE_DISRUPTED', failureReason: `Route ${route.id} is disrupted` };
  }

  // Step 7: Quantity must not exceed route max_shipment
  if (candidate.quantity > route.max_shipment) {
    return { valid: false, failureCode: 'ROUTE_CAPACITY_EXCEEDED', failureReason: `Quantity ${candidate.quantity} exceeds route max ${route.max_shipment}` };
  }

  // Step 8: Depot must have enough inventory
  const depotInventory = depot.inventory[candidate.fuelType];
  if (depotInventory < candidate.quantity) {
    return { valid: false, failureCode: 'INSUFFICIENT_INVENTORY', failureReason: `Depot has ${depotInventory}L but ${candidate.quantity}L required` };
  }

  // Step 9: Dispatch capacity check (cumulative this tick)
  if (pendingDispatchThisTick + candidate.quantity > depot.dispatch_capacity_per_tick) {
    return { valid: false, failureCode: 'DISPATCH_CAPACITY_EXCEEDED', failureReason: `Dispatch limit ${depot.dispatch_capacity_per_tick}L/tick would be exceeded` };
  }

  // Step 10: Station capacity check
  const stationInventory = station.inventory[candidate.fuelType];
  const stationCapacity = station.capacity[candidate.fuelType];
  if (stationInventory + candidate.quantity > stationCapacity) {
    return { valid: false, failureCode: 'DESTINATION_CAPACITY_EXCEEDED', failureReason: `Station tank would overflow (${stationInventory}+${candidate.quantity} > ${stationCapacity})` };
  }

  return { valid: true };
}
