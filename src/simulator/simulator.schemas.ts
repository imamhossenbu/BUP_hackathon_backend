import { z } from 'zod';

export const FuelInventorySchema = z.object({
  DIESEL: z.number(),
  PETROL: z.number(),
  OCTANE: z.number(),
});

export const SimulationInstanceSchema = z.object({
  id: z.number(),
  scenario_id: z.string(),
  scenario_version: z.string(),
  seed: z.number(),
  sim_time: z.string(),
  tick: z.number(),
  tick_minutes: z.number(),
  status: z.enum(['PAUSED', 'RUNNING']),
});

export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  demand_factor: z.number(),
});

export const DepotSchema = z.object({
  id: z.string(),
  name: z.string(),
  region_id: z.string(),
  status: z.enum(['OPEN', 'CONSTRAINED']),
  dispatch_capacity_per_tick: z.number(),
  capacity: FuelInventorySchema,
  inventory: FuelInventorySchema,
});

export const StationSchema = z.object({
  id: z.string(),
  name: z.string(),
  region_id: z.string(),
  status: z.enum(['OPEN', 'OUTAGE']),
  demand_profile: z.string(),
  demand_multiplier: z.number(),
  capacity: FuelInventorySchema,
  inventory: FuelInventorySchema,
});

export const RouteSchema = z.object({
  id: z.string(),
  source_depot_id: z.string(),
  destination_station_id: z.string(),
  transit_ticks: z.number(),
  max_shipment: z.number(),
  status: z.enum(['AVAILABLE', 'DISRUPTED']),
});

export const SupplyArrivalSchema = z.object({
  id: z.string(),
  depot_id: z.string(),
  fuel_type: z.enum(['DIESEL', 'PETROL', 'OCTANE']),
  quantity: z.number(),
  planned_tick: z.number(),
  actual_tick: z.number().nullable(),
  status: z.enum(['SCHEDULED', 'DELAYED', 'ARRIVED']),
});

export const DomainEventSchema = z.object({
  id: z.number(),
  type: z.string(),
  start_tick: z.number(),
  end_tick: z.number(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'RESOLVED']),
  parameters: z.record(z.unknown()).optional(),
});

export const AllocationSchema = z.object({
  id: z.number(),
  idempotency_key: z.string(),
  source_depot_id: z.string(),
  destination_station_id: z.string(),
  route_id: z.string(),
  fuel_type: z.enum(['DIESEL', 'PETROL', 'OCTANE']),
  quantity: z.number(),
  created_tick: z.number(),
  departure_tick: z.number().nullable(),
  expected_arrival_tick: z.number().nullable(),
  actual_arrival_tick: z.number().nullable(),
  status: z.enum(['PENDING', 'IN_TRANSIT', 'ARRIVED', 'FAILED', 'CANCELLED']),
  failure_reason: z.string().nullable().optional(),
});

export const DemandHistoryRowSchema = z.object({
  id: z.number(),
  station_id: z.string(),
  fuel_type: z.enum(['DIESEL', 'PETROL', 'OCTANE']),
  tick: z.number(),
  sim_time: z.string(),
  demand_liters: z.number(),
  served_liters: z.number(),
  unmet_liters: z.number(),
});

export const SimulatorMetricsSchema = z.object({
  served_demand_liters: z.number(),
  unmet_demand_liters: z.number(),
  service_level: z.number(),
  allocation_liters: z.number(),
  allocation_failures: z.number(),
});
