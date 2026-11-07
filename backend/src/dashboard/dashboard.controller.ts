import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DashboardService } from './dashboard.service';

class DaysQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(90) days?: number;
}

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary') summary(@Query() q: DaysQueryDto) { return this.dashboard.summary(q.days ?? 14); }
  @Get('inventory-health') inventoryHealth() { return this.dashboard.inventoryHealth(); }
  @Get('fulfillment-trends') trends(@Query() q: DaysQueryDto) { return this.dashboard.fulfillmentTrends(q.days ?? 14); }
}
