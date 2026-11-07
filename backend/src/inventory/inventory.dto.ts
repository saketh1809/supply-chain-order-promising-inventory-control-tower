import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, NotEquals } from 'class-validator';
import { PageQueryDto } from '../common/dto/page-query.dto';

export class AdjustmentDto {
  @Type(() => Number)
  @IsInt()
  skuId!: number;

  @Type(() => Number)
  @IsInt()
  locationId!: number;

  /** Positive increases on-hand, negative decreases it. Zero is rejected. */
  @Type(() => Number)
  @IsInt()
  @NotEquals(0, { message: 'quantityDelta must not be zero' })
  quantityDelta!: number;

  @IsString()
  @IsNotEmpty({ message: 'A reason is required for every inventory adjustment' })
  @Length(5, 500, { message: 'reason must be between 5 and 500 characters' })
  reason!: string;

  /** Optional optimistic-concurrency guard: the balance version the planner based the change on. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;
}

export class InventoryListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsIn(['HEALTHY', 'LOW_STOCK', 'SHORTAGE', 'INCOMING_ONLY', 'OUT_OF_STOCK'])
  status?: 'HEALTHY' | 'LOW_STOCK' | 'SHORTAGE' | 'INCOMING_ONLY' | 'OUT_OF_STOCK';

  @IsOptional()
  @IsIn(['onHand', 'available', 'atp', 'skuCode'])
  sort?: 'onHand' | 'available' | 'atp' | 'skuCode';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}
