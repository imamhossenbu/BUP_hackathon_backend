export type FuelType = 'DIESEL' | 'PETROL' | 'OCTANE';

export interface FuelInventory {
  DIESEL: number;
  PETROL: number;
  OCTANE: number;
}

export interface SimulationInstance {
  id: number;
  scenario_id: string;
  scenario_version: string;
  seed: number;
  sim_time: string;
  tick: number;
  tick_minutes: number;
  status: 'PAUSED' | 'RUNNING';
}

export interface Region {
  id: string;
  name: string;
  demand_factor: number;
}

export interface Depot {
  id: string;
  name: string;
  region_id: string;
  status: 'OPEN' | 'CONSTRAINED';
  dispatch_capacity_per_tick: number;
  capacity: FuelInventory;
  inventory: FuelInventory;
}

export interface Station {
  id: string;
  name: string;
  region_id: string;
  status: 'OPEN' | 'OUTAGE';
  demand_profile: string;
  demand_multiplier: number;
  capacity: FuelInventory;
  inventory: FuelInventory;
}

export interface Route {
  id: string;
  source_depot_id: string;
  destination_station_id: string;
  transit_ticks: number;
  max_shipment: number;
  status: 'AVAILABLE' | 'DISRUPTED';
}

export interface SupplyArrival {
  id: string;
  depot_id: string;
  fuel_type: FuelType;
  quantity: number;
  planned_tick: number;
  actual_tick: number | null;
  status: 'SCHEDULED' | 'DELAYED' | 'ARRIVED';
}

export interface DomainEvent {
  id: number;
  type: string;
  start_tick: number;
  end_tick: number;
  status: 'SCHEDULED' | 'ACTIVE' | 'RESOLVED';
  parameters?: Record<string, unknown>;
}

export interface Allocation {
  id: number;
  idempotency_key: string;
  source_depot_id: string;
  destination_station_id: string;
  route_id: string;
  fuel_type: FuelType;
  quantity: number;
  created_tick: number;
  departure_tick: number | null;
  expected_arrival_tick: number | null;
  actual_arrival_tick: number | null;
  status: 'PENDING' | 'IN_TRANSIT' | 'ARRIVED' | 'FAILED' | 'CANCELLED';
  failure_reason?: string | null;
}

export interface DemandHistoryRow {
  id: number;
  station_id: string;
  fuel_type: FuelType;
  tick: number;
  sim_time: string;
  demand_liters: number;
  served_liters: number;
  unmet_liters: number;
}

export interface SimulatorMetrics {
  served_demand_liters: number;
  unmet_demand_liters: number;
  service_level: number;
  allocation_liters: number;
  allocation_failures: number;
}

export interface SimulatorSnapshot {
  instance: SimulationInstance;
  regions: Region[];
  depots: Depot[];
  stations: Station[];
  routes: Route[];
  supplyArrivals: SupplyArrival[];
  events: DomainEvent[];
  recentAllocations: Allocation[];
  recentDemand: DemandHistoryRow[];
  metrics: SimulatorMetrics;
  capturedAt: number;
  isStaleHeader: boolean;
  circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}
