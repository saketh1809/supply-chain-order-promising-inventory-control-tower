import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, IsArray, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Actor } from '../common/actor/actor.guard';
import { AiService } from './ai.service';

class PlannerNoteDto {
  @IsString() @Length(10, 4000, { message: 'Describe the change in at least 10 characters' }) note!: string;
}
class ApproveDto {
  @IsOptional() @IsArray() @IsString({ each: true }) actionIds?: string[];
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}
class RejectDto {
  @IsString() @Length(3, 500, { message: 'A rejection reason is required' }) reason!: string;
}
class CustomerCommDto {
  @Type(() => Number) @IsInt() @Min(1) orderId!: number;
  @IsOptional() @IsIn(['formal', 'friendly']) tone?: 'formal' | 'friendly';
}
class ExceptionSummaryDto {
  @Type(() => Number) @IsInt() @Min(1) exceptionId!: number;
}

@ApiTags('AI assistant')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('planner-note') plannerNote(@Body() dto: PlannerNoteDto, @Actor() actor: number) { return this.ai.plannerNote(dto.note, actor); }
  @HttpCode(200) @Post('planner-note/:id/approve') approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveDto, @Actor() actor: number) {
    return this.ai.approvePlannerNote(id, dto, actor);
  }
  @HttpCode(200) @Post('planner-note/:id/reject') reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto, @Actor() actor: number) {
    return this.ai.rejectPlannerNote(id, dto.reason, actor);
  }
  @Post('customer-communication') communication(@Body() dto: CustomerCommDto, @Actor() actor: number) {
    return this.ai.customerCommunication(dto.orderId, actor, dto.tone ?? 'formal');
  }
  @Post('exception-summary') summary(@Body() dto: ExceptionSummaryDto, @Actor() actor: number) {
    return this.ai.exceptionSummary(dto.exceptionId, actor);
  }
  @Get('shortage-insights') shortage() { return this.ai.shortageInsights(); }
  @Get('interactions') interactions(@Query('type') type?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.ai.interactions({ type, status, limit: Math.min(200, Number(limit ?? 50)) });
  }
}
