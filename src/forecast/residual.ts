import { DemandHistoryRow, FuelType } from '../simulator/simulator.types';
import { DemandProfile, baselineDemandPerTick } from './baseline';

export interface ResidualStats {
  correctionFactor: number; // actual / predicted mean ratio
  mape: number;             // Mean Absolute Percentage Error (0-1)
  confidence: number;       // 1 - mape, clamped 0-1
  sampleCount: number;
  rollingMean: number;
  rollingSigma: number;     // std deviation of actual demand (for Monte Carlo noise)
}

/**
 * Fit a correction factor and MAPE from recent demand history.
 * Uses last `windowSize` ticks where we have both actual and baseline.
 */
export function fitResidual(
  history: DemandHistoryRow[],
  stationId: string,
  fuelType: FuelType,
  profile: DemandProfile,
  regionId: string,
  tickMinutes: number,
  windowSize: number = 50,
): ResidualStats {
  const rows = history
    .filter(r => r.station_id === stationId && r.fuel_type === fuelType)
    .slice(-windowSize);

  if (rows.length < 3) {
    // Not enough history — return neutral correction
    return {
      correctionFactor: 1.0,
      mape: 0.3,
      confidence: 0.7,
      sampleCount: rows.length,
      rollingMean: 0,
      rollingSigma: 0,
    };
  }

  let sumRatio = 0;
  let sumAbsPct = 0;
  const actuals: number[] = [];

  for (const row of rows) {
    // Use demand_multiplier = 1 here; poller snapshot has current multiplier
    const predicted = baselineDemandPerTick(
      row.tick,
      tickMinutes,
      profile,
      fuelType,
      regionId,
      1.0, // Use 1.0 — multiplier is already baked into actual demand
    );

    if (predicted > 0) {
      sumRatio += row.demand_liters / predicted;
      sumAbsPct += Math.abs(row.demand_liters - predicted) / predicted;
    }
    actuals.push(row.demand_liters);
  }

  const correctionFactor = sumRatio / rows.length;
  const mape = Math.min(sumAbsPct / rows.length, 1.0);

  // Rolling mean and sigma for Monte Carlo noise
  const rollingMean = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  const variance =
    actuals.reduce((acc, v) => acc + Math.pow(v - rollingMean, 2), 0) / actuals.length;
  const rollingSigma = Math.sqrt(variance);

  return {
    correctionFactor: isFinite(correctionFactor) ? correctionFactor : 1.0,
    mape,
    confidence: Math.max(0, 1 - mape),
    sampleCount: rows.length,
    rollingMean,
    rollingSigma,
  };
}
