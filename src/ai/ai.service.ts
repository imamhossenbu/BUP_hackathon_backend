import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SimulatorPoller } from '../simulator/simulator.poller';
import { ForecastService } from '../forecast/forecast.service';

export interface BriefingResponse {
  summaryBn: string;
  summaryEn: string;
  criticalAlerts: string[];
  recommendedActions: string[];
  networkHealth: 'NORMAL' | 'ELEVATED_RISK' | 'CRITICAL_CRISIS';
  timestamp: string;
  source: 'groq' | 'gemini' | 'rule_engine';
}

export interface CopilotChatResponse {
  answer: string;
  suggestedAction?: string;
  contextUsed: Record<string, unknown>;
  source: string;
}

// Lightweight in-memory log for manual allocations (not in DB, but surfaced via API)
export interface ManualAllocationLog {
  id: string;
  action: 'MANUAL_DISPATCH';
  operator: string;
  sourceDepotId: string;
  destinationStationId: string;
  fuelType: string;
  quantityL: number;
  routeId: string;
  allocationId: number | null;
  decidedAt: string;
  idempotencyKey: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private cachedBriefing: BriefingResponse | null = null;
  private cachedBriefingTimestamp = 0;
  private readonly CACHE_TTL_MS = 8000; // 8 seconds – shorter so dashboard updates faster

  // In-memory log for manual allocations (shown in history page alongside DB decisions)
  public manualAllocationLog: ManualAllocationLog[] = [];


  constructor(
    private readonly config: ConfigService,
    private readonly poller: SimulatorPoller,
    private readonly forecast: ForecastService,
  ) {}

  clearBriefingCache(): void {
    this.cachedBriefing = null;
    this.cachedBriefingTimestamp = 0;
  }

  recordManualAllocation(alloc: ManualAllocationLog): void {
    this.manualAllocationLog.unshift(alloc);
    if (this.manualAllocationLog.length > 100) {
      this.manualAllocationLog = this.manualAllocationLog.slice(0, 100);
    }
    this.clearBriefingCache();
  }

  /**
   * Generates comprehensive executive briefing with 8s cache
   * Uses fresh live data each time, tries multiple Groq models
   */
  async generateBriefing(): Promise<BriefingResponse> {
    const now = Date.now();
    if (this.cachedBriefing && now - this.cachedBriefingTimestamp < this.CACHE_TTL_MS) {
      return this.cachedBriefing;
    }

    const snapshot = this.poller.getSnapshot();
    const allForecasts = this.forecast.computeAll();

    const criticalCount = allForecasts.filter(f => f.severity === 'CRITICAL').length;
    const highCount = allForecasts.filter(f => f.severity === 'HIGH').length;

    let networkHealth: 'NORMAL' | 'ELEVATED_RISK' | 'CRITICAL_CRISIS' = 'NORMAL';
    if (criticalCount > 0) networkHealth = 'CRITICAL_CRISIS';
    else if (highCount > 0) networkHealth = 'ELEVATED_RISK';

    const contextData = {
      tick: snapshot?.instance.tick ?? 0,
      simTime: snapshot?.instance.sim_time ?? '',
      status: snapshot?.instance.status ?? 'PAUSED',
      networkHealth,
      serviceLevelPct: snapshot?.metrics.service_level ?? 0,
      totalUnmetLiters: snapshot?.metrics.unmet_demand_liters ?? 0,
      criticalStations: allForecasts.filter(f => f.severity === 'CRITICAL').map(f => ({
        station: f.stationName,
        fuel: f.fuelType,
        inventory: f.inventory,
        fillPct: `${f.fillPct}%`,
        hoursToStockout: `${f.hoursToStockout}h`,
        unmet: f.unmetSignal,
        stockoutProb: `${f.stockout.monteCarlo?.stockoutProbabilityPct ?? 0}%`,
      })),
      highRiskStations: allForecasts.filter(f => f.severity === 'HIGH').map(f => ({
        station: f.stationName,
        fuel: f.fuelType,
        hoursToStockout: `${f.hoursToStockout}h`,
      })),
      depotInventories: snapshot?.depots.map(d => ({
        name: d.name,
        status: d.status,
        inventory: d.inventory,
      })),
      inTransitCount: snapshot?.recentAllocations?.filter(a => a.status === 'IN_TRANSIT')?.length ?? 0,
    };

    // Live data-driven deterministic briefing engine — 0ms latency, zero external failure
    const briefing = this.generateRuleBasedBriefing(contextData, networkHealth, allForecasts, snapshot);
    this.cachedBriefing = briefing;
    this.cachedBriefingTimestamp = Date.now();
    return briefing;
  }

  /**
   * Interactive Operator Copilot Chat — context-aware, per-question
   */
  async chatWithCopilot(userQuestion: string): Promise<CopilotChatResponse> {
    const snapshot = this.poller.getSnapshot();
    const allForecasts = this.forecast.computeAll();

    // Build rich, specific context
    const context = {
      currentTick: snapshot?.instance.tick,
      simTime: snapshot?.instance.sim_time,
      simStatus: snapshot?.instance.status,
      serviceLevelPct: snapshot?.metrics.service_level,
      unmetLiters: snapshot?.metrics.unmet_demand_liters,
      stations: allForecasts.map(f => ({
        station: f.stationName,
        fuel: f.fuelType,
        inventory: f.inventory,
        capacity: f.capacity,
        fill: `${f.fillPct}%`,
        hoursToStockout: f.hoursToStockout,
        severity: f.severity,
        demandRate: f.demandRate,
        stockoutRisk: `${f.stockout.monteCarlo?.stockoutProbabilityPct ?? 0}%`,
        unmet: f.unmetSignal,
      })),
      depots: snapshot?.depots.map(d => ({
        depot: d.name,
        status: d.status,
        inventory: d.inventory,
        capacity: d.capacity,
      })),
      inTransitAllocations: snapshot?.recentAllocations
        ?.filter(a => a.status === 'IN_TRANSIT')
        ?.map(a => ({
          from: a.source_depot_id,
          to: a.destination_station_id,
          fuel: a.fuel_type,
          qty: a.quantity,
          arrivesAtTick: a.expected_arrival_tick,
        })) ?? [],
    };

    // Fast deterministic intelligence copilot — analyzes real-time network data directly

    // Data-driven rule-based fallback — specific to the question
    const q = userQuestion.toLowerCase();
    let fallbackAnswer: string;

    const critical = allForecasts.filter(f => f.severity === 'CRITICAL');
    const mostUrgent = allForecasts[0];

    if (q.includes('critical') || q.includes('urgent') || q.includes('worst') || q.includes('danger')) {
      fallbackAnswer = critical.length > 0
        ? `${critical.length} critical station-fuel pair(s) detected. Most urgent: ${critical[0].stationName} (${critical[0].fuelType}) — ${critical[0].inventory.toLocaleString()}L remaining, stockout in ${critical[0].hoursToStockout}h with ${critical[0].stockout.monteCarlo?.stockoutProbabilityPct ?? 0}% probability. Immediate dispatch required.`
        : `No critical stations at this time. All stations have >6h runway. Most at-risk is ${mostUrgent?.stationName} (${mostUrgent?.fuelType}) at ${mostUrgent?.fillPct}% fill.`;
    } else if (q.includes('depot') || q.includes('supply') || q.includes('stock')) {
      const depots = snapshot?.depots ?? [];
      const depotSummary = depots.map(d => `${d.name}: DIESEL ${d.inventory.DIESEL}L, PETROL ${d.inventory.PETROL}L, OCTANE ${d.inventory.OCTANE}L`).join('; ');
      fallbackAnswer = `Current depot inventory: ${depotSummary}. ${snapshot?.recentAllocations?.filter(a => a.status === 'IN_TRANSIT').length ?? 0} tanker(s) currently in transit.`;
    } else if (q.includes('service') || q.includes('performance') || q.includes('health')) {
      fallbackAnswer = `Network service level is ${((snapshot?.metrics.service_level ?? 0) * 100).toFixed(1)}%. Total unmet demand: ${(snapshot?.metrics.unmet_demand_liters ?? 0).toLocaleString()} L. Allocation failures: ${snapshot?.metrics.allocation_failures ?? 0}.`;
    } else {
      fallbackAnswer = mostUrgent
        ? `Live data shows ${allForecasts.length} monitored station-fuel pairs. Highest priority: ${mostUrgent.stationName} (${mostUrgent.fuelType}) with ${mostUrgent.inventory.toLocaleString()}L at ${mostUrgent.fillPct}% capacity, stockout in ${mostUrgent.hoursToStockout}h. Service level: ${((snapshot?.metrics.service_level ?? 0) * 100).toFixed(1)}%.`
        : 'Live data is currently being loaded. Please try again in a moment.';
    }

    return {
      answer: fallbackAnswer,
      contextUsed: context,
      source: 'rule_fallback',
    };
  }

  private generateRuleBasedBriefing(
    contextData: Record<string, unknown>,
    networkHealth: 'NORMAL' | 'ELEVATED_RISK' | 'CRITICAL_CRISIS',
    allForecasts: ReturnType<ForecastService['computeAll']>,
    snapshot: any,
  ): BriefingResponse {
    const criticals = allForecasts.filter(f => f.severity === 'CRITICAL');
    const highs = allForecasts.filter(f => f.severity === 'HIGH');
    const tick = snapshot?.instance.tick ?? 0;
    const svcLvl = ((snapshot?.metrics.service_level ?? 0) * 100).toFixed(1);
    const inTransit = snapshot?.recentAllocations?.filter((a: any) => a.status === 'IN_TRANSIT')?.length ?? 0;

    const alerts: string[] = [];
    const actions: string[] = [];
    let summaryEn: string;
    let summaryBn: string;

    if (criticals.length > 0) {
      const names = criticals.map(c => `${c.stationName} (${c.fuelType}: ${c.hoursToStockout}h)`).join(', ');
      summaryEn = `Tick ${tick}: CRITICAL state — ${criticals.length} imminent stockout(s): ${names}. Service level at ${svcLvl}%. ${inTransit} tanker(s) en route.`;
      summaryBn = `টিক ${tick}: সংকটজনক অবস্থা — ${criticals.length}টি স্টেশনে জ্বালানি ফুরিয়ে যাওয়ার তীব্র ঝুঁকি। বর্তমান সার্ভিস লেভেল ${svcLvl}%। ট্রানজিটে রয়েছে ${inTransit}টি ট্যাংকার। অনতিবিলম্বে জরুরি সাপ্লাই ছাড়পত্র প্রয়োজন।`;
      criticals.forEach(c => alerts.push(`${c.stationName} ${c.fuelType}: ${c.inventory.toLocaleString()}L at ${c.fillPct}% — stockout in ${c.hoursToStockout}h (${c.stockout.monteCarlo?.stockoutProbabilityPct ?? 0}% risk)`));
      actions.push(`Approve emergency dispatch to ${criticals[0].stationName} via Dispatch Center.`);
      if (criticals.length > 1) actions.push(`Review remaining ${criticals.length - 1} critical station(s) in Urgency Matrix.`);
    } else if (highs.length > 0) {
      summaryEn = `Tick ${tick}: Elevated risk — ${highs.length} station(s) in HIGH severity. Service level: ${svcLvl}%. Network stable but preventive action recommended within 12h.`;
      summaryBn = `টিক ${tick}: সতর্কতামূলক অবস্থা — ${highs.length}টি স্টেশনে উচ্চ ঝুঁকি। সার্ভিস লেভেল ${svcLvl}%। নেটওয়ার্ক স্থিতিশীল তবে ১২ ঘণ্টার মধ্যে প্রতিরোধমূলক ব্যবস্থা প্রয়োজন।`;
      highs.slice(0, 2).forEach(h => alerts.push(`${h.stationName} ${h.fuelType}: stockout in ${h.hoursToStockout}h`));
      actions.push('Generate AI recommendations and approve preventive dispatches.');
    } else {
      summaryEn = `Tick ${tick}: All stations NOMINAL. Service level: ${svcLvl}%. ${inTransit} tanker(s) in transit. No stockout risk detected in 24h forward window.`;
      summaryBn = `টিক ${tick}: সকল ফুয়েল স্টেশন স্বাভাবিক রয়েছে। সার্ভিস লেভেল ${svcLvl}%। ট্রানজিটে ${inTransit}টি ট্যাংকার। আগামী ২৪ ঘণ্টার মধ্যে কোনো স্টকাউটের আশঙ্কা নেই।`;
      actions.push('Continue monitoring. Step simulation forward to see projected demand changes.');
    }

    return {
      summaryBn,
      summaryEn,
      criticalAlerts: alerts,
      recommendedActions: actions,
      networkHealth,
      timestamp: new Date().toISOString(),
      source: 'rule_engine',
    };
  }
}
