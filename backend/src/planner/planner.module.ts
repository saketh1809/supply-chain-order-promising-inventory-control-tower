import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { OrdersModule } from '../orders/orders.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

@Module({
  imports: [AllocationModule, OrdersModule, ReceiptsModule],
  controllers: [PlannerController],
  providers: [PlannerService],
  exports: [PlannerService],
})
export class PlannerModule {}
