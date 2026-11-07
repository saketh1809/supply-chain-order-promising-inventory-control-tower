import { Injectable } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api/api-error';
import { paginate } from '../common/api/api.interceptors';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { nullableDateToYmd } from '../common/dates';
import { PrismaService } from '../common/prisma/prisma.service';
import { computeAtp } from '../allocation/allocation-engine';

export class CreateLocationDto {
  @IsString()
  @Length(2, 32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, { message: 'locationCode may contain letters, digits, dash and underscore' })
  locationCode!: string;

  @IsString()
  @Length(2, 255)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== '')
  @IsString()
  @Length(2, 64)
  timezone?: string | null;
}

export class UpdateLocationDto {
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
  @Length(2, 64)
  timezone?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LocationListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';

  @IsOptional()
  @IsIn(['locationCode', 'name', 'available'])
  sort?: 'locationCode' | 'name' | 'available';
}

export class PreferredLocationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  locationId?: number | null;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: LocationListQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.status === 'active') where.isActive = true;
    if (query.status === 'inactive') where.isActive = false;
    if (query.search) {
      const q = query.search.trim();
      where.OR = [{ locationCode: { contains: q } }, { name: { contains: q } }];
    }
    const all = await this.prisma.location.findMany({
      where,
      orderBy: query.sort === 'name' ? { name: 'asc' } : { locationCode: 'asc' },
    });
    const availability = await this.availabilityByLocation(all.map((l) => l.id));
    const withStock = all.map((l) => ({ ...toDto(l), stock: availability.get(l.id) ?? emptyStock() }));
    if (query.sort === 'available') {
      withStock.sort((a, b) => b.stock.available - a.stock.available || a.locationCode.localeCompare(b.locationCode));
    }
    const start = (query.page - 1) * query.pageSize;
    return paginate(withStock.slice(start, start + query.pageSize), query.page, query.pageSize, withStock.length);
  }

  async create(dto: CreateLocationDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      if (await tx.location.findUnique({ where: { locationCode: dto.locationCode } })) {
        throw ApiError.conflict('LOCATION_CODE_EXISTS', `Location code ${dto.locationCode} already exists`);
      }
      const loc = await tx.location.create({
        data: { locationCode: dto.locationCode, name: dto.name, timezone: dto.timezone ?? null },
      });
      await this.audit.record(tx, { userId: actorId, entityType: 'Location', entityId: loc.id, action: 'LOCATION_CREATED', newValue: toDto(loc) });
      return toDto(loc);
    });
  }

  async update(id: number, dto: UpdateLocationDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const before = await tx.location.findUnique({ where: { id } });
      if (!before) throw ApiError.notFound('Location', id);
      if (dto.version !== undefined && dto.version !== before.version) {
        throw ApiError.conflict('VERSION_CONFLICT', 'This location was changed by someone else. Reload and try again.');
      }
      const after = await tx.location.update({
        where: { id },
        data: { name: dto.name, timezone: dto.timezone, isActive: dto.isActive, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Location',
        entityId: id,
        action: 'LOCATION_UPDATED',
        previousValue: toDto(before),
        newValue: toDto(after),
      });
      return toDto(after);
    });
  }

  async detail(id: number) {
    const loc = await this.prisma.location.findUnique({ where: { id } });
    if (!loc) throw ApiError.notFound('Location', id);
    return this.prisma.transact(async (tx) => {
      const [balances, receipts, allocations, lines] = await Promise.all([
        tx.inventoryBalance.findMany({ where: { locationId: id }, include: { sku: true }, orderBy: { sku: { skuCode: 'asc' } } }),
        tx.inboundReceipt.findMany({
          where: { locationId: id, status: { in: ['PLANNED', 'IN_TRANSIT'] } },
          include: { sku: true },
          orderBy: { expectedArrivalTime: 'asc' },
        }),
        tx.allocation.findMany({ where: { locationId: id, status: 'ACTIVE' } }),
        tx.orderLine.findMany({
          where: {
            order: { status: { in: ['DRAFT', 'CONFIRMED', 'FULFILLING'] } },
            OR: [{ fulfillmentLocationId: id }, { preferredLocationId: id }],
          },
          include: { order: { include: { customer: true } }, sku: true },
          orderBy: [{ order: { priorityRank: 'asc' } }, { order: { createdAt: 'asc' } }],
          take: 200,
        }),
      ]);

      const skuRows = balances.map((b) => {
        const alloc = allocations.filter((a) => a.skuId === b.skuId);
        const allocatedFromOnHand = alloc.filter((a) => a.sourceType === 'ON_HAND').reduce((s, a) => s + a.quantity, 0);
        const allocatedAll = alloc.reduce((s, a) => s + a.quantity, 0);
        const inbound = receipts.filter((r) => r.skuId === b.skuId).reduce((s, r) => s + r.quantity, 0);
        return {
          sku: { id: b.skuId, skuCode: b.sku.skuCode, name: b.sku.name, safetyStockQty: b.sku.safetyStockQty },
          onHand: b.onHand,
          allocated: allocatedFromOnHand,
          available: b.onHand - allocatedFromOnHand,
          incoming: inbound,
          atp: computeAtp({ onHand: b.onHand, eligibleInbound: inbound, allocatedDemand: allocatedAll }),
        };
      });

      const lowStock = skuRows.filter((r) => r.atp <= r.sku.safetyStockQty).length;
      return {
        location: toDto(loc),
        summary: {
          skuCount: skuRows.length,
          onHandTotal: skuRows.reduce((s, r) => s + r.onHand, 0),
          availableTotal: skuRows.reduce((s, r) => s + r.available, 0),
          incomingTotal: skuRows.reduce((s, r) => s + r.incoming, 0),
          lowStockSkuCount: lowStock,
          activeOrderCount: new Set(lines.map((l) => l.orderId)).size,
        },
        inventory: skuRows,
        incomingReceipts: receipts.map((r) => ({
          id: r.id,
          receiptNumber: r.receiptNumber,
          sku: r.sku.skuCode,
          quantity: r.quantity,
          status: r.status,
          expectedArrivalTime: r.expectedArrivalTime.toISOString(),
        })),
        activeOrders: lines.map((l) => ({
          lineId: l.id,
          orderId: l.orderId,
          orderNumber: l.order.orderNumber,
          customer: l.order.customer.name,
          sku: l.sku.skuCode,
          priority: l.order.priority,
          orderStatus: l.order.status,
          assignment: l.fulfillmentLocationId === id ? 'FULFILLING' : 'PREFERRED',
          openQty: l.requestedQty - l.shippedQty,
          allocatedQty: l.allocatedQty,
          backorderedQty: l.backorderedQty,
          promisedShipDate: nullableDateToYmd(l.manualPromisedDate ?? l.calculatedPromisedDate),
          requestedShipDate: nullableDateToYmd(l.order.requestedShipDate),
        })),
      };
    });
  }

  private async availabilityByLocation(locationIds: number[]) {
    const out = new Map<number, ReturnType<typeof emptyStock>>();
    if (locationIds.length === 0) return out;
    const [balances, allocations, inbound] = await Promise.all([
      this.prisma.inventoryBalance.groupBy({ by: ['locationId'], where: { locationId: { in: locationIds } }, _sum: { onHand: true } }),
      this.prisma.allocation.groupBy({
        by: ['locationId', 'sourceType'],
        where: { locationId: { in: locationIds }, status: 'ACTIVE' },
        _sum: { quantity: true },
      }),
      this.prisma.inboundReceipt.groupBy({
        by: ['locationId'],
        where: { locationId: { in: locationIds }, status: { in: ['PLANNED', 'IN_TRANSIT'] } },
        _sum: { quantity: true },
      }),
    ]);
    for (const id of locationIds) {
      const onHand = balances.find((b) => b.locationId === id)?._sum.onHand ?? 0;
      const allocatedOnHand = allocations
        .filter((a) => a.locationId === id && a.sourceType === 'ON_HAND')
        .reduce((s, a) => s + (a._sum.quantity ?? 0), 0);
      const allocatedAll = allocations.filter((a) => a.locationId === id).reduce((s, a) => s + (a._sum.quantity ?? 0), 0);
      const incoming = inbound.find((i) => i.locationId === id)?._sum.quantity ?? 0;
      out.set(id, {
        onHand,
        allocated: allocatedOnHand,
        available: onHand - allocatedOnHand,
        incoming,
        atp: computeAtp({ onHand, eligibleInbound: incoming, allocatedDemand: allocatedAll }),
      });
    }
    return out;
  }
}

function emptyStock() {
  return { onHand: 0, allocated: 0, available: 0, incoming: 0, atp: 0 };
}

export function toDto(l: {
  id: number;
  locationCode: string;
  name: string;
  timezone: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: l.id,
    locationCode: l.locationCode,
    name: l.name,
    timezone: l.timezone,
    isActive: l.isActive,
    version: l.version,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}
