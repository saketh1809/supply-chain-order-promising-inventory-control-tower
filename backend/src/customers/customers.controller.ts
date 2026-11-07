import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { PreferredLocationDto } from '../locations/locations.service';
import { CustomersService } from './customers.service';

@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get() list(@Query('search') search?: string) { return this.customers.list(search); }

  @Patch(':id/preferred-location')
  setPreferred(@Param('id', ParseIntPipe) id: number, @Body() dto: PreferredLocationDto, @Actor() actor: number) {
    return this.customers.setPreferredLocation(id, dto, actor);
  }
}
