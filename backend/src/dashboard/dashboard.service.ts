import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { computeAtp } from '../allocation/allocation-engine';
import { addDaysYmd, diffDaysYmd, nullableDateToYmd, todayYmd, toYmd } from '../common/dates';

import { PrismaService } from '../common/prisma/prisma.service';
import { stockStatus } from '../inventory/inventory.service';

const DAY = 86_400_000;

interface RecentAudit {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  user: { name: string } | null;
  reason: string | null;
  timestamp: string;
}

/** Start-of-day UTC instant for 'YYYY-MM-DD'. */
const startOf = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`).getTime();
/** End-of-day UTC instant (exclusive next day start). */
const endOf = (ymd: string) => startOf(ymd) + DAY;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Executive summary. Every number is computed from database records. "Previous period" values are
   * reconstructed from immutable timestamps (confirmedAt/shippedAt/canceledAt, ledger rows, receipt
   * timestamps), so they are exact for those measures; measures with no history are returned as null.
   */
  async summary(days = 14) {
    const today = todayYmd();
    const windowStart = startOf(addDaysYmd(today, -(days - 1)));
    const seriesDays = Array.from({ length: days }, (_, i) => addDaysYmd(today, -(days - 1) + i));

    const [orders, receipts, ledger, ledgerFirst, balances, allocations, openLines, shipLines, exceptions, activity] = await Promise.all([
      this.prisma.order.findMany({ select: { id: true, orderNumber: true, status: true, priority: true, riskLevel: true, riskRank: true, backorderedQty: true, promisedShipDate: true, requestedShipDate: true, confirmedAt: true, shippedAt: true, canceledAt: true, customer: { select: { name: true } } } }),
      this.prisma.inboundReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, quantity: true, skuId: true, locationId: true, createdAt: true, receivedAt: true, canceledAt: true, expectedArrivalTime: true, originalExpectedArrivalTime: true, sku: { select: { skuCode: true } }, location: { select: { locationCode: true } } } }),
      this.prisma.inventoryAdjustment.findMany({ where: { createdAt: { gt: new Date(windowStart) } }, select: { quantityDelta: true, createdAt: true } }),
      this.prisma.inventoryAdjustment.findMany({ select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 }),
      this.prisma.inventoryBalance.findMany({ select: { skuId: true, locationId: true, onHand: true } }),
      this.prisma.allocation.findMany({ where: { status: 'ACTIVE', sourceType: 'ON_HAND' }, select: { quantity: true } }),
      this.prisma.orderLine.findMany({ where: { canceledAt: null, order: { status: { in: ['CONFIRMED', 'FULFILLING'] } } }, select: { requestedQty: true, shippedQty: true, backorderedQty: true, calculatedPromisedDate: true, manualPromisedDate: true, orderId: true } }),
      this.prisma.shipmentLine.findMany({ where: { createdAt: { gte: new Date(startOf(addDaysYmd(today, -59))) } }, select: { onTime: true, createdAt: true, quantity: true } }),
      this.prisma.exception.findMany({ where: { status: 'OPEN' }, select: { id: true, type: true, severity: true, affectedQty: true, createdAt: true, orderId: true, order: { select: { orderNumber: true } } } }),
      this.audit.list({ page: 1, pageSize: 15 }),
    ]);

    const onHandNow = balances.reduce((s, b) => s + b.onHand, 0);
    const allocatedOnHandNow = allocations.reduce((s, a) => s + a.quantity, 0);
    const availableNow = onHandNow - allocatedOnHandNow;

    // ---- reconstructions at a point in time --------------------------------------------------
    const activeAt = (t: number) =>
      orders.filter((o) => o.confirmedAt && o.confirmedAt.getTime() <= t && (!o.shippedAt || o.shippedAt.getTime() > t) && (!o.canceledAt || o.canceledAt.getTime() > t)).length;
    const onHandAt = (t: number) => {
      const after = ledger.filter((l) => l.createdAt.getTime() > t).reduce((s, l) => s + l.quantityDelta, 0);
      return onHandNow - after;
    };
    const incomingAt = (t: number) =>
      receipts.filter((r) => r.createdAt.getTime() <= t && (!r.receivedAt || r.receivedAt.getTime() > t) && (!r.canceledAt || r.canceledAt.getTime() > t));
    const onTimeWindow = (fromYmd: string, toYmdEx: string) => {
      const rows = shipLines.filter((s) => s.createdAt.getTime() >= startOf(fromYmd) && s.createdAt.getTime() < startOf(toYmdEx));
      const total = rows.reduce((s, r) => s + r.quantity, 0);
      const onTime = rows.filter((r) => r.onTime).reduce((s, r) => s + r.quantity, 0);
      return { total, onTime, rate: total ? onTime / total : null };
    };

    const prevDay = addDaysYmd(today, -7);
    const activeNow = orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'FULFILLING');
    const atRiskNow = activeNow.filter((o) => o.riskLevel !== 'ON_TRACK');
    const onTimePromiseNow = activeNow.filter((o) => !o.requestedShipDate || (o.promisedShipDate && toYmd(o.promisedShipDate) <= toYmd(o.requestedShipDate)));
    const backorderUnits = openLines.reduce((s, l) => s + l.backorderedQty, 0);
    const incomingNow = incomingAt(Date.now());
    const incomingUnits = incomingNow.reduce((s, r) => s + r.quantity, 0);

    const ot30 = onTimeWindow(addDaysYmd(today, -29), addDaysYmd(today, 1));
    const ot30Prev = onTimeWindow(addDaysYmd(today, -59), addDaysYmd(today, -29));

    // Before the first recorded movement there is no history to reconstruct: report null, not zero.
    const firstLedgerMs = ledgerFirst.length ? ledgerFirst[0].createdAt.getTime() : Infinity;
    const firstReceiptMs = receipts.length ? Math.min(...receipts.map((r) => r.createdAt.getTime())) : Infinity;
    const trend = {
      activeOrders: seriesDays.map((d) => activeAt(endOf(d) - 1)),
      availableInventory: seriesDays.map((d) => (endOf(d) - 1 < firstLedgerMs ? null : onHandAt(endOf(d) - 1))),
      incomingReceipts: seriesDays.map((d) => (endOf(d) - 1 < firstReceiptMs ? null : incomingAt(endOf(d) - 1).reduce((s, r) => s + r.quantity, 0))),
      onTimeRate: seriesDays.map((d) => {
        const w = onTimeWindow(d, addDaysYmd(d, 1));
        return w.rate === null ? null : Math.round(w.rate * 1000) / 10;
      }),
    };

    const activeAtPrev = activeAt(endOf(prevDay) - 1);
    const onHandPrev = onHandAt(endOf(prevDay) - 1);
    const incomingPrev = incomingAt(endOf(prevDay) - 1).reduce((s, r) => s + r.quantity, 0);

    const cmp = (current: number | null, previous: number | null, unit: 'count' | 'units' | 'pct' = 'count') => ({
      current,
      previous,
      delta: current !== null && previous !== null ? current - previous : null,
      unit,
      label: 'vs 7 days ago',
    });

    // ---- sections ------------------------------------------------------------------------------
    const statusCounts = ['DRAFT', 'CONFIRMED', 'FULFILLING', 'SHIPPED', 'CANCELED'].map((s) => ({
      status: s,
      count: orders.filter((o) => o.status === s).length,
    }));
    const fulfillmentSeries = seriesDays.map((d) => {
      const w = onTimeWindow(d, addDaysYmd(d, 1));
      return { date: d, onTime: w.onTime, late: w.total - w.onTime, newOrders: orders.filter((o) => o.confirmedAt && toYmd(o.confirmedAt) === d).length, shipped: orders.filter((o) => o.shippedAt && toYmd(o.shippedAt) === d).length };
    });

    const incoming = incomingNow
      .map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        sku: r.sku.skuCode,
        location: r.location.locationCode,
        quantity: r.quantity,
        status: r.status,
        expectedArrival: toYmd(r.expectedArrivalTime),
        delayDays: diffDaysYmd(toYmd(r.originalExpectedArrivalTime), toYmd(r.expectedArrivalTime)),
      }))
      .sort((a, b) => a.expectedArrival.localeCompare(b.expectedArrival));
    const incomingTimeline = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map((i) => {
      const day = addDaysYmd(today, i);
      return { date: day, units: incoming.filter((r) => r.expectedArrival === day).reduce((s, r) => s + r.quantity, 0), receipts: incoming.filter((r) => r.expectedArrival === day).length };
    });
    const canceledRecent = receipts.filter((r) => r.canceledAt && r.canceledAt.getTime() >= Date.now() - 30 * DAY).length;
    const delayedOpen = incoming.filter((r) => r.delayDays > 0).length;

    const promiseFailures = activeNow
      .filter((o) => o.requestedShipDate && o.promisedShipDate && toYmd(o.promisedShipDate) > toYmd(o.requestedShipDate))
      .map((o) => ({ orderNumber: o.orderNumber, customer: o.customer.name, requested: toYmd(o.requestedShipDate!), promised: toYmd(o.promisedShipDate!), daysLate: diffDaysYmd(toYmd(o.requestedShipDate!), toYmd(o.promisedShipDate!)), priority: o.priority }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 8);

    const riskOrders = [...atRiskNow]
      .sort((a, b) => a.riskRank - b.riskRank || b.backorderedQty - a.backorderedQty)
      .slice(0, 8)
      .map((o) => ({ id: o.id, orderNumber: o.orderNumber, customer: o.customer.name, priority: o.priority, riskLevel: o.riskLevel, backorderedQty: o.backorderedQty, promised: nullableDateToYmd(o.promisedShipDate) }));
    const highPriorityAttention = activeNow
      .filter((o) => o.priority === 'HIGH' && o.riskLevel !== 'ON_TRACK')
      .map((o) => ({ id: o.id, orderNumber: o.orderNumber, customer: o.customer.name, riskLevel: o.riskLevel, backorderedQty: o.backorderedQty }));

    const exceptionCounts = {
      open: exceptions.length,
      bySeverity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => ({ severity: s, count: exceptions.filter((e) => e.severity === s).length })),
      byType: [...new Set(exceptions.map((e) => e.type))].map((t) => ({ type: t, count: exceptions.filter((e) => e.type === t).length })),
    };

    const sections = {
      orderFulfillment: { statusCounts, series: fulfillmentSeries, onTimeLast30: ot30, onTimePrevious30: ot30Prev },
      incomingSupply: {
        openReceipts: incoming.length,
        delayed: delayedOpen,
        canceledLast30Days: canceledRecent,
        upcoming: incoming.slice(0, 8),
        timeline: incomingTimeline,
      },
      fulfillmentRisk: { atRisk: riskOrders, highPriority: highPriorityAttention, promiseFailures, exceptions: exceptionCounts },
    };

    const kpis = {
      activeOrders: { ...cmp(activeNow.length, activeAtPrev), trend: trend.activeOrders, href: '/orders?status=active', key: 'activeOrders' },
      ordersAtRisk: { ...cmp(atRiskNow.length, null), trend: [], href: '/exceptions', key: 'ordersAtRisk', note: 'Previous-period risk is not stored historically.' },
      availableInventory: { ...cmp(availableNow, null, 'units'), onHandCurrent: onHandNow, onHandPrevious: onHandPrev, trend: trend.availableInventory, href: '/inventory', key: 'availableInventory', note: 'Trend and comparison use on-hand, reconstructed from the inventory ledger.' },
      backorderedUnits: { ...cmp(backorderUnits, null, 'units'), trend: [], href: '/exceptions?type=BACKORDER', key: 'backorderedUnits' },
      incomingReceipts: { ...cmp(incomingNow.length, incomingAt(endOf(prevDay) - 1).length), units: incomingUnits, previousUnits: incomingPrev, trend: trend.incomingReceipts, href: '/supply', key: 'incomingReceipts' },
      onTimePromiseRate: {
        current: ot30.rate === null ? null : Math.round(ot30.rate * 1000) / 10,
        previous: ot30Prev.rate === null ? null : Math.round(ot30Prev.rate * 1000) / 10,
        delta: ot30.rate !== null && ot30Prev.rate !== null ? Math.round((ot30.rate - ot30Prev.rate) * 1000) / 10 : null,
        unit: 'pct',
        label: 'shipped on time, last 30 days vs prior 30',
        promiseCompliance: activeNow.length ? Math.round((onTimePromiseNow.length / activeNow.length) * 1000) / 10 : null,
        trend: trend.onTimeRate,
        href: '/orders?sort=promised',
        key: 'onTimePromiseRate',
      },
    };

    return {
      asOf: today,
      generatedAt: new Date().toISOString(),
      kpis,
      sections,
      recentActivity: (activity.items as RecentAudit[]).map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, entityId: a.entityId, user: a.user?.name ?? 'system', reason: a.reason, timestamp: a.timestamp })),
    };
  }

  /** Per-location and per-SKU stock health from the live inventory matrix. */
  async inventoryHealth() {
    const [balances, allocs, inbound, skus] = await Promise.all([
      this.prisma.inventoryBalance.findMany({ include: { location: true, sku: true } }),
      this.prisma.allocation.findMany({ where: { status: 'ACTIVE' }, select: { skuId: true, locationId: true, sourceType: true, quantity: true } }),
      this.prisma.inboundReceipt.findMany({ where: { status: { in: ['PLANNED', 'IN_TRANSIT'] } }, select: { skuId: true, locationId: true, quantity: true } }),
      this.prisma.sku.findMany({ select: { id: true, skuCode: true, name: true, safetyStockQty: true } }),
    ]);
    const locMap = new Map<number, { locationId: number; locationCode: string; name: string; onHand: number; allocated: number; available: number; incoming: number }>();
    for (const b of balances) {
      const cur = locMap.get(b.locationId) ?? { locationId: b.locationId, locationCode: b.location.locationCode, name: b.location.name, onHand: 0, allocated: 0, available: 0, incoming: 0 };
      cur.onHand += b.onHand;
      locMap.set(b.locationId, cur);
    }
    for (const a of allocs) {
      const cur = locMap.get(a.locationId);
      if (cur && a.sourceType === 'ON_HAND') cur.allocated += a.quantity;
    }
    for (const r of inbound) {
      const cur = locMap.get(r.locationId);
      if (cur) cur.incoming += r.quantity;
    }
    const byLocation = [...locMap.values()].map((l) => ({ ...l, available: l.onHand - l.allocated })).sort((a, b) => a.locationCode.localeCompare(b.locationCode));

    const bySku = skus.map((s) => {
      const onHand = balances.filter((b) => b.skuId === s.id).reduce((t, b) => t + b.onHand, 0);
      const allocatedAll = allocs.filter((a) => a.skuId === s.id).reduce((t, a) => t + a.quantity, 0);
      const incoming = inbound.filter((r) => r.skuId === s.id).reduce((t, r) => t + r.quantity, 0);
      const available = onHand - allocs.filter((a) => a.skuId === s.id && a.sourceType === 'ON_HAND').reduce((t, a) => t + a.quantity, 0);
      const atp = computeAtp({ onHand, eligibleInbound: incoming, allocatedDemand: allocatedAll });
      return { skuId: s.id, skuCode: s.skuCode, productName: s.name, onHand, available, incoming, atp, safetyStock: s.safetyStockQty, status: stockStatus({ onHand, atp, incoming, safetyStock: s.safetyStockQty }) };
    });
    const lowStock = bySku.filter((s) => s.status === 'LOW_STOCK' || s.status === 'SHORTAGE' || s.status === 'OUT_OF_STOCK').sort((a, b) => a.atp - b.atp);
    const statusDistribution = ['HEALTHY', 'LOW_STOCK', 'SHORTAGE', 'INCOMING_ONLY', 'OUT_OF_STOCK'].map((st) => ({ status: st, count: bySku.filter((s) => s.status === st).length }));

    return {
      asOf: todayYmd(),
      totals: {
        onHand: byLocation.reduce((s, l) => s + l.onHand, 0),
        allocated: byLocation.reduce((s, l) => s + l.allocated, 0),
        available: byLocation.reduce((s, l) => s + l.available, 0),
        incoming: byLocation.reduce((s, l) => s + l.incoming, 0),
      },
      byLocation,
      lowStock,
      statusDistribution,
      skuCount: skus.length,
    };
  }

  /** Daily fulfillment trends for the last N days. */
  async fulfillmentTrends(days: number) {
    const today = todayYmd();
    const dates = Array.from({ length: days }, (_, i) => addDaysYmd(today, -(days - 1) + i));
    const since = new Date(startOf(dates[0]));
    const [lines, shippedOrders, created] = await Promise.all([
      this.prisma.shipmentLine.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, onTime: true, quantity: true } }),
      this.prisma.order.findMany({ where: { shippedAt: { gte: since } }, select: { shippedAt: true } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);
    const series = dates.map((d) => {
      const ls = lines.filter((l) => toYmd(l.createdAt) === d);
      const onTime = ls.filter((l) => l.onTime).reduce((s, l) => s + l.quantity, 0);
      const total = ls.reduce((s, l) => s + l.quantity, 0);
      return {
        date: d,
        ordersCreated: created.filter((o) => toYmd(o.createdAt) === d).length,
        ordersShipped: shippedOrders.filter((o) => o.shippedAt && toYmd(o.shippedAt) === d).length,
        unitsOnTime: onTime,
        unitsLate: total - onTime,
        onTimeRate: total ? Math.round((onTime / total) * 1000) / 10 : null,
      };
    });
    const activeNow = await this.prisma.order.count({ where: { status: { in: ['CONFIRMED', 'FULFILLING'] } } });
    return { asOf: today, days, activeOrdersNow: activeNow, series };
  }
}
