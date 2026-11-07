import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { CustomersController } from '../customers/customers.controller';
import { CustomersService } from '../customers/customers.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [AllocationModule],
  controllers: [LocationsController, CustomersController],
  providers: [LocationsService, CustomersService],
  exports: [LocationsService, CustomersService],
})
export class LocationsModule {}
