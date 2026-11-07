import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../common/dto/page-query.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class OrderLineInputDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skuId?: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  skuCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  preferredLocationId?: number | null;
}

export class CreateOrderDto {
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'orderNumber may contain letters, digits, dot, dash and underscore' })
  orderNumber!: string;

  @IsString()
  @Length(2, 255)
  customerName!: string;

  @IsIn(['HIGH', 'MED', 'LOW'])
  priority!: 'HIGH' | 'MED' | 'LOW';

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_RE, { message: 'requestedShipDate must be YYYY-MM-DD' })
  requestedShipDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  preferredLocationId?: number | null;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'An order needs at least one line' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];
}

export class PreviewOrderDto {
  @IsString()
  @Length(2, 255)
  customerName!: string;

  @IsIn(['HIGH', 'MED', 'LOW'])
  priority!: 'HIGH' | 'MED' | 'LOW';

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_RE)
  requestedShipDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  preferredLocationId?: number | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];
}

export class UpdateLineDto {
  @Type(() => Number)
  @IsInt()
  lineId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  preferredLocationId?: number | null;
}

export class UpdateOrderDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  version?: number;

  @IsOptional()
  @IsIn(['HIGH', 'MED', 'LOW'])
  priority?: 'HIGH' | 'MED' | 'LOW';

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(DATE_RE)
  requestedShipDate?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 255)
  customerName?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  preferredLocationId?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  addLines?: OrderLineInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateLineDto)
  updateLines?: UpdateLineDto[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  removeLineIds?: number[];

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

export class VersionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  version?: number;
}

export class CancelOrderDto extends VersionDto {
  @IsString()
  @IsNotEmpty({ message: 'A cancellation reason is required' })
  @Length(3, 500)
  reason!: string;
}

export class ShipLineDto {
  @Type(() => Number)
  @IsInt()
  orderLineId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class ShipOrderDto extends VersionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipLineDto)
  lines!: ShipLineDto[];

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  isSplit?: boolean;
}

export class OrderListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'CONFIRMED', 'FULFILLING', 'SHIPPED', 'CANCELED'])
  status?: 'DRAFT' | 'CONFIRMED' | 'FULFILLING' | 'SHIPPED' | 'CANCELED';

  @IsOptional()
  @IsIn(['HIGH', 'MED', 'LOW'])
  priority?: 'HIGH' | 'MED' | 'LOW';

  @IsOptional()
  @IsIn(['PROMISE_DATE_AT_RISK', 'BACKORDER', 'DELAYED_INBOUND', 'CANCELED_INBOUND_DEPENDENCY', 'HIGH_PRIORITY_INSUFFICIENT_STOCK'])
  exceptionType?: string;

  @IsOptional()
  @Matches(DATE_RE)
  requestedFrom?: string;

  @IsOptional()
  @Matches(DATE_RE)
  requestedTo?: string;

  @IsOptional()
  @Matches(DATE_RE)
  promisedFrom?: string;

  @IsOptional()
  @Matches(DATE_RE)
  promisedTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsIn(['risk', 'promised', 'oldest', 'priority', 'backorder', 'requested'])
  sort?: 'risk' | 'promised' | 'oldest' | 'priority' | 'backorder' | 'requested';
}

export class TimelineQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skuId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  locationId?: number;
}

export class CommunicationDto {
  @IsString()
  @Length(3, 255)
  subject!: string;

  @IsString()
  @Length(10, 10000)
  body!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  aiInteractionId?: number;
}
