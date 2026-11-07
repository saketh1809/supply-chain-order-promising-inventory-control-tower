import { Global, Module } from '@nestjs/common';
import { SequenceService } from './sequence/sequence.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [SequenceService],
  exports: [SequenceService, PrismaModule, AuditModule],
})
export class CommonModule {}
