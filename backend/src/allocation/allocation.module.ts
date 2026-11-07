import { Module } from '@nestjs/common';
import { ExceptionsModule } from '../exceptions/exceptions.module';
import { AllocationController } from './allocation.controller';
import { AllocationQueriesService } from './allocation-queries.service';
import { AllocationService } from './allocation.service';

@Module({
  imports: [ExceptionsModule],
  controllers: [AllocationController],
  providers: [AllocationService, AllocationQueriesService],
  exports: [AllocationService, AllocationQueriesService],
})
export class AllocationModule {}
