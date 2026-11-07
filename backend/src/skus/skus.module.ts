import { Module } from '@nestjs/common';
import { AllocationModule } from '../allocation/allocation.module';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';

@Module({ imports: [AllocationModule], controllers: [SkusController], providers: [SkusService], exports: [SkusService] })
export class SkusModule {}
