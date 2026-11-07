import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../common/dto/page-query.dto';

export class CreateSkuDto {
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'skuCode may contain letters, digits, dot, dash and underscore' })
  skuCode!: string;

  @IsString()
  @Length(2, 255)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  @Length(1, 32)
  unitOfMeasure?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  leadTimeDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  safetyStockQty?: number;
}

export class UpdateSkuDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  version?: number;

  @IsOptional()
  @IsString()
  @Length(2, 255)
  name?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  @Length(1, 32)
  unitOfMeasure?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  leadTimeDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  safetyStockQty?: number;
}

export class SkuListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['skuCode', 'name', 'leadTime', 'available', 'createdAt'])
  sort?: 'skuCode' | 'name' | 'leadTime' | 'available' | 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}
