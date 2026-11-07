import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api/api-error';
import { paginate } from '../common/api/api.interceptors';
import { todayYmd, toYmd } from '../common/dates';
import { PrismaService } from '../common/prisma/prisma.service';
import { computeAtp } from './allocation-engine';
import { projectAtp } from './atp';

@Injectable()
export class AllocationQueriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** ATP per location plus a 30-day time-phased projection for one SKU. */
  async atp(skuId: number, locationId?: number) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku) throw ApiError.notFound('Sku', skuId);
    const asOf = todayYmd();
    const locs = await this.prisma.location.findMany({
      where: locationId ? { id: locationId } : { isActive: true },
      orderBy: { locationCode: 'asc' },
    });
    const [balances, allocations, receipts] = await Promise.all([
      this.prisma.inventoryBalance.findMany({ where: { skuId } }),
      this.prisma.allocation.findMany({ where: { skuId, status: 'ACTIVE' } }),
      this.prisma.inboundReceipt.findMany({ where: { skuId, status: { in: ['PLANNED', 'IN_TRANSIT'] } }, orderBy: { expectedArrivalTime: 'asc' } }),
    ]);
    const byLocation = locs.map((loc) => {
      const onHand = balances.find((b) => b.locationId === loc.id)?.onHand ?? 0;
      const allocatedOnHand = allocations.filter((a) => a.locationId === loc.id && a.sourceType === 'ON_HAND').reduce((s, a) => s + a.quantity, 0);
      const allocatedAll = allocations.filter((a) => a.locationId === loc.id).reduce((s, a) => s + a.quantity, 0);
      const incoming = receipts.filter((r) => r.locationId === loc.id).reduce((s, r) => s + r.quantity, 0);
      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        onHand,
        allocated: allocatedOnHand,
        available: onHand - allocatedOnHand,
        incoming,
        atp: computeAtp({ onHand, eligibleInbound: incoming, allocatedDemand: allocatedAll }),
        formula: `ATP = ${onHand} on-hand + ${incoming} eligible inbound − ${allocatedAll} allocated`,
      };
    });
    const totalOnHand = byLocation.reduce((s, r) => s + r.onHand, 0);
    const locSet = new Set(byLocation.map((r) => r.locationId));
    const inboundInScope = receipts.filter((r) => locSet.has(r.locationId));
    const demandInScope = allocations.filter((a) => locSet.has(a.locationId));
    const timeline = projectAtp({
      asOfDate: asOf,
      horizonDays: 30,
      onHand: totalOnHand,
      inbound: inboundInScope.map((r) => ({ date: toYmd(r.expectedArrivalTime) < asOf ? asOf : toYmd(r.expectedArrivalTime), quantity: r.quantity, reference: r.receiptNumber })),
      demand: demandInScope.map((a) => ({ date: toYmd(a.availableDate) < asOf ? asOf : toYmd(a.availableDate), quantity: a.quantity, reference: `ALLOC-${a.id}` })),
    });
    return {
      asOf,
      sku: { id: sku.id, skuCode: sku.skuCode, name: sku.name, safetyStockQty: sku.safetyStockQty },
      byLocation,
      total: {
        onHand: byLocation.reduce((s, r) => s + r.onHand, 0),
        atp: byLocation.reduce((s, r) => s + r.atp, 0),
      },
      timeline,
    };
  }

  async allocations(q: { page: number; pageSize: number; skuId?: number; orderLineId?: number; receiptId?: number; status?: 'ACTIVE' | 'RELEASED' }) {
    const where = {
      ...(q.skuId ? { skuId: q.skuId } : {}),
      ...(q.orderLineId ? { orderLineId: q.orderLineId } : {}),
      ...(q.receiptId ? { receiptId: q.receiptId } : {}),
      status: q.status ?? 'ACTIVE',
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.allocation.count({ where }),
      this.prisma.allocation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { sku: true, location: true, receipt: true, orderLine: { include: { order: true } } },
      }),
    ]);
    return paginate(
      rows.map((a) => ({
        id: a.id,
        status: a.status,
        orderNumber: a.orderLine.order.orderNumber,
        orderLineId: a.orderLineId,
        sku: a.sku.skuCode,
        location: a.location.locationCode,
        source: a.sourceType,
        receiptNumber: a.receipt?.receiptNumber ?? null,
        quantity: a.quantity,
        availableDate: toYmd(a.availableDate),
        releaseReason: a.releaseReason,
        releasedAt: a.releasedAt?.toISOString() ?? null,
        updatedAt: a.updatedAt.toISOString(),
      })),
      q.page,
      q.pageSize,
      total,
    );
  }
}
