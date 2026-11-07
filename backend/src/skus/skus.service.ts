import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api/api-error';
import { paginate } from '../common/api/api.interceptors';
import { nullableDateToYmd } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { computeAtp } from '../allocation/allocation-engine';
import { CreateSkuDto, SkuListQueryDto, UpdateSkuDto } from './skus.dto';

/** Aggregated stock for a set of SKUs (single round-trip per measure). */
export async function stockBySku(tx: Tx, skuIds: number[]) {
  if (skuIds.length === 0) return new Map<number, { onHand: number; allocated: number; inbound: number; atp: number }>();
  const [balances, allocations, inbound] = await Promise.all([
    tx.inventoryBalance.groupBy({ by: ['skuId'], where: { skuId: { in: skuIds } }, _sum: { onHand: true } }),
    tx.allocation.groupBy({ by: ['skuId'], where: { skuId: { in: skuIds }, status: 'ACTIVE' }, _sum: { quantity: true } }),
    tx.inboundReceipt.groupBy({
      by: ['skuId'],
      where: { skuId: { in: skuIds }, status: { in: ['PLANNED', 'IN_TRANSIT'] } },
      _sum: { quantity: true },
    }),
  ]);
  const out = new Map<number, { onHand: number; allocated: number; inbound: number; atp: number }>();
  for (const id of skuIds) {
    const onHand = balances.find((b) => b.skuId === id)?._sum.onHand ?? 0;
    const allocated = allocations.find((a) => a.skuId === id)?._sum.quantity ?? 0;
    const eligibleInbound = inbound.find((i) => i.skuId === id)?._sum.quantity ?? 0;
    out.set(id, {
      onHand,
      allocated,
      inbound: eligibleInbound,
      atp: computeAtp({ onHand, eligibleInbound, allocatedDemand: allocated }),
    });
  }
  return out;
}

@Injectable()
export class SkusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SkuListQueryDto) {
    const where = query.search
      ? {
          OR: [{ skuCode: { contains: query.search.trim() } }, { name: { contains: query.search.trim() } }],
        }
      : {};
    const dir = query.dir ?? 'asc';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sku.count({ where }),
      this.prisma.sku.findMany({
        where,
        orderBy:
          query.sort === 'name'
            ? { name: dir }
            : query.sort === 'leadTime'
              ? { leadTimeDays: dir }
              : query.sort === 'createdAt'
                ? { createdAt: dir }
                : { skuCode: dir },
        // 'available' sort needs aggregated stock, so it is applied after the page of stock is loaded below
        skip: query.sort === 'available' ? 0 : (query.page - 1) * query.pageSize,
        take: query.sort === 'available' ? undefined : query.pageSize,
      }),
    ]);

    const stock = await stockBySku(this.prisma as unknown as Tx, rows.map((r) => r.id));
    let items = rows.map((r) => ({ ...toDto(r), stock: stock.get(r.id) ?? null }));
    if (query.sort === 'available') {
      items = items
        .sort((a, b) => ((a.stock?.atp ?? 0) - (b.stock?.atp ?? 0)) * (dir === 'desc' ? -1 : 1))
        .slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    }
    return paginate(items, query.page, query.pageSize, total);
  }

  async create(dto: CreateSkuDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const exists = await tx.sku.findUnique({ where: { skuCode: dto.skuCode } });
      if (exists) throw ApiError.conflict('SKU_CODE_EXISTS', `SKU code ${dto.skuCode} already exists`);
      const sku = await tx.sku.create({
        data: {
          skuCode: dto.skuCode,
          name: dto.name,
          unitOfMeasure: dto.unitOfMeasure ?? null,
          leadTimeDays: dto.leadTimeDays ?? null,
          safetyStockQty: dto.safetyStockQty ?? 10,
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Sku',
        entityId: sku.id,
        action: 'SKU_CREATED',
        newValue: toDto(sku),
      });
      return toDto(sku);
    });
  }

  async detail(id: number) {
    const sku = await this.prisma.sku.findUnique({ where: { id } });
    if (!sku) throw ApiError.notFound('Sku', id);

    return this.prisma.transact(async (tx) => {
      const [balances, allocations, receipts, lines, movements, stock] = await Promise.all([
        tx.inventoryBalance.findMany({ where: { skuId: id }, include: { location: true }, orderBy: { locationId: 'asc' } }),
        tx.allocation.findMany({ where: { skuId: id, status: 'ACTIVE' } }),
        tx.inboundReceipt.findMany({
          where: { skuId: id },
          include: { location: true },
          orderBy: [{ expectedArrivalTime: 'asc' }, { id: 'asc' }],
        }),
        tx.orderLine.findMany({
          where: { skuId: id, order: { status: { in: ['CONFIRMED', 'FULFILLING', 'DRAFT', 'SHIPPED'] } } },
          include: { order: { include: { customer: true } }, fulfillmentLocation: true },
          orderBy: [{ order: { createdAt: 'desc' } }, { lineNumber: 'asc' }],
          take: 100,
        }),
        tx.inventoryAdjustment.findMany({
          where: { skuId: id },
          include: { location: true, user: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
        }),
        stockBySku(tx, [id]),
      ]);

      const byLocation = balances.map((b) => {
        const allocatedFromOnHand = allocations
          .filter((a) => a.locationId === b.locationId && a.sourceType === 'ON_HAND')
          .reduce((s, a) => s + a.quantity, 0);
        const allocatedAll = allocations
          .filter((a) => a.locationId === b.locationId)
          .reduce((s, a) => s + a.quantity, 0);
        const inbound = receipts
          .filter((r) => r.locationId === b.locationId && (r.status === 'PLANNED' || r.status === 'IN_TRANSIT'))
          .reduce((s, r) => s + r.quantity, 0);
        return {
          balanceId: b.id,
          location: { id: b.locationId, locationCode: b.location.locationCode, name: b.location.name },
          onHand: b.onHand,
          allocated: allocatedFromOnHand,
          available: b.onHand - allocatedFromOnHand,
          incoming: inbound,
          atp: computeAtp({ onHand: b.onHand, eligibleInbound: inbound, allocatedDemand: allocatedAll }),
          updatedAt: b.updatedAt.toISOString(),
        };
      });

      return {
        sku: toDto(sku),
        totals: stock.get(id) ?? { onHand: 0, allocated: 0, inbound: 0, atp: 0 },
        byLocation,
        receipts: receipts.map((r) => ({
          id: r.id,
          receiptNumber: r.receiptNumber,
          location: r.location.locationCode,
          quantity: r.quantity,
          status: r.status,
          expectedArrivalTime: r.expectedArrivalTime.toISOString(),
        })),
        orders: lines.map((l) => ({
          lineId: l.id,
          orderId: l.orderId,
          orderNumber: l.order.orderNumber,
          customer: l.order.customer.name,
          orderStatus: l.order.status,
          priority: l.order.priority,
          requestedQty: l.requestedQty,
          shippedQty: l.shippedQty,
          allocatedQty: l.allocatedQty,
          backorderedQty: l.backorderedQty,
          requestedShipDate: nullableDateToYmd(l.order.requestedShipDate),
          promisedShipDate: nullableDateToYmd(l.manualPromisedDate ?? l.calculatedPromisedDate),
          fulfillmentLocation: l.fulfillmentLocation?.locationCode ?? null,
        })),
        movements: movements.map((m) => ({
          id: m.id,
          adjustmentNumber: m.adjustmentNumber,
          movementType: m.movementType,
          location: m.location.locationCode,
          quantityDelta: m.quantityDelta,
          previousOnHand: m.previousOnHand,
          newOnHand: m.newOnHand,
          reason: m.reason,
          user: m.user?.name ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    });
  }

  async update(id: number, dto: UpdateSkuDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const before = await tx.sku.findUnique({ where: { id } });
      if (!before) throw ApiError.notFound('Sku', id);
      if (dto.version !== undefined && dto.version !== before.version) {
        throw ApiError.conflict('VERSION_CONFLICT', 'This SKU was changed by someone else. Reload and try again.');
      }
      const data = {
        name: dto.name,
        unitOfMeasure: dto.unitOfMeasure,
        leadTimeDays: dto.leadTimeDays,
        safetyStockQty: dto.safetyStockQty,
        version: { increment: 1 },
      };
      const after = await tx.sku.update({ where: { id }, data });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Sku',
        entityId: id,
        action: 'SKU_UPDATED',
        previousValue: toDto(before),
        newValue: toDto(after),
      });
      return toDto(after);
    });
  }

  /**
   * Deletes a SKU only when nothing references it: no stock history, receipts, order lines or
   * allocations. Otherwise the SKU is referenced by history and must be kept.
   */
  async remove(id: number, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const sku = await tx.sku.findUnique({ where: { id } });
      if (!sku) throw ApiError.notFound('Sku', id);
      const [receipts, lines, adjustments, allocations] = await Promise.all([
        tx.inboundReceipt.count({ where: { skuId: id } }),
        tx.orderLine.count({ where: { skuId: id } }),
        tx.inventoryAdjustment.count({ where: { skuId: id } }),
        tx.allocation.count({ where: { skuId: id } }),
      ]);
      const references = { receipts, orderLines: lines, inventoryMovements: adjustments, allocations };
      const total = receipts + lines + adjustments + allocations;
      if (total > 0) {
        throw ApiError.conflict(
          'SKU_IN_USE',
          `SKU ${sku.skuCode} is referenced by existing records and cannot be deleted. Its history is preserved.`,
          references,
        );
      }
      await tx.inventoryBalance.deleteMany({ where: { skuId: id } });
      await tx.sku.delete({ where: { id } });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Sku',
        entityId: id,
        action: 'SKU_DELETED',
        previousValue: toDto(sku),
      });
      return { id, deleted: true };
    });
  }
}

export function toDto(s: {
  id: number;
  skuCode: string;
  name: string;
  unitOfMeasure: string | null;
  leadTimeDays: number | null;
  safetyStockQty: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    skuCode: s.skuCode,
    name: s.name,
    unitOfMeasure: s.unitOfMeasure,
    leadTimeDays: s.leadTimeDays,
    safetyStockQty: s.safetyStockQty,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

