import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { ExceptionsModule } from '../exceptions/exceptions.module';
import { OrdersModule } from '../orders/orders.module';
import { PlannerModule } from '../planner/planner.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [AllocationModule, ExceptionsModule, OrdersModule, PlannerModule, ReceiptsModule, InventoryModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
