import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { DecisionService } from './decision.service';

@Controller('api/recommendations')
export class DecisionController {
  constructor(private readonly decisionService: DecisionService) {}

  /** Generate and persist recommendations from current urgent forecasts */
  @Post('generate')
  async generate() {
    const recs = await this.decisionService.generateRecommendations();
    return { count: recs.length, recommendations: recs };
  }

  /** List historical decisions audit log */
  @Get('history')
  async history() {
    const history = await this.decisionService.listDecisionHistory();
    return { count: history.length, history };
  }

  /** List recent recommendations */
  @Get()
  async list() {
    const recs = await this.decisionService.listRecommendations();
    return { count: recs.length, recommendations: recs };
  }

  /** Approve: submit allocation to simulator */
  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: { operator?: string },
  ) {
    const result = await this.decisionService.approveRecommendation(id, body.operator);
    return result;
  }

  /** Reject: mark as rejected in audit log */
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: { operator?: string },
  ) {
    await this.decisionService.rejectRecommendation(id, body.operator);
    return { success: true };
  }
}
