import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AllocationService } from '../allocation/allocation.service';
import { ApiError } from '../common/api/api-error';
import { parseDateInput } from '../common/dto/date';
import { nullableDateToYmd, todayYmd, toYmd } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { ExpediteReceiptDto, OverridePromiseDto, ReassignLocationDto, SplitShipmentDto } from './planner.dto';

export interface MovementSummary {
  lineId: number;
  orderNumber: string;
  sku: string;
  requestedQty: number;
  backorderedBefore: number;
  backorderedAfter: number;
  promiseBefore: string | null;
  promiseAfter: string | null;
  fulfillmentBefore: string | null;
  fulfillmentAfter: string | null;
}

@Injectable()
export class PlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: AllocationService,
    private readonly receipts: ReceiptsService,
    private readonly orders: OrdersService,
  ) {}

  // ------------------------------------------------------------ A. expedite receipt

  async expediteReceiptPreview(dto: ExpediteReceiptDto) {
    return this.prisma.transact(async (tx) => {
      const r = await this.requireOpenReceipt(tx, dto.receiptId);
      const newArrival = parseDateInput(dto.newExpectedArrival, 'newExpectedArrival');
      this.assertEarlier(r.expectedArrivalTime, newArrival);
      const sim = await this.allocation.simulate(tx, [r.skuId], { receiptArrival: new Map([[r.id, newArrival]]) });
      return {
        receipt: { id: r.id, receiptNumber: r.receiptNumber, currentArrival: r.expectedArrivalTime.toISOString(), proposedArrival: newArrival.toISOString() },
        impact: await this.movements(tx, sim),
      };
    });
  }

  async expediteReceipt(dto: ExpediteReceiptDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const r = await this.requireOpenReceipt(tx, dto.receiptId);
      const newArrival = parseDateInput(dto.newExpectedArrival, 'newExpectedArrival');
      this.assertEarlier(r.expectedArrivalTime, newArrival);
      const sim = await this.allocation.simulate(tx, [r.skuId], { receiptArrival: new Map([[r.id, newArrival]]) });
      const changed = await this.receipts.changeArrival(tx, {
        receiptId: r.id,
        newArrival,
        reason: dto.reason,
        actorId,
        action: 'PLANNER_EXPEDITE_RECEIPT',
      });
      const recalc = await this.allocation.recalculate(tx, [r.skuId], { actorId, reason: `Planner expedited ${r.receiptNumber}: ${dto.reason}` });
      return {
        receiptId: r.id,
        receiptNumber: r.receiptNumber,
        direction: changed.direction,
        newArrival: toYmd(changed.receipt.expectedArrivalTime),
        impact: await this.movements(tx, sim),
        recalculation: { affectedOrders: recalc.affectedOrderIds.length, changedLines: recalc.changedLineIds.length },
      };
    });
  }

  // ------------------------------------------------------------ B. reassign location

  /** For every active location: the stock that could serve the line and the resulting promise. */
  async reassignPreview(orderLineId: number) {
    return this.prisma.transact(async (tx) => {
      const line = await this.requireActiveLine(tx, orderLineId);
      const locations = await tx.location.findMany({ where: { isActive: true }, orderBy: { locationCode: 'asc' } });
      const balances = await tx.inventoryBalance.findMany({ where: { skuId: line.skuId } });
      const inbound = await tx.inboundReceipt.findMany({ where: { skuId: line.skuId, status: { in: ['PLANNED', 'IN_TRANSIT'] } } });
      const options = [];
      for (const loc of locations) {
        const sim = await this.allocation.simulate(tx, [line.skuId], { lineLocation: new Map([[orderLineId, loc.id]]) });
        const after = sim.after.get(orderLineId);
        const onHand = balances.find((b) => b.locationId === loc.id)?.onHand ?? 0;
        const incoming = inbound.filter((r) => r.locationId === loc.id).reduce((s, r) => s + r.quantity, 0);
        options.push({
          locationId: loc.id,
          locationCode: loc.locationCode,
          locationName: loc.name,
          onHand,
          incoming,
          allocatedQty: after?.allocatedQty ?? 0,
          backorderedQty: after?.backorderedQty ?? line.requestedQty - line.shippedQty,
          promisedShipDate: after?.effectivePromisedDate ?? null,
          earliestShipDate: after?.earliestShipDate ?? null,
          isCurrent: line.preferredLocationId === loc.id,
        });
      }
      options.sort(
        (a, b) =>
          (a.backorderedQty - b.backorderedQty) ||
          ((a.promisedShipDate ?? '9999') < (b.promisedShipDate ?? '9999') ? -1 : (a.promisedShipDate ?? '9999') > (b.promisedShipDate ?? '9999') ? 1 : 0) ||
          a.locationCode.localeCompare(b.locationCode),
      );
      const current = await this.lineView(tx, orderLineId);
      return { line: current, options, recommendedLocationId: options[0]?.locationId ?? null };
    });
  }

  async reassignLocation(dto: ReassignLocationDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const line = await this.requireActiveLine(tx, dto.orderLineId);
      if (dto.locationId) {
        const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
        if (!loc || !loc.isActive) throw ApiError.badRequest('LOCATION_INVALID', 'Target location must be active');
      }
      await this.allocation.lockSkus(tx, [line.skuId]);
      const before = await this.lineView(tx, dto.orderLineId);
      await tx.orderLine.update({
        where: { id: dto.orderLineId },
        data: { preferredLocationId: dto.locationId ?? null, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'OrderLine',
        entityId: dto.orderLineId,
        action: 'PLANNER_REASSIGN_LOCATION',
        previousValue: { preferredLocationId: line.preferredLocationId },
        newValue: { preferredLocationId: dto.locationId ?? null },
        reason: dto.reason,
        metadata: { orderId: line.orderId },
      });
      const recalc = await this.allocation.recalculate(tx, [line.skuId], { actorId, reason: `Planner reassigned line: ${dto.reason}` });
      const after = await this.lineView(tx, dto.orderLineId);
      return { before, after, recalculation: { affectedOrders: recalc.affectedOrderIds.length, changedLines: recalc.changedLineIds.length } };
    });
  }

  // ------------------------------------------------------------ C. override promise

  async overridePromise(dto: OverridePromiseDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const line = await this.requireActiveLine(tx, dto.orderLineId);
      const before = await this.lineView(tx, dto.orderLineId);
      const manual = dto.promisedDate ? parseDateInput(dto.promisedDate, 'promisedDate') : null;
      await this.allocation.lockSkus(tx, [line.skuId]);
      await tx.orderLine.update({
        where: { id: dto.orderLineId },
        data: {
          manualPromisedDate: manual,
          manualPromiseReason: manual ? dto.justification : null,
          manualPromiseSetById: manual ? actorId : null,
          manualPromiseSetAt: manual ? new Date() : null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'OrderLine',
        entityId: dto.orderLineId,
        action: manual ? 'PLANNER_PROMISE_OVERRIDE' : 'PLANNER_PROMISE_OVERRIDE_CLEARED',
        previousValue: { manualPromisedDate: before.manualPromisedDate, calculatedPromisedDate: before.calculatedPromisedDate },
        newValue: { manualPromisedDate: manual ? toYmd(manual) : null, calculatedPromisedDate: before.calculatedPromisedDate },
        reason: dto.justification,
        metadata: { orderId: line.orderId, isManualOverride: !!manual },
      });
      const recalc = await this.allocation.recalculate(tx, [line.skuId], { actorId, reason: 'Planner promise override' });
      const after = await this.lineView(tx, dto.orderLineId);
      return { before, after, recalculation: { affectedOrders: recalc.affectedOrderIds.length, changedLines: recalc.changedLineIds.length } };
    });
  }

  // ------------------------------------------------------------ D. split shipment

  /** Ships part of a line now; remaining quantity stays allocated or backordered. */
  async splitShipment(dto: SplitShipmentDto, actorId: number) {
    const result = await this.orders.ship(
      dto.orderId,
      { lines: dto.lines, reason: dto.reason, isSplit: true, version: dto.version },
      actorId,
    );
    return result;
  }

  // ------------------------------------------------------------ helpers

  private async requireOpenReceipt(tx: Tx, id: number) {
    const r = await tx.inboundReceipt.findUnique({ where: { id } });
    if (!r) throw ApiError.notFound('Receipt', id);
    if (r.status !== 'PLANNED' && r.status !== 'IN_TRANSIT') {
      throw ApiError.conflict('RECEIPT_NOT_OPEN', `Receipt ${r.receiptNumber} is ${r.status}; only open receipts can be expedited`);
    }
    return r;
  }

  private assertEarlier(current: Date, proposed: Date) {
    if (proposed.getTime() >= current.getTime()) {
      throw ApiError.unprocessable('NOT_AN_EXPEDITE', `Expedite requires an earlier arrival than ${toYmd(current)}`);
    }
    if (toYmd(proposed) < todayYmd()) {
      throw ApiError.unprocessable('DATE_IN_PAST', 'Expedited arrival cannot be before today');
    }
  }

  private async requireActiveLine(tx: Tx, id: number) {
    const line = await tx.orderLine.findUnique({ where: { id }, include: { order: true } });
    if (!line || line.canceledAt) throw ApiError.notFound('OrderLine', id);
    if (!['CONFIRMED', 'FULFILLING'].includes(line.order.status)) {
      throw ApiError.conflict('ORDER_NOT_ACTIVE', `Order ${line.order.orderNumber} is ${line.order.status}; only confirmed or fulfilling orders can be planned`);
    }
    return line;
  }

  private async lineView(tx: Tx, id: number) {
    const l = await tx.orderLine.findUniqueOrThrow({
      where: { id },
      include: { order: true, sku: true, fulfillmentLocation: true, preferredLocation: true },
    });
    return {
      lineId: l.id,
      orderNumber: l.order.orderNumber,
      sku: l.sku.skuCode,
      requestedQty: l.requestedQty,
      allocatedQty: l.allocatedQty,
      backorderedQty: l.backorderedQty,
      preferredLocationId: l.preferredLocationId,
      preferredLocation: l.preferredLocation?.locationCode ?? null,
      fulfillmentLocation: l.fulfillmentLocation?.locationCode ?? null,
      calculatedPromisedDate: nullableDateToYmd(l.calculatedPromisedDate),
      manualPromisedDate: nullableDateToYmd(l.manualPromisedDate),
      effectivePromisedDate: nullableDateToYmd(l.manualPromisedDate ?? l.calculatedPromisedDate),
      requestedShipDate: nullableDateToYmd(l.order.requestedShipDate),
      manualPromiseReason: l.manualPromiseReason,
    };
  }

  /** Converts a simulation into a before/after list for the lines that actually change. */
  private async movements(tx: Tx, sim: { before: Map<number, any>; after: Map<number, any> }): Promise<MovementSummary[]> {
    const ids = [...sim.after.keys()].filter((k) => k > 0);
    const lines = await tx.orderLine.findMany({ where: { id: { in: ids } }, include: { order: true, sku: true } });
    const out: MovementSummary[] = [];
    for (const l of lines) {
      const b = sim.before.get(l.id);
      const a = sim.after.get(l.id);
      if (!a) continue;
      if (b && b.backorderedQty === a.backorderedQty && b.effectivePromisedDate === a.effectivePromisedDate && b.fulfillmentLocationCode === a.fulfillmentLocationCode) continue;
      out.push({
        lineId: l.id,
        orderNumber: l.order.orderNumber,
        sku: l.sku.skuCode,
        requestedQty: l.requestedQty - l.shippedQty,
        backorderedBefore: b?.backorderedQty ?? 0,
        backorderedAfter: a.backorderedQty,
        promiseBefore: b?.effectivePromisedDate ?? null,
        promiseAfter: a.effectivePromisedDate,
        fulfillmentBefore: b?.fulfillmentLocationCode ?? null,
        fulfillmentAfter: a.fulfillmentLocationCode,
      });
    }
    return out.sort((x, y) => x.orderNumber.localeCompare(y.orderNumber) || x.lineId - y.lineId);
  }
}
