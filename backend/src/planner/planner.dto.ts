import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Min, ValidateNested, ValidateIf } from 'class-validator';
import { ShipLineDto } from '../orders/orders.dto';

export class ExpediteReceiptDto {
  @Type(() => Number)
  @IsInt()
  receiptId!: number;

  @IsISO8601({ strict: false }, { message: 'newExpectedArrival must be a date (YYYY-MM-DD)' })
  newExpectedArrival!: string;

  @IsString()
  @Length(3, 500, { message: 'A reason is required to expedite a receipt' })
  reason!: string;
}

export class ReassignLocationDto {
  @Type(() => Number)
  @IsInt()
  orderLineId!: number;

  /** null clears the preference (engine chooses the fastest location). */
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  locationId!: number | null;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class OverridePromiseDto {
  @Type(() => Number)
  @IsInt()
  orderLineId!: number;

  /** null removes the override and returns to the calculated promise. */
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'promisedDate must be YYYY-MM-DD' })
  promisedDate!: string | null;

  @IsString()
  @Length(10, 500, { message: 'A justification of at least 10 characters is required for a manual promise override' })
  justification!: string;
}

export class SplitShipmentDto {
  @Type(() => Number)
  @IsInt()
  orderId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipLineDto)
  lines!: ShipLineDto[];

  @IsString()
  @Length(3, 500)
  reason!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  version?: number;
}

export class PreviewLineQueryDto {
  @Type(() => Number)
  @IsInt()
  orderLineId!: number;
}
