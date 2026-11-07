import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { AdjustmentDto, InventoryListQueryDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get() list(@Query() q: InventoryListQueryDto) { return this.inventory.list(q); }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) { return this.inventory.detail(id); }
  @HttpCode(200) @Post('adjustments/preview') preview(@Body() dto: AdjustmentDto) { return this.inventory.preview(dto); }
  @Post('adjustments') adjust(@Body() dto: AdjustmentDto, @Actor() actor: number) { return this.inventory.adjust(dto, actor); }
}
