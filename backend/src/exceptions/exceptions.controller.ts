import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length } from 'class-validator';
import { Priority } from '@prisma/client';
import { Actor } from '../common/actor/actor.guard';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { ExceptionsService } from './exceptions.service';
import { ExceptionTypeName } from '../allocation/exception-rules';

class ExceptionListDto extends PageQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  @IsOptional() @IsIn(['PROMISE_DATE_AT_RISK', 'BACKORDER', 'DELAYED_INBOUND', 'CANCELED_INBOUND_DEPENDENCY', 'HIGH_PRIORITY_INSUFFICIENT_STOCK']) type?: ExceptionTypeName;
  @IsOptional() @IsIn(['HIGH', 'MED', 'LOW']) priority?: Priority;
  @IsOptional() @IsIn(['OPEN', 'RESOLVED']) status?: 'OPEN' | 'RESOLVED';
  @IsOptional() @IsIn(['risk', 'created', 'promised', 'qty']) sort?: 'risk' | 'created' | 'promised' | 'qty';
}

class ResolveDto {
  @IsString() @Length(3, 500, { message: 'Resolution note must be 3 to 500 characters' }) note!: string;
}

@ApiTags('Exceptions')
@Controller('exceptions')
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  list(@Query() q: ExceptionListDto) {
    return this.exceptions.list({
      page: q.page,
      pageSize: q.pageSize,
      search: q.search,
      severity: q.severity,
      type: q.type,
      priority: q.priority,
      status: q.status,
      sort: q.sort,
    });
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.exceptions.get(id);
  }

  @HttpCode(200) @Post(':id/resolve')
  resolve(@Param('id', ParseIntPipe) id: number, @Body() body: ResolveDto, @Actor() actor: number) {
    return this.exceptions.resolve(id, { actorId: actor, note: body.note });
  }
}
