import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { CreateSkuDto, SkuListQueryDto, UpdateSkuDto } from './skus.dto';
import { SkusService } from './skus.service';

@ApiTags('Products (SKUs)')
@Controller('skus')
export class SkusController {
  constructor(private readonly skus: SkusService) {}

  @Get() list(@Query() q: SkuListQueryDto) { return this.skus.list(q); }
  @Post() create(@Body() dto: CreateSkuDto, @Actor() actor: number) { return this.skus.create(dto, actor); }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) { return this.skus.detail(id); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSkuDto, @Actor() actor: number) { return this.skus.update(id, dto, actor); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number, @Actor() actor: number) { return this.skus.remove(id, actor); }
}
