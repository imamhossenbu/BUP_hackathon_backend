import { Controller, Get, Post, Body } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AIService, BriefingResponse, CopilotChatResponse } from './ai.service';

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  question!: string;
}


@Controller('api/ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('briefing')
  async getBriefing(): Promise<BriefingResponse> {
    return this.aiService.generateBriefing();
  }

  @Post('copilot')
  async chat(@Body() body: ChatDto): Promise<CopilotChatResponse> {
    const question = body.question || 'বর্তমান পরিস্থিতি কেমন?';
    return this.aiService.chatWithCopilot(question);
  }
}
