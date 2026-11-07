import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AllocationService } from '../allocation/allocation.service';
import { computeAtp } from '../allocation/allocation-engine';
import { projectAtp } from '../allocation/atp';
import { ApiError } from '../common/api/api-error';
import { paginate } from '../common/api/api.interceptors';
import { addDaysYmd, nullableDateToYmd, todayYmd, toYmd } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { AdjustmentDto, InventoryListQueryDto } from './inventory.dto';

export type StockStatus = 'HEALTHY' | 'LOW_STOCK' | 'SHORTAGE' | 'INCOMING_ONLY' | 'OUT_OF_STOCK';

/**
 * Stock status for a SKU at a location.
 *   SHORTAGE       ATP < 0 (committed demand exceeds supply)
 *   OUT_OF_STOCK   nothing on hand and nothing inbound
 *   INCOMING_ONLY  nothing on hand yet, but receipts are inbound
 *   LOW_STOCK      ATP at or below the SKU safety stock
 *   HEALTHY        otherwise
 */
export function stockStatus(p: { onHand: number; atp: number; incoming: number; safetyStock: number }): StockStatus {
  if (p.atp < 0) return 'SHORTAGE';
  if (p.onHand === 0 && p.incoming > 0) return 'INCOMING_ONLY';
  if (p.onHand === 0) return 'OUT_OF_STOCK';
  if (p.atp <= p.safetyStock) return 'LOW_STOCK';
  return 'HEALTHY';
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: AllocationService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  /** Inventory matrix: one row per SKU x location with a balance. */
  async list(query: InventoryListQueryDto) {
    const rows = await this.matrix(this.prisma as unknown as Tx, {
      locationId: query.locationId,
      search: query.search,
    });
    let filtered = rows;
    if (query.status) filtered = filtered.filter((r) => r.status === query.status);

    const dir = query.dir === 'desc' ? -1 : 1;
    const key = query.sort ?? 'skuCode';
    filtered = [...filtered].sort((a, b) => {
      const diff =
        key === 'skuCode'
          ? a.skuCode.localeCompare(b.skuCode)
          : (a[key === 'onHand' ? 'onHand' : key === 'available' ? 'available' : 'atp'] as number) -
            (b[key === 'onHand' ? 'onHand' : key === 'available' ? 'available' : 'atp'] as number);
      return diff * dir || a.balanceId - b.balanceId;
    });

    const start = (query.page - 1) * query.pageSize;
    const summary = {
      rows: filtered.length,
      onHand: filtered.reduce((s, r) => s + r.onHand, 0),
      allocated: filtered.reduce((s, r) => s + r.allocated, 0),
      available: filtered.reduce((s, r) => s + r.available, 0),
      incoming: filtered.reduce((s, r) => s + r.incoming, 0),
      lowOrShort: filtered.filter((r) => r.status === 'LOW_STOCK' || r.status === 'SHORTAGE').length,
    };
    return {
      ...paginate(filtered.slice(start, start + query.pageSize), query.page, query.pageSize, filtered.length),
      summary,
    };
  }

  async detail(balanceId: number) {
    const bal = await this.prisma.inventoryBalance.findUnique({
      where: { id: balanceId },
      include: { sku: true, location: true },
    });
    if (!bal) throw ApiError.notFound('Inventory', balanceId);

    return this.prisma.transact(async (tx) => {
      const [allocations, receipts, ledgerRows, rowData] = await Promise.all([
        tx.allocation.findMany({
          where: { skuId: bal.skuId, locationId: bal.locationId, status: 'ACTIVE' },
          include: { orderLine: { include: { order: { include: { customer: true } } } }, receipt: true },
          orderBy: { availableDate: 'asc' },
        }),
        tx.inboundReceipt.findMany({
          where: { skuId: bal.skuId, locationId: bal.locationId, status: { in: ['PLANNED', 'IN_TRANSIT'] } },
          orderBy: { expectedArrivalTime: 'asc' },
        }),
        tx.inventoryAdjustment.findMany({
          where: { skuId: bal.skuId, locationId: bal.locationId },
          include: { user: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 200,
        }),
        this.matrix(tx, { balanceId }),
      ]);
      const row = rowData[0];
      const asOf = todayYmd();
      const allAlloc = await tx.allocation.findMany({ where: { skuId: bal.skuId, locationId: bal.locationId, status: 'ACTIVE' } });
      const projection = projectAtp({
        asOfDate: asOf,
        horizonDays: 30,
        onHand: bal.onHand,
        inbound: receipts.map((r) => ({
          date: toYmd(r.expectedArrivalTime) < asOf ? asOf : toYmd(r.expectedArrivalTime),
          quantity: r.quantity,
          reference: r.receiptNumber,
        })),
        demand: allAlloc.map((a) => ({
          date: toYmd(a.availableDate) < asOf ? asOf : toYmd(a.availableDate),
          quantity: a.quantity,
          reference: `ALLOC-${a.id}`,
        })),
      });
      return {
        balanceId: bal.id,
        sku: { id: bal.sku.id, skuCode: bal.sku.skuCode, name: bal.sku.name, safetyStockQty: bal.sku.safetyStockQty },
        location: { id: bal.location.id, locationCode: bal.location.locationCode, name: bal.location.name },
        onHand: bal.onHand,
        allocated: row.allocated,
        available: row.available,
        incoming: row.incoming,
        atp: row.atp,
        status: row.status,
        lastUpdated: bal.updatedAt.toISOString(),
        version: bal.version,
        allocations: allocations.map((a) => ({
          id: a.id,
          orderNumber: a.orderLine.order.orderNumber,
          customer: a.orderLine.order.customer.name,
          quantity: a.quantity,
          source: a.sourceType,
          receiptNumber: a.receipt?.receiptNumber ?? null,
          availableDate: toYmd(a.availableDate),
        })),
        incomingReceipts: receipts.map((r) => ({
          id: r.id,
          receiptNumber: r.receiptNumber,
          quantity: r.quantity,
          status: r.status,
          expectedArrivalTime: r.expectedArrivalTime.toISOString(),
        })),
        movements: ledgerRows.map((m) => ({
          id: m.id,
          adjustmentNumber: m.adjustmentNumber,
          movementType: m.movementType,
          quantityDelta: m.quantityDelta,
          previousOnHand: m.previousOnHand,
          newOnHand: m.newOnHand,
          reason: m.reason,
          referenceKey: m.referenceKey,
          user: m.user?.name ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
        atpProjection: projection,
      };
    });
  }

  /** Read-only preview of an adjustment: stock before/after and which order lines would move. */
  async preview(dto: AdjustmentDto) {
    await this.assertRefs(dto.skuId, dto.locationId);
    return this.prisma.transact(async (tx) => {
      const bal = await tx.inventoryBalance.findUnique({
        where: { skuId_locationId: { skuId: dto.skuId, locationId: dto.locationId } },
      });
      const previousOnHand = bal?.onHand ?? 0;
      const newOnHand = previousOnHand + dto.quantityDelta;
      const key = `${dto.skuId}:${dto.locationId}`;
      const sim = await this.allocation.simulate(tx, [dto.skuId], {
        onHandDelta: new Map([[key, dto.quantityDelta]]),
      });
      const changedLines = [...sim.after.entries()]
        .filter(([lineId, after]) => {
          const b = sim.before.get(lineId);
          return !b || b.allocatedQty !== after.allocatedQty || b.backorderedQty !== after.backorderedQty || b.effectivePromisedDate !== after.effectivePromisedDate;
        })
        .map(([lineId, after]) => {
          const b = sim.before.get(lineId);
          return {
            lineId,
            backorderedBefore: b?.backorderedQty ?? 0,
            backorderedAfter: after.backorderedQty,
            promiseBefore: b?.effectivePromisedDate ?? null,
            promiseAfter: after.effectivePromisedDate,
          };
        });
      const incoming = await tx.inboundReceipt.aggregate({
        where: { skuId: dto.skuId, locationId: dto.locationId, status: { in: ['PLANNED', 'IN_TRANSIT'] } },
        _sum: { quantity: true },
      });
      const allocatedAll = await tx.allocation.aggregate({
        where: { skuId: dto.skuId, locationId: dto.locationId, status: 'ACTIVE' },
        _sum: { quantity: true },
      });
      const allocatedOnHand = await tx.allocation.aggregate({
        where: { skuId: dto.skuId, locationId: dto.locationId, status: 'ACTIVE', sourceType: 'ON_HAND' },
        _sum: { quantity: true },
      });
      const inc = incoming._sum.quantity ?? 0;
      const alloc = allocatedAll._sum.quantity ?? 0;
      return {
        previousOnHand,
        newOnHand,
        allocatedOnHand: allocatedOnHand._sum.quantity ?? 0,
        availableBefore: previousOnHand - (allocatedOnHand._sum.quantity ?? 0),
        availableAfter: newOnHand - (allocatedOnHand._sum.quantity ?? 0),
        atpBefore: computeAtp({ onHand: previousOnHand, eligibleInbound: inc, allocatedDemand: alloc }),
        atpAfter: computeAtp({ onHand: newOnHand, eligibleInbound: inc, allocatedDemand: alloc }),
        valid: newOnHand >= 0,
        changedLines,
      };
    });
  }

  async adjust(dto: AdjustmentDto, actorId: number) {
    await this.assertRefs(dto.skuId, dto.locationId);
    return this.prisma.transact(async (tx) => {
      await this.allocation.lockSkus(tx, [dto.skuId]);
      if (dto.expectedVersion !== undefined) {
        const bal = await tx.inventoryBalance.findUnique({
          where: { skuId_locationId: { skuId: dto.skuId, locationId: dto.locationId } },
        });
        if (bal && bal.version !== dto.expectedVersion) {
          throw ApiError.conflict('VERSION_CONFLICT', 'Stock for this SKU and location changed since you opened the form. Refresh and preview again.');
        }
      }
      const posted = await this.ledger.post(tx, {
        skuId: dto.skuId,
        locationId: dto.locationId,
        delta: dto.quantityDelta,
        movementType: 'MANUAL_ADJUSTMENT',
        reason: dto.reason,
        userId: actorId,
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'InventoryAdjustment',
        entityId: posted.id,
        action: 'INVENTORY_ADJUSTED',
        previousValue: { onHand: posted.previousOnHand },
        newValue: { onHand: posted.newOnHand, quantityDelta: posted.quantityDelta },
        reason: dto.reason,
        metadata: { skuId: dto.skuId, locationId: dto.locationId, adjustmentNumber: posted.adjustmentNumber },
      });
      const recalc = await this.allocation.recalculate(tx, [dto.skuId], {
        actorId,
        reason: `Inventory adjustment ${posted.adjustmentNumber}`,
      });
      return {
        adjustmentNumber: posted.adjustmentNumber,
        previousOnHand: posted.previousOnHand,
        newOnHand: posted.newOnHand,
        quantityDelta: posted.quantityDelta,
        recalculation: {
          affectedOrders: recalc.affectedOrderIds.length,
          changedLines: recalc.changedLineIds.length,
          exceptionsCreated: recalc.exceptionsCreated,
          exceptionsResolved: recalc.exceptionsResolved,
        },
      };
    });
  }

  /** SKU x location matrix with allocation, incoming and ATP. */
  async matrix(tx: Tx, filter: { locationId?: number; balanceId?: number; search?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.balanceId) where.id = filter.balanceId;
    if (filter.search) {
      const q = filter.search.trim();
      where.sku = { OR: [{ skuCode: { contains: q } }, { name: { contains: q } }] };
    }
    const balances = await tx.inventoryBalance.findMany({
      where,
      include: { sku: true, location: true },
      orderBy: [{ sku: { skuCode: 'asc' } }, { location: { locationCode: 'asc' } }],
    });
    if (balances.length === 0) return [];

    const skuIds = [...new Set(balances.map((b) => b.skuId))];
    const locIds = [...new Set(balances.map((b) => b.locationId))];
    const [allocs, inbound] = await Promise.all([
      tx.allocation.findMany({
        where: { status: 'ACTIVE', skuId: { in: skuIds }, locationId: { in: locIds } },
        select: { skuId: true, locationId: true, sourceType: true, quantity: true },
      }),
      tx.inboundReceipt.findMany({
        where: { status: { in: ['PLANNED', 'IN_TRANSIT'] }, skuId: { in: skuIds }, locationId: { in: locIds } },
        select: { skuId: true, locationId: true, quantity: true, expectedArrivalTime: true, receiptNumber: true },
      }),
    ]);
    const asOf = todayYmd();

    return balances.map((b) => {
      const alloc = allocs.filter((a) => a.skuId === b.skuId && a.locationId === b.locationId);
      const allocatedOnHand = alloc.filter((a) => a.sourceType === 'ON_HAND').reduce((s, a) => s + a.quantity, 0);
      const allocatedAll = alloc.reduce((s, a) => s + a.quantity, 0);
      const incomingRows = inbound.filter((r) => r.skuId === b.skuId && r.locationId === b.locationId);
      const incoming = incomingRows.reduce((s, r) => s + r.quantity, 0);
      const atp = computeAtp({ onHand: b.onHand, eligibleInbound: incoming, allocatedDemand: allocatedAll });
      const available = b.onHand - allocatedOnHand;
      const status = stockStatus({ onHand: b.onHand, atp, incoming, safetyStock: b.sku.safetyStockQty });
      return {
        balanceId: b.id,
        skuId: b.skuId,
        skuCode: b.sku.skuCode,
        productName: b.sku.name,
        locationId: b.locationId,
        locationCode: b.location.locationCode,
        onHand: b.onHand,
        allocated: allocatedOnHand,
        allocatedTotal: allocatedAll,
        available,
        incoming,
        nextArrival: incomingRows.length
          ? nullableDateToYmd(incomingRows.map((r) => r.expectedArrivalTime).sort((x, y) => x.getTime() - y.getTime())[0])
          : null,
        atp,
        status,
        safetyStock: b.sku.safetyStockQty,
        lastUpdated: b.updatedAt.toISOString(),
        asOf: addDaysYmd(asOf, 0),
      };
    });
  }

  private async assertRefs(skuId: number, locationId: number) {
    const [sku, loc] = await Promise.all([
      this.prisma.sku.findUnique({ where: { id: skuId } }),
      this.prisma.location.findUnique({ where: { id: locationId } }),
    ]);
    if (!sku) throw ApiError.notFound('Sku', skuId);
    if (!loc) throw ApiError.notFound('Location', locationId);
    if (!loc.isActive) throw ApiError.badRequest('LOCATION_INACTIVE', `Location ${loc.locationCode} is inactive`);
  }
}
