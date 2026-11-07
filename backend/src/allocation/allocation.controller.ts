import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Actor } from '../common/actor/actor.guard';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiError } from '../common/api/api-error';
import { AllocationService } from './allocation.service';
import { AllocationQueriesService } from './allocation-queries.service';

class RecalculateDto {
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) skuIds?: number[];
}

class AllocationListDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() skuId?: number;
  @IsOptional() @Type(() => Number) @IsInt() orderLineId?: number;
  @IsOptional() @Type(() => Number) @IsInt() receiptId?: number;
  @IsOptional() @IsIn(['ACTIVE', 'RELEASED']) status?: 'ACTIVE' | 'RELEASED';
}

class AtpQueryDto {
  @Type(() => Number) @IsInt() skuId!: number;
  @IsOptional() @Type(() => Number) @IsInt() locationId?: number;
}

@ApiTags('Allocation & ATP')
@Controller()
export class AllocationController {
  constructor(
    private readonly allocation: AllocationService,
    private readonly queries: AllocationQueriesService,
    private readonly prisma: PrismaService,
  ) {}

  /** Recomputes allocations from persisted data for the given SKUs (or all SKUs). Idempotent. */
  @HttpCode(200) @Post('allocations/recalculate')
  async recalculate(@Body() body: RecalculateDto, @Actor() actor: number) {
    const ids = body.skuIds?.length ? body.skuIds : (await this.prisma.sku.findMany({ select: { id: true } })).map((s) => s.id);
    if (ids.length === 0) throw ApiError.badRequest('NO_SKUS', 'There are no SKUs to recalculate');
    const result = await this.prisma.transact((tx) =>
      this.allocation.recalculate(tx, ids, { actorId: actor, reason: 'Manual allocation recalculation' }),
    );
    return {
      skuCount: ids.length,
      affectedOrders: result.affectedOrderIds.length,
      changedLines: result.changedLineIds.length,
      exceptionsCreated: result.exceptionsCreated,
      exceptionsResolved: result.exceptionsResolved,
    };
  }

  @Get('allocations')
  list(@Query() q: AllocationListDto) {
    return this.queries.allocations(q);
  }

  @Get('atp')
  atp(@Query() q: AtpQueryDto) {
    return this.queries.atp(q.skuId, q.locationId);
  }
}
