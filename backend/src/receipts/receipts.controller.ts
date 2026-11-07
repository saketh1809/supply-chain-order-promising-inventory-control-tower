import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { CreateReceiptDto, ReasonDto, ReceiptListQueryDto, UpdateReceiptDto } from './receipts.dto';
import { ReceiptsService } from './receipts.service';

@ApiTags('Inbound receipts')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get() list(@Query() q: ReceiptListQueryDto) { return this.receipts.list(q); }
  @Post() create(@Body() dto: CreateReceiptDto, @Actor() actor: number) { return this.receipts.create(dto, actor); }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) { return this.receipts.detail(id); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReceiptDto, @Actor() actor: number) { return this.receipts.update(id, dto, actor); }
  @HttpCode(200) @Post(':id/in-transit') inTransit(@Param('id', ParseIntPipe) id: number, @Actor() actor: number) { return this.receipts.markInTransit(id, actor); }
  @HttpCode(200) @Post(':id/receive') receive(@Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }, @Actor() actor: number) {
    return this.receipts.receive(id, actor, body?.reason);
  }
  @HttpCode(200) @Post(':id/cancel') cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto, @Actor() actor: number) { return this.receipts.cancel(id, dto, actor); }
}
