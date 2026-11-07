import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import {
  CancelOrderDto,
  CommunicationDto,
  CreateOrderDto,
  OrderListQueryDto,
  PreviewOrderDto,
  ShipOrderDto,
  TimelineQueryDto,
  UpdateOrderDto,
  VersionDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() list(@Query() q: OrderListQueryDto) { return this.orders.list(q); }
  @Post() create(@Body() dto: CreateOrderDto, @Actor() actor: number) { return this.orders.create(dto, actor); }
  @HttpCode(200) @Post('preview') preview(@Body() dto: PreviewOrderDto) { return this.orders.preview(dto); }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) { return this.orders.detail(id); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto, @Actor() actor: number) { return this.orders.update(id, dto, actor); }
  @HttpCode(200) @Post(':id/confirm') confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: VersionDto, @Actor() actor: number) { return this.orders.confirm(id, dto, actor); }
  @HttpCode(200) @Post(':id/cancel') cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelOrderDto, @Actor() actor: number) { return this.orders.cancel(id, dto, actor); }
  @HttpCode(200) @Post(':id/ship') ship(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipOrderDto, @Actor() actor: number) { return this.orders.ship(id, dto, actor); }
  @Get(':id/timeline') timeline(@Param('id', ParseIntPipe) id: number, @Query() q: TimelineQueryDto) { return this.orders.timeline(id, q); }
  @Get(':id/communications') communications(@Param('id', ParseIntPipe) id: number) { return this.orders.communications(id); }
  @Post(':id/communications') record(@Param('id', ParseIntPipe) id: number, @Body() dto: CommunicationDto, @Actor() actor: number) {
    return this.orders.recordCommunication(id, dto, actor);
  }
}
