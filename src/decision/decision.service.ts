import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SimulatorPoller } from '../simulator/simulator.poller';
import { SimulatorClient } from '../simulator/simulator.client';
import { ForecastService, StationFuelForecast } from '../forecast/forecast.service';
import { policyRuleAllocation } from './policy-rule';

export interface RecommendationWithDetails {
  id: string;
  stationId: string;
  stationName: string;
  fuelType: string;
  hoursToStockout: number | null;
  currentInventory: number;
  quantityL: number;
  sourceDepotId: string | null;
  routeId: string | null;
  riskBefore: number;
  riskAfter: number;
  confidence: number;
  policy: string;
  explanation: string | null;
  inputs: Record<string, unknown>;
  chosen: Record<string, unknown>;
  alternatives: unknown[];
  createdAt: Date;
}

@Injectable()
export class DecisionService {
  private readonly logger = new Logger(DecisionService.name);
  // Track dispatch used per depot in current generation cycle
  private pendingDispatch = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly poller: SimulatorPoller,
    private readonly client: SimulatorClient,
    private readonly forecast: ForecastService,
    private readonly config: ConfigService,
  ) {}

  async generateRecommendations(): Promise<RecommendationWithDetails[]> {
    const snapshot = this.poller.getSnapshot();
    if (!snapshot) return [];

    const { depots, stations, routes } = snapshot;
    const horizonTicks = this.config.get<number>('forecastHorizonTicks', 96);

    this.pendingDispatch.clear();
    const urgentItems = this.forecast.getUrgentItems();
    const created: RecommendationWithDetails[] = [];

    for (const item of urgentItems) {
      const depotId = this.forecast.getStationDepot(item.stationId);
      const currentPending = this.pendingDispatch.get(depotId) ?? 0;

      const policyResult = policyRuleAllocation(
        item,
        depots,
        stations,
        routes,
        currentPending,
        horizonTicks,
      );

      if (!policyResult.candidate) {
        this.logger.warn(`No feasible allocation for ${item.stationId}/${item.fuelType}: ${policyResult.reason}`);
        continue;
      }

      // Simple risk estimate: ratio of forecasted demand to current inventory
      const riskBefore = item.stockout.willStockout
        ? Math.min(0.99, item.stockout.forecastedDemandTotal / (item.currentInventory + 1))
        : 0.15;
      const riskAfter = Math.max(0.05, riskBefore * (item.currentInventory / (item.currentInventory + policyResult.quantityL + 1)));

      const inputs = {
        stationId: item.stationId,
        fuelType: item.fuelType,
        currentInventory: item.currentInventory,
        hoursToStockout: item.stockout.hoursToStockout,
        demandPerTick: item.demandPerTick,
        confidence: item.residual.confidence,
      };

      const chosen = {
        sourceDepotId: policyResult.candidate.sourceDepotId,
        routeId: policyResult.candidate.routeId,
        quantityL: policyResult.quantityL,
        reason: policyResult.reason,
      };

      const rec = await this.prisma.recommendation.create({
        data: {
          inputs,
          chosen,
          alternatives: policyResult.rejectedRoutes,
          risk_before: riskBefore,
          risk_after: riskAfter,
          confidence: item.residual.confidence,
          policy: 'POLICY_A',
          explanation: null,
        },
      });

      // Update pending dispatch tracker
      this.pendingDispatch.set(depotId, currentPending + policyResult.quantityL);

      created.push({
        id: rec.id,
        stationId: item.stationId,
        stationName: item.stationName,
        fuelType: item.fuelType,
        hoursToStockout: item.stockout.hoursToStockout,
        currentInventory: item.currentInventory,
        quantityL: policyResult.quantityL,
        sourceDepotId: policyResult.candidate.sourceDepotId,
        routeId: policyResult.candidate.routeId,
        riskBefore,
        riskAfter,
        confidence: item.residual.confidence,
        policy: 'POLICY_A',
        explanation: null,
        inputs,
        chosen: chosen as Record<string, unknown>,
        alternatives: policyResult.rejectedRoutes,
        createdAt: rec.created_at,
      });
    }

    return created;
  }

  async listRecommendations(): Promise<RecommendationWithDetails[]> {
    const recs = await this.prisma.recommendation.findMany({
      orderBy: { created_at: 'desc' },
      take: 50,
      include: { decisions: { orderBy: { decided_at: 'desc' }, take: 1 } },
    });

    return recs.map(r => ({
      id: r.id,
      stationId: (r.inputs as Record<string, unknown>)['stationId'] as string,
      stationName: '',
      fuelType: (r.inputs as Record<string, unknown>)['fuelType'] as string,
      hoursToStockout: (r.inputs as Record<string, unknown>)['hoursToStockout'] as number | null,
      currentInventory: (r.inputs as Record<string, unknown>)['currentInventory'] as number,
      quantityL: (r.chosen as Record<string, unknown>)['quantityL'] as number,
      sourceDepotId: (r.chosen as Record<string, unknown>)['sourceDepotId'] as string,
      routeId: (r.chosen as Record<string, unknown>)['routeId'] as string,
      riskBefore: r.risk_before,
      riskAfter: r.risk_after,
      confidence: r.confidence,
      policy: r.policy,
      explanation: r.explanation,
      inputs: r.inputs as Record<string, unknown>,
      chosen: r.chosen as Record<string, unknown>,
      alternatives: r.alternatives as unknown[],
      createdAt: r.created_at,
    }));
  }

  async approveRecommendation(id: string, operator: string = 'operator'): Promise<{ allocationId: number | null; error?: string }> {
    const rec = await this.prisma.recommendation.findUnique({ where: { id } });
    if (!rec) return { allocationId: null, error: 'Recommendation not found' };

    const chosen = rec.chosen as Record<string, unknown>;
    const inputs = rec.inputs as Record<string, unknown>;
    const idempotencyKey = `fpp-${id.slice(0, 8)}-${Date.now()}`;

    try {
      const allocation = await this.client.createAllocation({
        idempotency_key: idempotencyKey,
        source_depot_id: chosen['sourceDepotId'] as string,
        destination_station_id: inputs['stationId'] as string,
        route_id: chosen['routeId'] as string,
        fuel_type: inputs['fuelType'] as 'DIESEL' | 'PETROL' | 'OCTANE',
        quantity: chosen['quantityL'] as number,
      });

      await this.prisma.decision.create({
        data: {
          recommendation_id: id,
          action: 'APPROVED',
          operator,
          allocation_id: allocation.id,
          idempotency_key: idempotencyKey,
          sim_response: allocation as unknown as Prisma.InputJsonValue,
        },
      });

      // Poll simulator immediately so the snapshot reflects the new allocation right away!
      await this.poller.poll();

      this.logger.log(`Approved recommendation ${id} → allocation #${allocation.id}`);
      return { allocationId: allocation.id };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Allocation submission failed for recommendation ${id}: ${msg}`);

      await this.prisma.decision.create({
        data: {
          recommendation_id: id,
          action: 'REJECTED',
          operator,
          allocation_id: null,
          idempotency_key: idempotencyKey,
          sim_response: { error: msg } as Prisma.InputJsonValue,
        },
      });

      return { allocationId: null, error: msg };
    }
  }

  async rejectRecommendation(id: string, operator: string = 'operator'): Promise<void> {
    const idempotencyKey = `fpp-${id.slice(0, 8)}-rej-${Date.now()}`;
    await this.prisma.decision.create({
      data: {
        recommendation_id: id,
        action: 'REJECTED',
        operator,
        allocation_id: null,
        idempotency_key: idempotencyKey,
        sim_response: Prisma.JsonNull,
      },
    });
  }

  async listDecisionHistory(): Promise<any[]> {
    let decisions: any[] = [];
    try {
      decisions = await this.prisma.decision.findMany({
        orderBy: { decided_at: 'desc' },
        take: 100,
        include: { recommendation: true },
      });
    } catch (e) {
      this.logger.warn(`Failed to read decisions from database, falling back to simulator history: ${e}`);
    }

    const recordedAllocationIds = new Set(
      decisions.map(d => d.allocation_id).filter(Boolean)
    );

    // Also get all allocations from simulator snapshot
    const snapshot = this.poller.getSnapshot();
    const allocations = snapshot?.recentAllocations ?? [];

    const historyItems: any[] = decisions.map((d) => ({
      id: d.id,
      recommendationId: d.recommendation_id,
      action: d.action,
      operator: d.operator,
      allocationId: d.allocation_id,
      idempotencyKey: d.idempotency_key,
      simResponse: d.sim_response,
      decidedAt: d.decided_at,
      isManual: false,
      recommendation: d.recommendation
        ? {
            id: d.recommendation.id,
            stationId: (d.recommendation.inputs as Record<string, unknown>)?.['stationId'] as string,
            fuelType: (d.recommendation.inputs as Record<string, unknown>)?.['fuelType'] as string,
            quantityL: (d.recommendation.chosen as Record<string, unknown>)?.['quantityL'] as number,
            sourceDepotId: (d.recommendation.chosen as Record<string, unknown>)?.['sourceDepotId'] as string,
            routeId: (d.recommendation.chosen as Record<string, unknown>)?.['routeId'] as string,
            riskBefore: d.recommendation.risk_before,
            riskAfter: d.recommendation.risk_after,
            policy: d.recommendation.policy,
          }
        : null,
    }));

    // Find any allocations in the simulator that are NOT recorded in Prisma (e.g. manual allocations)
    for (const alloc of allocations) {
      if (!recordedAllocationIds.has(alloc.id)) {
        const isManual = !alloc.idempotency_key?.startsWith('fpp-');
        const minutesAgo = Math.max(0, ((snapshot?.instance.tick ?? 0) - (alloc.created_tick ?? 0))) * 15;
        historyItems.push({
          id: `alloc-${alloc.id}`,
          recommendationId: null,
          action: isManual ? 'MANUAL_DISPATCH' : 'APPROVED',
          operator: 'operator',
          allocationId: alloc.id,
          idempotencyKey: alloc.idempotency_key,
          simResponse: alloc,
          decidedAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
          isManual,
          recommendation: {
            id: `alloc-rec-${alloc.id}`,
            stationId: alloc.destination_station_id,
            fuelType: alloc.fuel_type,
            quantityL: alloc.quantity,
            sourceDepotId: alloc.source_depot_id,
            routeId: alloc.route_id,
            riskBefore: 0.95,
            riskAfter: 0.05,
            policy: isManual ? 'MANUAL_DISPATCH' : 'POLICY_A',
          },
        });
      }
    }

    // Sort by decidedAt descending, or allocationId descending
    historyItems.sort((a, b) => {
      const timeDiff = new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.allocationId ?? 0) - (a.allocationId ?? 0);
    });

    return historyItems;
  }
}
