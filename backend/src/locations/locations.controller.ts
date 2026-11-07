import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { CreateLocationDto, LocationListQueryDto, LocationsService, UpdateLocationDto } from './locations.service';

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get() list(@Query() q: LocationListQueryDto) { return this.locations.list(q); }
  @Post() create(@Body() dto: CreateLocationDto, @Actor() actor: number) { return this.locations.create(dto, actor); }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) { return this.locations.detail(id); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLocationDto, @Actor() actor: number) { return this.locations.update(id, dto, actor); }
}
