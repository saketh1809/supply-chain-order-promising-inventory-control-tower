import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { ExceptionsModule } from '../exceptions/exceptions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

@Module({
  imports: [AllocationModule, ExceptionsModule, InventoryModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
