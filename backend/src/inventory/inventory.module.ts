import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { InventoryController } from './inventory.controller';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AllocationModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryLedgerService],
  exports: [InventoryService, InventoryLedgerService],
})
export class InventoryModule {}
