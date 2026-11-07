import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PageQueryDto } from '../common/dto/page-query.dto';

export class CreateReceiptDto {
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'receiptNumber may contain letters, digits, dot, dash and underscore' })
  receiptNumber!: string;

  @Type(() => Number)
  @IsInt()
  skuId!: number;

  @Type(() => Number)
  @IsInt()
  locationId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsISO8601({ strict: false }, { message: 'expectedArrivalTime must be an ISO date or timestamp' })
  expectedArrivalTime!: string;

  @IsOptional()
  @IsIn(['PLANNED', 'IN_TRANSIT'])
  status?: 'PLANNED' | 'IN_TRANSIT';
}

export class UpdateReceiptDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  version?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsISO8601({ strict: false })
  expectedArrivalTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;

  /** Mandatory when the expected arrival date changes. */
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

export class ReasonDto {
  @IsString()
  @IsNotEmpty({ message: 'A reason is required' })
  @Length(3, 500)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  idempotencyKey?: string;
}

export class ReceiptListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['PLANNED', 'IN_TRANSIT', 'RECEIVED', 'CANCELED'])
  status?: 'PLANNED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skuId?: number;

  @IsOptional()
  @IsIn(['expected', 'status', 'receiptNumber', 'quantity'])
  sort?: 'expected' | 'status' | 'receiptNumber' | 'quantity';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
