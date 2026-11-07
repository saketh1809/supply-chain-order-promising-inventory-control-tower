import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { AuditService } from './audit.service';

class AuditQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() userId?: number;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['timestamp']) sort?: 'timestamp';
}

@ApiTags('Audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: AuditQueryDto) {
    return this.audit.list({ page: q.page, pageSize: q.pageSize, userId: q.userId, entityType: q.entityType, entityId: q.entityId, action: q.action, from: q.from, to: q.to });
  }
}
