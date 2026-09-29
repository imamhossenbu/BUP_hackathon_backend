import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface MLPredictRequest {
  station_id: string;
  fuel_type: string;
  tick: number;
  demand_multiplier?: number;
  inventory_level?: number;
  prev_demand_1?: number;
  prev_demand_3?: number;
  prev_demand_6?: number;
  rolling_mean_10?: number;
  rolling_std_10?: number;
}

export interface MLPredictResponse {
  station_id: string;
  fuel_type: string;
  tick: number;
  demand_liters: number;
  baseline_liters: number;
  model_used: string;
  mape: number;
  confidence: number;
}

export interface MLHealthResponse {
  status: string;
  global_model_loaded: boolean;
  per_station_models: number;
  metrics: Record<string, number> | null;
}

@Injectable()
export class MLClient {
  private readonly logger = new Logger(MLClient.name);
  private readonly http: AxiosInstance;
  private isAvailable = false;

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.get<string>('mlServiceUrl', 'http://ml-service:5000');
    this.http = axios.create({ baseURL, timeout: 2000 });
    this.checkHealth();
  }

  private async checkHealth(): Promise<void> {
    try {
      const res = await this.http.get<MLHealthResponse>('/health');
      this.isAvailable = res.data.status === 'ok' && res.data.global_model_loaded;
      if (this.isAvailable) {
        this.logger.log(`ML service connected — MAPE=${JSON.stringify(res.data.metrics)}`);
      } else {
        this.logger.warn('ML service reachable but model not loaded yet');
      }
    } catch {
      this.isAvailable = false;
      this.logger.warn('ML service not available — will use baseline fallback');
    }
  }

  getAvailability(): boolean {
    return this.isAvailable;
  }

  async predict(req: MLPredictRequest): Promise<MLPredictResponse | null> {
    if (!this.isAvailable) return null;
    try {
      const res = await this.http.post<MLPredictResponse>('/predict', req);
      this.isAvailable = true;
      return res.data;
    } catch (err) {
      this.isAvailable = false;
      this.logger.warn(`ML predict failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async predictBatch(reqs: MLPredictRequest[]): Promise<MLPredictResponse[]> {
    if (!this.isAvailable || reqs.length === 0) return [];
    try {
      const res = await this.http.post<{ predictions: MLPredictResponse[] }>('/predict/batch', { items: reqs });
      this.isAvailable = true;
      return res.data.predictions;
    } catch {
      this.isAvailable = false;
      return [];
    }
  }

  async getMLMetrics(): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.http.get('/metrics');
      return res.data;
    } catch {
      return null;
    }
  }

  async triggerRetrain(steps: number = 300): Promise<void> {
    const simUrl = this.config.get<string>('simulatorBaseUrl', 'http://simulator-api:8000');
    await this.http.post('/retrain', null, {
      params: { steps, simulator_url: simUrl },
    });
  }
}
