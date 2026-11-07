/**
 * Allocation service: the bridge between the pure engine and the database.
 *
 * Guarantees
 *  - Recalculation always recomputes from persisted source records (balances, eligible receipts,
 *    confirmed order lines), never from client-supplied numbers.
 *  - SKU rows are locked (SELECT ... FOR UPDATE, ascending id) before reading, so concurrent
 *    writers for the same SKU are serialized and no unit can be allocated twice.
 *  - Allocations are reconciled by diff: unchanged allocations are left alone, stale ones are
 *    RELEASED (kept for history), changed ones are updated, new ones inserted. Re-running on the
 *    same data is a no-op ("repeat execution" guarantee).
 *  - `simulate` runs the identical engine on an in-memory modified snapshot and never writes.
 */
import { Injectable } from '@nestjs/common';
import { AllocationStatus, Prisma, RiskLevel } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { nullableDateToYmd, todayYmd, toYmd, ymdToDate } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { ExceptionsService, EXCEPTION_PRIORITY_RANK, LineMeta } from '../exceptions/exceptions.service';
import {
  AllocationPiece,
  DemandLine,
  EngineInput,
  LineAllocationResult,
  SupplySource,
  runAllocationEngine,
} from './allocation-engine';
import { DesiredException, evaluateLineExceptions, InboundDependency, LineFacts } from './exception-rules';

const ACTIVE_ORDER_STATUSES = ['CONFIRMED', 'FULFILLING'] as const;

/** Hypothetical changes applied only inside a simulation. */
export interface SimOverrides {
  /** receiptId -> new expected arrival */
  receiptArrival?: Map<number, Date>;
  /** receipts treated as canceled (excluded from supply) */
  canceledReceiptIds?: Set<number>;
  /** lineId -> new preferred location (null clears) */
  lineLocation?: Map<number, number | null>;
  /** lineId -> new open quantity */
  lineOpenQty?: Map<number, number>;
  /** orders treated as canceled */
  canceledOrderIds?: Set<number>;
  /** "skuId:locationId" -> on-hand delta */
  onHandDelta?: Map<string, number>;
  /** Extra demand, e.g. a draft order being previewed (negative lineIds). */
  extraDemands?: Array<{
    lineId: number;
    skuId: number;
    orderNumber: string;
    priority: DemandLine['priority'];
    orderCreatedAt: string;
    openQty: number;
    preferredLocationId: number | null;
  }>;
}

export interface LineSummary {
  lineId: number;
  allocatedQty: number;
  backorderedQty: number;
  allocationStatus: LineAllocationResult['allocationStatus'];
  calculatedPromisedDate: string | null;
  effectivePromisedDate: string | null;
  earliestShipDate: string | null;
  fulfillmentLocationId: number | null;
  fulfillmentLocationCode: string | null;
  allocations: Array<{ locationCode: string; kind: string; receiptNumber: string | null; quantity: number; availableDate: string }>;
}

export interface RecalcResult {
  affectedOrderIds: number[];
  changedLineIds: number[];
  exceptionsCreated: number;
  exceptionsResolved: number;
}

interface LoadedLine {
  id: number;
  orderId: number;
  skuId: number;
  lineNumber: number;
  requestedQty: number;
  shippedQty: number;
  linePreferredLocationId: number | null;
  manualPromisedDate: Date | null;
  canceledAt: Date | null;
  allocatedQty: number;
  backorderedQty: number;
  allocationStatus: string;
  calculatedPromisedDate: Date | null;
  earliestShipDate: Date | null;
  expectedCompletionDate: Date | null;
  fulfillmentLocationId: number | null;
  order: {
    id: number;
    orderNumber: string;
    status: string;
    priority: 'HIGH' | 'MED' | 'LOW';
    createdAt: Date;
    requestedShipDate: Date | null;
    preferredLocationId: number | null;
    customer: { preferredLocationId: number | null };
    canceledAt: Date | null;
  };
}

interface SkuSnapshot {
  skuId: number;
  skuCode: string;
  leadTimeDays: number | null;
  lines: LoadedLine[];
  input: EngineInput;
}

@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exceptions: ExceptionsService,
  ) {}

  /** Locks SKU rows in ascending id order. Must be called first inside any mutating transaction. */
  async lockSkus(tx: Tx, skuIds: number[]): Promise<number[]> {
    const ids = [...new Set(skuIds)].sort((a, b) => a - b);
    if (ids.length === 0) return ids;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM Sku WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    return ids;
  }

  /**
   * Recomputes allocations for the given SKUs and persists the differences. Must run inside a
   * transaction that has already locked the SKUs (see lockSkus). Idempotent.
   */
  async recalculate(tx: Tx, skuIds: number[], ctx: { actorId: number | null; reason: string }): Promise<RecalcResult> {
    const ids = await this.lockSkus(tx, skuIds);
    if (ids.length === 0) {
      return { affectedOrderIds: [], changedLineIds: [], exceptionsCreated: 0, exceptionsResolved: 0 };
    }
    const now = new Date();
    const asOf = todayYmd(now);
    const snapshots = await this.buildSnapshots(tx, ids, {}, asOf);

    const changedLineIds: number[] = [];
    const affectedOrderIds = new Set<number>();
    const desiredByLine = new Map<number, DesiredException[]>();
    const lineMeta = new Map<number, LineMeta>();
    const allLineIds: number[] = [];

    for (const snap of snapshots.values()) {
      const result = runAllocationEngine(snap.input);
      const byLine = new Map(result.lines.map((r) => [r.lineId, r]));

      // ---- 1. reconcile allocation rows -----------------------------------------------------
      await this.reconcileAllocations(tx, snap.skuId, result.lines, ctx, now);

      // ---- 2. reconcile the derived fields on each order line ------------------------------
      for (const line of snap.lines) {
        affectedOrderIds.add(line.orderId);
        allLineIds.push(line.id);
        const r = byLine.get(line.id);
        const target = r && isEngineLineActive(line) ? r : null;
        const fields = target
          ? {
              allocatedQty: target.allocatedQty,
              backorderedQty: target.backorderedQty,
              allocationStatus: target.allocationStatus as AllocationStatus,
              calculatedPromisedDate: target.calculatedPromisedDate ? ymdToDate(target.calculatedPromisedDate) : null,
              earliestShipDate: target.earliestShipDate ? ymdToDate(target.earliestShipDate) : null,
              expectedCompletionDate: target.calculatedPromisedDate ? ymdToDate(target.calculatedPromisedDate) : null,
              fulfillmentLocationId: target.fulfillmentLocationId,
            }
          : {
              allocatedQty: 0,
              backorderedQty: 0,
              allocationStatus: idleAllocationStatus(line),
              calculatedPromisedDate: null,
              earliestShipDate: null,
              expectedCompletionDate: null,
              fulfillmentLocationId: null,
            };
        const before = {
          allocatedQty: line.allocatedQty,
          backorderedQty: line.backorderedQty,
          allocationStatus: line.allocationStatus,
          calculatedPromisedDate: nullableDateToYmd(line.calculatedPromisedDate),
          earliestShipDate: nullableDateToYmd(line.earliestShipDate),
          fulfillmentLocationId: line.fulfillmentLocationId,
        };
        const after = {
          allocatedQty: fields.allocatedQty,
          backorderedQty: fields.backorderedQty,
          allocationStatus: fields.allocationStatus,
          calculatedPromisedDate: nullableDateToYmd(fields.calculatedPromisedDate),
          earliestShipDate: nullableDateToYmd(fields.earliestShipDate),
          fulfillmentLocationId: fields.fulfillmentLocationId,
        };
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          await tx.orderLine.update({
            where: { id: line.id },
            data: fields,
          });
          changedLineIds.push(line.id);
          await this.audit.record(tx, {
            userId: ctx.actorId,
            entityType: 'OrderLine',
            entityId: line.id,
            action: 'ALLOCATION_RECALCULATED',
            previousValue: before,
            newValue: after,
            reason: ctx.reason,
            metadata: { orderId: line.orderId, orderNumber: line.order.orderNumber, skuId: line.skuId },
          });
        }

        lineMeta.set(line.id, {
          orderId: line.orderId,
          skuId: line.skuId,
          priority: line.order.priority,
          requestedShipDate: nullableDateToYmd(line.order.requestedShipDate),
        });

        // ---- 3. exception facts for this line -----------------------------------------------
        const effective = nullableDateToYmd(line.manualPromisedDate) ?? after.calculatedPromisedDate;
        const openQty = line.requestedQty - line.shippedQty;
        const isActive = isEngineLineActive(line) && openQty > 0;
        const facts: LineFacts = {
          lineId: line.id,
          priority: line.order.priority,
          isActive,
          openQty,
          backorderedQty: after.backorderedQty,
          requestedShipDate: nullableDateToYmd(line.order.requestedShipDate),
          effectivePromisedDate: effective,
          skuCode: snap.skuCode,
          unusedInbound: [],
          inboundDependencies: [],
        };
        if (isActive && target) {
          facts.inboundDependencies = await this.inboundDependencies(tx, target.allocations);
        }
        desiredByLine.set(line.id, evaluateLineExceptions(facts));
      }
    }

    // ---- 4. exceptions -------------------------------------------------------------------------
    const exceptionResult = await this.exceptions.reconcile(tx, {
      lineIds: allLineIds,
      lineMeta,
      desiredByLine,
      actorId: ctx.actorId,
    });

    // ---- 5. order-level derived fields ---------------------------------------------------------
    await this.refreshOrderAggregates(tx, [...affectedOrderIds]);

    return {
      affectedOrderIds: [...affectedOrderIds].sort((a, b) => a - b),
      changedLineIds,
      exceptionsCreated: exceptionResult.created,
      exceptionsResolved: exceptionResult.resolved,
    };
  }

  /**
   * What-if: runs the engine on the current snapshot ("before") and on the snapshot with the
   * overrides applied ("after"). Never writes.
   */
  async simulate(
    tx: Tx,
    skuIds: number[],
    overrides: SimOverrides,
  ): Promise<{ before: Map<number, LineSummary>; after: Map<number, LineSummary>; skuIds: number[] }> {
    const ids = [...new Set(skuIds)].sort((a, b) => a - b);
    const asOf = todayYmd();
    const beforeSnaps = await this.buildSnapshots(tx, ids, {}, asOf);
    const afterSnaps = await this.buildSnapshots(tx, ids, overrides, asOf);
    const before = new Map<number, LineSummary>();
    const after = new Map<number, LineSummary>();
    const locationCodes = await this.locationCodeMap(tx);

    for (const snap of beforeSnaps.values()) {
      for (const r of runAllocationEngine(snap.input).lines) {
        const line = snap.lines.find((l) => l.id === r.lineId);
        if (line) before.set(r.lineId, toSummary(r, line, locationCodes));
      }
    }
    for (const snap of afterSnaps.values()) {
      for (const r of runAllocationEngine(snap.input).lines) {
        const line = snap.lines.find((l) => l.id === r.lineId);
        const extra = overrides.extraDemands?.find((d) => d.lineId === r.lineId);
        if (line) after.set(r.lineId, toSummary(r, line, locationCodes));
        else if (extra) after.set(r.lineId, toSummaryVirtual(r, locationCodes));
      }
    }
    return { before, after, skuIds: ids };
  }

  /** Persisted summary of the current allocation state for the given lines. */
  async lineSummaries(tx: Tx, lineIds: number[]): Promise<Map<number, LineSummary>> {
    const rows = await tx.orderLine.findMany({
      where: { id: { in: lineIds } },
      include: {
        fulfillmentLocation: true,
        allocations: { where: { status: 'ACTIVE' }, include: { location: true, receipt: true } },
      },
    });
    return new Map(
      rows.map((l) => {
        const effective = nullableDateToYmd(l.manualPromisedDate) ?? nullableDateToYmd(l.calculatedPromisedDate);
        return [
          l.id,
          {
            lineId: l.id,
            allocatedQty: l.allocatedQty,
            backorderedQty: l.backorderedQty,
            allocationStatus: l.allocationStatus as LineSummary['allocationStatus'],
            calculatedPromisedDate: nullableDateToYmd(l.calculatedPromisedDate),
            effectivePromisedDate: effective,
            earliestShipDate: nullableDateToYmd(l.earliestShipDate),
            fulfillmentLocationId: l.fulfillmentLocationId,
            fulfillmentLocationCode: l.fulfillmentLocation?.locationCode ?? null,
            allocations: l.allocations.map((a) => ({
              locationCode: a.location.locationCode,
              kind: a.sourceType,
              receiptNumber: a.receipt?.receiptNumber ?? null,
              quantity: a.quantity,
              availableDate: toYmd(a.availableDate),
            })),
          },
        ];
      }),
    );
  }

  // ---- snapshot loading ------------------------------------------------------------------------

  private async buildSnapshots(
    tx: Tx,
    skuIds: number[],
    overrides: SimOverrides,
    asOf: string,
  ): Promise<Map<number, SkuSnapshot>> {
    if (skuIds.length === 0) return new Map();

    const [skus, balances, receipts, lines] = await Promise.all([
      tx.sku.findMany({ where: { id: { in: skuIds } } }),
      tx.inventoryBalance.findMany({ where: { skuId: { in: skuIds } }, include: { location: true } }),
      tx.inboundReceipt.findMany({
        where: { skuId: { in: skuIds }, status: { in: ['PLANNED', 'IN_TRANSIT'] } },
        include: { location: true },
      }),
      tx.orderLine.findMany({
        where: { skuId: { in: skuIds } },
        include: { order: { include: { customer: true } } },
        orderBy: [{ orderId: 'asc' }, { lineNumber: 'asc' }],
      }),
    ]);

    const snapshots = new Map<number, SkuSnapshot>();
    for (const sku of skus) {
      snapshots.set(sku.id, {
        skuId: sku.id,
        skuCode: sku.skuCode,
        leadTimeDays: sku.leadTimeDays,
        lines: [],
        input: { asOfDate: asOf, leadTimeDays: sku.leadTimeDays, supplies: [], demands: [] },
      });
    }

    // On-hand supply, adjusted by any simulated on-hand deltas.
    const seenOnHand = new Set<string>();
    for (const b of balances) {
      const k = `${b.skuId}:${b.locationId}`;
      seenOnHand.add(k);
      const onHand = b.onHand + (overrides.onHandDelta?.get(k) ?? 0);
      if (onHand <= 0) continue;
      snapshots.get(b.skuId)?.input.supplies.push({
        key: `ON_HAND:${b.locationId}`,
        kind: 'ON_HAND',
        locationId: b.locationId,
        locationCode: b.location.locationCode,
        receiptId: null,
        receiptNumber: null,
        availableDate: asOf,
        quantity: onHand,
      } satisfies SupplySource);
    }
    // Simulated on-hand for a location with no balance row yet (rare: a simulated receipt is not on-hand).
    for (const [k, delta] of overrides.onHandDelta ?? []) {
      if (seenOnHand.has(k) || delta <= 0) continue;
      const [skuId, locationId] = k.split(':').map(Number);
      const loc = await tx.location.findUnique({ where: { id: locationId } });
      if (loc) {
        snapshots.get(skuId)?.input.supplies.push({
          key: `ON_HAND:${locationId}`,
          kind: 'ON_HAND',
          locationId,
          locationCode: loc.locationCode,
          receiptId: null,
          receiptNumber: null,
          availableDate: asOf,
          quantity: delta,
        });
      }
    }

    // Inbound supply: only PLANNED / IN_TRANSIT receipts, never RECEIVED or CANCELED.
    for (const r of receipts) {
      if (overrides.canceledReceiptIds?.has(r.id)) continue;
      const arrival = overrides.receiptArrival?.get(r.id) ?? r.expectedArrivalTime;
      snapshots.get(r.skuId)?.input.supplies.push({
        key: `INBOUND:${r.id}`,
        kind: 'INBOUND',
        locationId: r.locationId,
        locationCode: r.location.locationCode,
        receiptId: r.id,
        receiptNumber: r.receiptNumber,
        availableDate: toYmd(arrival),
        quantity: r.quantity,
      } satisfies SupplySource);
    }

    // Demand: confirmed/fulfilling order lines with open quantity.
    for (const l of lines) {
      const snap = snapshots.get(l.skuId);
      if (!snap) continue;
      const loaded: LoadedLine = {
        id: l.id,
        orderId: l.orderId,
        skuId: l.skuId,
        lineNumber: l.lineNumber,
        requestedQty: l.requestedQty,
        shippedQty: l.shippedQty,
        linePreferredLocationId: l.preferredLocationId,
        manualPromisedDate: l.manualPromisedDate,
        canceledAt: l.canceledAt,
        allocatedQty: l.allocatedQty,
        backorderedQty: l.backorderedQty,
        allocationStatus: l.allocationStatus,
        calculatedPromisedDate: l.calculatedPromisedDate,
        earliestShipDate: l.earliestShipDate,
        expectedCompletionDate: l.expectedCompletionDate,
        fulfillmentLocationId: l.fulfillmentLocationId,
        order: {
          id: l.order.id,
          orderNumber: l.order.orderNumber,
          status: l.order.status,
          priority: l.order.priority,
          createdAt: l.order.createdAt,
          requestedShipDate: l.order.requestedShipDate,
          preferredLocationId: l.order.preferredLocationId,
          customer: { preferredLocationId: l.order.customer.preferredLocationId },
          canceledAt: l.order.canceledAt,
        },
      };
      snap.lines.push(loaded);

      const openQty = (overrides.lineOpenQty?.get(l.id) ?? l.requestedQty - l.shippedQty) as number;
      const orderCanceled = overrides.canceledOrderIds?.has(l.orderId) ?? false;
      if (!isEngineLineActiveFromParts(l.order.status, l.canceledAt, orderCanceled) || openQty <= 0) continue;
      const preferred =
        overrides.lineLocation?.has(l.id)
          ? (overrides.lineLocation.get(l.id) as number | null)
          : (l.preferredLocationId ?? l.order.preferredLocationId ?? l.order.customer.preferredLocationId ?? null);
      snap.input.demands.push({
        lineId: l.id,
        orderId: l.orderId,
        orderNumber: l.order.orderNumber,
        priority: l.order.priority,
        orderCreatedAt: l.order.createdAt.toISOString(),
        lineNumber: l.lineNumber,
        openQty,
        preferredLocationId: preferred,
      } satisfies DemandLine);
    }

    // Extra (virtual) demand for order previews.
    for (const d of overrides.extraDemands ?? []) {
      const snap = snapshots.get(d.skuId);
      if (!snap || d.openQty <= 0) continue;
      snap.input.demands.push({
        lineId: d.lineId,
        orderId: 0,
        orderNumber: d.orderNumber,
        priority: d.priority,
        orderCreatedAt: d.orderCreatedAt,
        lineNumber: 1,
        openQty: d.openQty,
        preferredLocationId: d.preferredLocationId,
      });
    }

    return snapshots;
  }

  private async locationCodeMap(tx: Tx): Promise<Map<number, string>> {
    const locs = await tx.location.findMany({ select: { id: true, locationCode: true } });
    return new Map(locs.map((l) => [l.id, l.locationCode]));
  }

  // ---- allocation row reconciliation -----------------------------------------------------------

  private async reconcileAllocations(
    tx: Tx,
    skuId: number,
    results: LineAllocationResult[],
    ctx: { actorId: number | null; reason: string },
    now: Date,
  ) {
    const existing = await tx.allocation.findMany({ where: { skuId, status: 'ACTIVE' } });
    const existingByKey = new Map(existing.map((a) => [a.activeKey as string, a]));

    const desired = new Map<string, AllocationPiece & { lineId: number }>();
    for (const r of results) {
      for (const p of r.allocations) {
        desired.set(allocationKey(r.lineId, p), { ...p, lineId: r.lineId });
      }
    }

    // 1. release allocations that are no longer desired (frees their unique activeKey)
    const toRelease = existing.filter((a) => !desired.has(a.activeKey as string)).map((a) => a.id);
    if (toRelease.length > 0) {
      await tx.allocation.updateMany({
        where: { id: { in: toRelease } },
        data: { status: 'RELEASED', activeKey: null, releasedAt: now, releaseReason: truncate(ctx.reason, 250) },
      });
    }

    // 2. update allocations whose quantity or availability changed
    for (const [key, piece] of desired) {
      const cur = existingByKey.get(key);
      if (!cur) continue;
      const availableDate = ymdToDate(piece.availableDate);
      if (cur.quantity !== piece.quantity || cur.availableDate.getTime() !== availableDate.getTime()) {
        await tx.allocation.update({
          where: { id: cur.id },
          data: { quantity: piece.quantity, availableDate },
        });
      }
    }

    // 3. insert new allocations
    const creates = [...desired.entries()]
      .filter(([key]) => !existingByKey.has(key))
      .map(([key, piece]) => ({
        orderLineId: piece.lineId,
        skuId,
        locationId: piece.locationId,
        sourceType: piece.kind,
        receiptId: piece.receiptId,
        quantity: piece.quantity,
        availableDate: ymdToDate(piece.availableDate),
        status: 'ACTIVE' as const,
        activeKey: key,
      }));
    if (creates.length > 0) {
      await tx.allocation.createMany({ data: creates });
    }
  }

  private async inboundDependencies(
    tx: Tx,
    allocations: AllocationPiece[],
  ): Promise<InboundDependency[]> {
    const receiptPieces = allocations.filter((a) => a.kind === 'INBOUND' && a.receiptId !== null);
    if (receiptPieces.length === 0) return [];
    const receipts = await tx.inboundReceipt.findMany({
      where: { id: { in: receiptPieces.map((p) => p.receiptId as number) } },
      include: { location: true },
    });
    return receipts.map((r) => ({
      receiptId: r.id,
      receiptNumber: r.receiptNumber,
      quantity: receiptPieces.filter((p) => p.receiptId === r.id).reduce((s, p) => s + p.quantity, 0),
      status: r.status as 'PLANNED' | 'IN_TRANSIT',
      expectedArrival: toYmd(r.expectedArrivalTime),
      originalExpectedArrival: toYmd(r.originalExpectedArrivalTime),
      locationCode: r.location.locationCode,
    }));
  }

  /** Recomputes order-level aggregates (promise, backorder, allocation status, rank). */
  private async refreshOrderAggregates(tx: Tx, orderIds: number[]) {
    if (orderIds.length === 0) return;
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: { lines: true, exceptions: { where: { status: 'OPEN' }, select: { severity: true } } },
    });
    for (const o of orders) {
      const open = o.lines.filter((l) => l.requestedQty - l.shippedQty > 0 && !l.canceledAt);
      const backorderedQty = open.reduce((s, l) => s + l.backorderedQty, 0);

      let promisedShipDate: Date | null = null;
      if (ACTIVE_ORDER_STATUSES.includes(o.status as (typeof ACTIVE_ORDER_STATUSES)[number]) && open.length > 0) {
        const effective = open.map((l) => l.manualPromisedDate ?? l.calculatedPromisedDate);
        promisedShipDate = effective.every((d) => d !== null)
          ? effective.reduce<Date>((max, d) => (d as Date) > max ? (d as Date) : max, effective[0] as Date)
          : null;
      }

      let allocationStatus: AllocationStatus;
      if (o.status === 'CANCELED') allocationStatus = 'NOT_APPLICABLE';
      else if (o.status === 'SHIPPED') allocationStatus = 'SHIPPED';
      else if (o.status === 'DRAFT') allocationStatus = 'UNALLOCATED';
      else if (open.length === 0) allocationStatus = 'SHIPPED';
      else if (open.every((l) => l.allocationStatus === 'FULLY_ALLOCATED')) allocationStatus = 'FULLY_ALLOCATED';
      else if (open.every((l) => l.allocatedQty === 0)) allocationStatus = 'BACKORDERED';
      else allocationStatus = 'PARTIALLY_ALLOCATED';

      const hasCritical = o.exceptions.some((e) => e.severity === 'CRITICAL');
      const riskLevel: RiskLevel = hasCritical ? 'CRITICAL' : o.exceptions.length > 0 ? 'AT_RISK' : 'ON_TRACK';
      const riskRank = riskLevel === 'CRITICAL' ? 0 : riskLevel === 'AT_RISK' ? 1 : 2;

      const next = {
        promisedShipDate,
        backorderedQty,
        allocationStatus,
        riskLevel,
        riskRank,
        priorityRank: EXCEPTION_PRIORITY_RANK[o.priority],
      };
      const same =
        nullableDateToYmd(o.promisedShipDate) === nullableDateToYmd(next.promisedShipDate) &&
        o.backorderedQty === next.backorderedQty &&
        o.allocationStatus === next.allocationStatus &&
        o.riskLevel === next.riskLevel &&
        o.riskRank === next.riskRank &&
        o.priorityRank === next.priorityRank;
      if (!same) {
        await tx.order.update({ where: { id: o.id }, data: next });
      }
    }
  }
}

// ---- helpers ------------------------------------------------------------------------------------

function isEngineLineActive(line: LoadedLine): boolean {
  return isEngineLineActiveFromParts(line.order.status, line.canceledAt, false) && line.order.canceledAt === null;
}

function isEngineLineActiveFromParts(orderStatus: string, lineCanceledAt: Date | null, forcedCanceled: boolean): boolean {
  return (
    !forcedCanceled &&
    lineCanceledAt === null &&
    (ACTIVE_ORDER_STATUSES as readonly string[]).includes(orderStatus)
  );
}

function idleAllocationStatus(line: LoadedLine): AllocationStatus {
  if (line.order.status === 'CANCELED' || line.canceledAt) return 'NOT_APPLICABLE';
  if (line.order.status === 'SHIPPED' || line.requestedQty - line.shippedQty <= 0) return 'SHIPPED';
  return 'UNALLOCATED';
}

function allocationKey(lineId: number, p: AllocationPiece): string {
  return `${lineId}|${p.kind}|${p.locationId}|${p.receiptId ?? 0}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

function toSummary(r: LineAllocationResult, line: LoadedLine, codes: Map<number, string>): LineSummary {
  const manual = nullableDateToYmd(line.manualPromisedDate);
  return {
    lineId: r.lineId,
    allocatedQty: r.allocatedQty,
    backorderedQty: r.backorderedQty,
    allocationStatus: r.allocationStatus,
    calculatedPromisedDate: r.calculatedPromisedDate,
    effectivePromisedDate: manual ?? r.calculatedPromisedDate,
    earliestShipDate: r.earliestShipDate,
    fulfillmentLocationId: r.fulfillmentLocationId,
    fulfillmentLocationCode: r.fulfillmentLocationId ? codes.get(r.fulfillmentLocationId) ?? null : null,
    allocations: r.allocations.map((a) => ({
      locationCode: a.locationCode,
      kind: a.kind,
      receiptNumber: a.receiptNumber,
      quantity: a.quantity,
      availableDate: a.availableDate,
    })),
  };
}

function toSummaryVirtual(r: LineAllocationResult, codes: Map<number, string>): LineSummary {
  return {
    lineId: r.lineId,
    allocatedQty: r.allocatedQty,
    backorderedQty: r.backorderedQty,
    allocationStatus: r.allocationStatus,
    calculatedPromisedDate: r.calculatedPromisedDate,
    effectivePromisedDate: r.calculatedPromisedDate,
    earliestShipDate: r.earliestShipDate,
    fulfillmentLocationId: r.fulfillmentLocationId,
    fulfillmentLocationCode: r.fulfillmentLocationId ? codes.get(r.fulfillmentLocationId) ?? null : null,
    allocations: r.allocations.map((a) => ({
      locationCode: a.locationCode,
      kind: a.kind,
      receiptNumber: a.receiptNumber,
      quantity: a.quantity,
      availableDate: a.availableDate,
    })),
  };
}
