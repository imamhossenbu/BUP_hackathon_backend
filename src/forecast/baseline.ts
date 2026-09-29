import { FuelType } from '../simulator/simulator.types';

export type DemandProfile = 'urban_high' | 'industrial' | 'highway' | 'regional';

// Daily demand in liters per profile and fuel type (from simulator spec)
const DAILY_DEMAND: Record<DemandProfile, Record<FuelType, number>> = {
  urban_high:  { DIESEL: 8500,  PETROL: 10500, OCTANE: 5600 },
  industrial:  { DIESEL: 14000, PETROL: 4500,  OCTANE: 2200 },
  highway:     { DIESEL: 10500, PETROL: 11000, OCTANE: 6200 },
  regional:    { DIESEL: 7200,  PETROL: 7600,  OCTANE: 3600 },
};

// Noise sigma per profile
export const PROFILE_NOISE: Record<DemandProfile, number> = {
  urban_high: 0.10,
  industrial: 0.08,
  highway:    0.12,
  regional:   0.10,
};

// Region demand factor
const REGION_FACTOR: Record<string, number> = {
  'region-dhaka':      1.00,
  'region-chattogram': 1.08,
};

/**
 * Hour-of-day demand multiplier per profile.
 * Sim time hour is derived from tick: hour = (tick * tickMinutes / 60) % 24
 */
function hourFactor(profile: DemandProfile, hour: number): number {
  switch (profile) {
    case 'industrial':
      return hour >= 6 && hour < 18 ? 1.55 : 0.45;
    case 'highway':
      return (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 20) ? 1.35 : 0.75;
    case 'urban_high':
      return (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 20) ? 1.45 : 0.70;
    case 'regional':
      return hour >= 7 && hour < 21 ? 1.25 : 0.65;
  }
}

/**
 * Baseline demand for one tick (before residual correction).
 * @param tick      current simulator tick
 * @param tickMinutes minutes per tick (15)
 * @param profile   station demand profile
 * @param fuelType  DIESEL | PETROL | OCTANE
 * @param regionId  e.g. 'region-dhaka'
 * @param demandMultiplier station.demand_multiplier (may be elevated during events)
 */
export function baselineDemandPerTick(
  tick: number,
  tickMinutes: number,
  profile: DemandProfile,
  fuelType: FuelType,
  regionId: string,
  demandMultiplier: number,
): number {
  const totalMinutesInDay = 24 * 60;
  const ticksPerDay = totalMinutesInDay / tickMinutes; // 96
  const minuteOfDay = (tick * tickMinutes) % totalMinutesInDay;
  const hourOfDay = Math.floor(minuteOfDay / 60);

  const daily = DAILY_DEMAND[profile][fuelType];
  const hf = hourFactor(profile, hourOfDay);
  const rf = REGION_FACTOR[regionId] ?? 1.0;

  return (daily * hf * rf * demandMultiplier) / ticksPerDay;
}
