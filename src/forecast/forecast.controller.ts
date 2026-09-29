import { Controller, Get, Post, Query } from '@nestjs/common';
import { ForecastService, StationFuelForecast } from './forecast.service';
import { MLClient } from './ml.client';

@Controller('api/forecast')
export class ForecastController {
  constructor(
    private readonly forecastService: ForecastService,
    private readonly mlClient: MLClient,
  ) {}

  @Get()
  getAll(): StationFuelForecast[] {
    return this.forecastService.computeAll();
  }

  @Get('urgent')
  getUrgent(): StationFuelForecast[] {
    return this.forecastService.getUrgentItems();
  }

  @Get('ml/status')
  async getMLStatus() {
    const metrics = await this.mlClient.getMLMetrics();
    return {
      available: this.mlClient.getAvailability(),
      metrics,
    };
  }

  @Post('ml/retrain')
  async retrain(@Query('steps') steps?: string) {
    const numSteps = parseInt(steps ?? '300', 10);
    await this.mlClient.triggerRetrain(numSteps);
    return { status: 'retrain_triggered', steps: numSteps };
  }
}
