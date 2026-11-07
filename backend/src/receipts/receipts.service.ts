import { Injectable } from '@nestjs/common';
import { InboundReceipt, Prisma, Priority } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AllocationService } from '../allocation/allocation.service';
import { canceledDependencyAction, severityFromPriority } from '../allocation/exception-rules';
import { ExceptionsService, LineMeta } from '../exceptions/exceptions.service';
import { ApiError } from '../common/api/api-error';
import { paginate } from '../common/api/api.interceptors';
import { parseDateInput } from '../common/dto/date';
import { diffDaysYmd, nullableDateToYmd, toYmd } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { CreateReceiptDto, ReceiptListQueryDto, ReasonDto, UpdateReceiptDto } from './receipts.dto';

const OPEN_STATUSES = ['PLANNED', 'IN_TRANSIT'] as const;

export interface ReceiptChangeResult {
  receipt: ReturnType<typeof toDto>;
  delta: { days: number; direction: 'LATER' | 'EARLIER' | 'SAME' };
  recalculation: { affectedOrders: number; changedLines: number; exceptionsCreated: number; exceptionsResolved: number };
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: AllocationService,
    private readonly exceptions: ExceptionsService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  async list(query: ReceiptListQueryDto) {
    const where: Prisma.InboundReceiptWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.locationId) where.locationId = query.locationId;
    if (query.skuId) where.skuId = query.skuId;
    if (query.search) {
      const q = query.search.trim();
      where.OR = [{ receiptNumber: { contains: q } }, { sku: { skuCode: { contains: q } } }, { sku: { name: { contains: q } } }];
    }
    if (query.from || query.to) {
      where.expectedArrivalTime = {
        ...(query.from ? { gte: parseDateInput(query.from, 'from') } : {}),
        ...(query.to ? { lt: new Date(parseDateInput(query.to, 'to').getTime() + 86_400_000) } : {}),
      };
    }
    const dir = query.dir ?? 'asc';
    const orderBy: Prisma.InboundReceiptOrderByWithRelationInput[] =
      query.sort === 'status'
        ? [{ status: dir }, { id: 'asc' }]
        : query.sort === 'receiptNumber'
          ? [{ receiptNumber: dir }]
          : query.sort === 'quantity'
            ? [{ quantity: dir }, { id: 'asc' }]
            : [{ expectedArrivalTime: dir }, { id: 'asc' }];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.inboundReceipt.count({ where }),
      this.prisma.inboundReceipt.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { sku: true, location: true },
      }),
    ]);
    return paginate(rows.map((r) => listDto(r)), query.page, query.pageSize, total);
  }

  async detail(id: number) {
    const r = await this.prisma.inboundReceipt.findUnique({ where: { id }, include: { sku: true, location: true } });
    if (!r) throw ApiError.notFound('Receipt', id);
    const [allocations, history, ledgerRows] = await Promise.all([
      this.prisma.allocation.findMany({
        where: { receiptId: id, status: 'ACTIVE' },
        include: { orderLine: { include: { order: { include: { customer: true } } } } },
        orderBy: { availableDate: 'asc' },
      }),
      this.audit.historyFor('InboundReceipt', id),
      this.prisma.inventoryAdjustment.findMany({ where: { referenceKey: `RECEIPT:${id}` } }),
    ]);
    const delayDays = diffDaysYmd(toYmd(r.originalExpectedArrivalTime), toYmd(r.expectedArrivalTime));
    return {
      ...toDto(r),
      sku: { id: r.sku.id, skuCode: r.sku.skuCode, name: r.sku.name },
      location: { id: r.location.id, locationCode: r.location.locationCode, name: r.location.name },
      delayDays,
      isDelayed: delayDays > 0 && (r.status === 'PLANNED' || r.status === 'IN_TRANSIT'),
      dependentAllocations: allocations.map((a) => ({
        allocationId: a.id,
        orderLineId: a.orderLineId,
        orderId: a.orderLine.orderId,
        orderNumber: a.orderLine.order.orderNumber,
        customer: a.orderLine.order.customer.name,
        priority: a.orderLine.order.priority,
        quantity: a.quantity,
        availableDate: toYmd(a.availableDate),
        promisedShipDate: nullableDateToYmd(a.orderLine.manualPromisedDate ?? a.orderLine.calculatedPromisedDate),
      })),
      ledger: ledgerRows.map((l) => ({
        adjustmentNumber: l.adjustmentNumber,
        quantityDelta: l.quantityDelta,
        newOnHand: l.newOnHand,
        createdAt: l.createdAt.toISOString(),
      })),
      history,
    };
  }

  async create(dto: CreateReceiptDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const [sku, loc] = await Promise.all([
        tx.sku.findUnique({ where: { id: dto.skuId } }),
        tx.location.findUnique({ where: { id: dto.locationId } }),
      ]);
      if (!sku) throw ApiError.notFound('Sku', dto.skuId);
      if (!loc || !loc.isActive) throw ApiError.badRequest('LOCATION_INVALID', 'Destination must be an active location');
      if (await tx.inboundReceipt.findUnique({ where: { receiptNumber: dto.receiptNumber } })) {
        throw ApiError.conflict('RECEIPT_NUMBER_EXISTS', `Receipt ${dto.receiptNumber} already exists`);
      }
      await this.allocation.lockSkus(tx, [dto.skuId]);
      const arrival = parseDateInput(dto.expectedArrivalTime, 'expectedArrivalTime');
      const receipt = await tx.inboundReceipt.create({
        data: {
          receiptNumber: dto.receiptNumber,
          skuId: dto.skuId,
          locationId: dto.locationId,
          quantity: dto.quantity,
          status: dto.status ?? 'PLANNED',
          expectedArrivalTime: arrival,
          originalExpectedArrivalTime: arrival,
          inTransitAt: dto.status === 'IN_TRANSIT' ? new Date() : null,
          createdById: actorId,
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'InboundReceipt',
        entityId: receipt.id,
        action: 'RECEIPT_CREATED',
        newValue: toDto(receipt),
        reason: 'Inbound receipt created',
      });
      const recalc = await this.allocation.recalculate(tx, [dto.skuId], {
        actorId,
        reason: `Receipt ${receipt.receiptNumber} created`,
      });
      return { ...toDto(receipt), recalculation: summarize(recalc) };
    });
  }

  /**
   * Edits quantity, destination and expected arrival. Editing an arrival date always recalculates
   * allocations and promises (rule 5). Only open (PLANNED/IN_TRANSIT) receipts are editable.
   */
  async update(id: number, dto: UpdateReceiptDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const current = await tx.inboundReceipt.findUnique({ where: { id } });
      if (!current) throw ApiError.notFound('Receipt', id);
      await this.allocation.lockSkus(tx, [current.skuId]);
      const before = await tx.inboundReceipt.findUniqueOrThrow({ where: { id } });
      if (dto.version !== undefined && dto.version !== before.version) {
        throw ApiError.conflict('VERSION_CONFLICT', 'This receipt was changed by someone else. Reload and try again.');
      }
      if (!(OPEN_STATUSES as readonly string[]).includes(before.status)) {
        throw ApiError.conflict('RECEIPT_NOT_EDITABLE', `A ${before.status} receipt can no longer be edited`);
      }
      const newArrival = dto.expectedArrivalTime ? parseDateInput(dto.expectedArrivalTime, 'expectedArrivalTime') : null;
      const arrivalChanged = newArrival !== null && newArrival.getTime() !== before.expectedArrivalTime.getTime();
      if (arrivalChanged && !dto.reason) {
        throw ApiError.badRequest('REASON_REQUIRED', 'A reason is required when changing the expected arrival date');
      }
      if (dto.locationId && dto.locationId !== before.locationId) {
        const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
        if (!loc || !loc.isActive) throw ApiError.badRequest('LOCATION_INVALID', 'Destination must be an active location');
      }
      const after = await tx.inboundReceipt.update({
        where: { id },
        data: {
          quantity: dto.quantity ?? undefined,
          expectedArrivalTime: arrivalChanged ? newArrival! : undefined,
          locationId: dto.locationId ?? undefined,
          version: { increment: 1 },
        },
      });
      const direction: 'LATER' | 'EARLIER' | 'SAME' = !arrivalChanged
        ? 'SAME'
        : after.expectedArrivalTime > before.expectedArrivalTime
          ? 'LATER'
          : 'EARLIER';
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'InboundReceipt',
        entityId: id,
        action: arrivalChanged ? (direction === 'LATER' ? 'RECEIPT_DELAYED' : 'RECEIPT_EXPEDITED') : 'RECEIPT_UPDATED',
        previousValue: toDto(before),
        newValue: toDto(after),
        reason: dto.reason ?? 'Receipt details updated',
      });
      const recalc = await this.allocation.recalculate(tx, [current.skuId], {
        actorId,
        reason: arrivalChanged ? `Receipt ${current.receiptNumber} arrival ${direction.toLowerCase()}` : `Receipt ${current.receiptNumber} updated`,
      });
      return {
        ...toDto(after),
        delta: {
          days: arrivalChanged ? diffDaysYmd(toYmd(before.expectedArrivalTime), toYmd(after.expectedArrivalTime)) : 0,
          direction,
        },
        recalculation: summarize(recalc),
      };
    });
  }

  /** Planner expedite/delay entry point used by planner actions and AI-approved proposals. */
  async changeArrival(
    tx: Tx,
    p: { receiptId: number; newArrival: Date; reason: string; actorId: number; action: string },
  ): Promise<{ receipt: InboundReceipt; direction: 'LATER' | 'EARLIER' | 'SAME' }> {
    const before = await tx.inboundReceipt.findUnique({ where: { id: p.receiptId } });
    if (!before) throw ApiError.notFound('Receipt', p.receiptId);
    if (!(OPEN_STATUSES as readonly string[]).includes(before.status)) {
      throw ApiError.conflict('RECEIPT_NOT_EDITABLE', `A ${before.status} receipt cannot change its arrival date`);
    }
    await this.allocation.lockSkus(tx, [before.skuId]);
    const after = await tx.inboundReceipt.update({
      where: { id: p.receiptId },
      data: { expectedArrivalTime: p.newArrival, version: { increment: 1 } },
    });
    const direction: 'LATER' | 'EARLIER' | 'SAME' =
      after.expectedArrivalTime.getTime() === before.expectedArrivalTime.getTime()
        ? 'SAME'
        : after.expectedArrivalTime > before.expectedArrivalTime
          ? 'LATER'
          : 'EARLIER';
    await this.audit.record(tx, {
      userId: p.actorId,
      entityType: 'InboundReceipt',
      entityId: p.receiptId,
      action: p.action,
      previousValue: { expectedArrivalTime: before.expectedArrivalTime.toISOString() },
      newValue: { expectedArrivalTime: after.expectedArrivalTime.toISOString() },
      reason: p.reason,
    });
    return { receipt: after, direction };
  }

  async markInTransit(id: number, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const r = await tx.inboundReceipt.findUnique({ where: { id } });
      if (!r) throw ApiError.notFound('Receipt', id);
      if (r.status === 'IN_TRANSIT') return { ...toDto(r), idempotent: true };
      if (r.status !== 'PLANNED') throw ApiError.conflict('INVALID_TRANSITION', `Receipt is ${r.status}; only PLANNED receipts can go in transit`);
      await this.allocation.lockSkus(tx, [r.skuId]);
      const updated = await tx.inboundReceipt.update({
        where: { id },
        data: { status: 'IN_TRANSIT', inTransitAt: new Date(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'InboundReceipt',
        entityId: id,
        action: 'RECEIPT_IN_TRANSIT',
        previousValue: { status: 'PLANNED' },
        newValue: { status: 'IN_TRANSIT' },
        reason: 'Marked in transit',
      });
      await this.allocation.recalculate(tx, [r.skuId], { actorId, reason: `Receipt ${r.receiptNumber} in transit` });
      return { ...toDto(updated), idempotent: false };
    });
  }

  /**
   * Receives a receipt exactly once. Protection layers:
   *  1. A conditional UPDATE (status IN (PLANNED, IN_TRANSIT)) flips the status; only the caller that
   *     flips it proceeds. Concurrent or repeated calls see 0 rows and return the existing result.
   *  2. The ledger row carries referenceKey "RECEIPT:<id>", which is UNIQUE in the database, so the
   *     inventory increase cannot be booked twice even if the code above is bypassed.
   *  3. The SKU is locked before the check, serializing with other writers.
   */
  async receive(id: number, actorId: number, reason?: string) {
    return this.prisma.transact(async (tx) => {
      const r = await tx.inboundReceipt.findUnique({ where: { id } });
      if (!r) throw ApiError.notFound('Receipt', id);
      await this.allocation.lockSkus(tx, [r.skuId]);

      const flipped = await tx.inboundReceipt.updateMany({
        where: { id, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'RECEIVED', receivedAt: new Date(), version: { increment: 1 } },
      });
      if (flipped.count === 0) {
        const current = await tx.inboundReceipt.findUniqueOrThrow({ where: { id } });
        if (current.status === 'RECEIVED') {
          return { ...toDto(current), idempotent: true, inventory: null, recalculation: null };
        }
        throw ApiError.conflict('RECEIPT_CANCELED', `Receipt ${current.receiptNumber} is canceled and cannot be received`);
      }

      const posted = await this.ledger.post(tx, {
        skuId: r.skuId,
        locationId: r.locationId,
        delta: r.quantity,
        movementType: 'RECEIPT_RECEIVED',
        reason: reason ?? `Received ${r.receiptNumber}`,
        referenceKey: `RECEIPT:${id}`,
        userId: actorId,
      });
      const updated = await tx.inboundReceipt.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'InboundReceipt',
        entityId: id,
        action: 'RECEIPT_RECEIVED',
        previousValue: { status: r.status },
        newValue: { status: 'RECEIVED', onHandAfter: posted.newOnHand, quantity: r.quantity },
        reason: reason ?? 'Receipt received into inventory',
        metadata: { adjustmentNumber: posted.adjustmentNumber },
      });
      const recalc = await this.allocation.recalculate(tx, [r.skuId], {
        actorId,
        reason: `Receipt ${r.receiptNumber} received`,
      });
      return {
        ...toDto(updated),
        idempotent: false,
        inventory: { adjustmentNumber: posted.adjustmentNumber, previousOnHand: posted.previousOnHand, newOnHand: posted.newOnHand },
        recalculation: summarize(recalc),
      };
    });
  }

  /**
   * Cancels an open receipt. Its supply leaves the ATP projection immediately. Every order line that
   * had units allocated from it receives a CANCELED_INBOUND_DEPENDENCY exception, then allocations are
   * recalculated (units are re-allocated from other supply or become backordered).
   */
  async cancel(id: number, dto: ReasonDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const r = await tx.inboundReceipt.findUnique({ where: { id }, include: { location: true } });
      if (!r) throw ApiError.notFound('Receipt', id);
      await this.allocation.lockSkus(tx, [r.skuId]);
      if (r.status === 'CANCELED') return { ...toDto(r), idempotent: true, recalculation: null, dependentLines: [] };
      if (r.status === 'RECEIVED') {
        throw ApiError.conflict('RECEIPT_ALREADY_RECEIVED', 'A received receipt cannot be canceled; its units are already in inventory');
      }

      const flipped = await tx.inboundReceipt.updateMany({
        where: { id, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: dto.reason, version: { increment: 1 } },
      });
      if (flipped.count === 0) {
        const current = await tx.inboundReceipt.findUniqueOrThrow({ where: { id } });
        if (current.status === 'CANCELED') return { ...toDto(current), idempotent: true, recalculation: null, dependentLines: [] };
        throw ApiError.conflict('RECEIPT_ALREADY_RECEIVED', 'The receipt was received concurrently and cannot be canceled');
      }

      // Lines that depend on this receipt right now.
      const dependents = await tx.allocation.findMany({
        where: { receiptId: id, status: 'ACTIVE' },
        include: { orderLine: { include: { order: { include: { customer: true } } } } },
      });
      const byLine = new Map<number, { qty: number; line: (typeof dependents)[number]['orderLine'] }>();
      for (const d of dependents) {
        const cur = byLine.get(d.orderLineId) ?? { qty: 0, line: d.orderLine };
        cur.qty += d.quantity;
        byLine.set(d.orderLineId, cur);
      }

      for (const [lineId, dep] of byLine) {
        const meta: LineMeta = {
          orderId: dep.line.orderId,
          skuId: r.skuId,
          priority: dep.line.order.priority as Priority,
          requestedShipDate: nullableDateToYmd(dep.line.order.requestedShipDate),
        };
        await this.exceptions.openEvent(tx, {
          lineId,
          lineMeta: meta,
          actorId,
          reason: `Receipt ${r.receiptNumber} canceled`,
          desired: {
            type: 'CANCELED_INBOUND_DEPENDENCY',
            reference: String(id),
            receiptId: id,
            severity: severityFromPriority(dep.line.order.priority as Priority),
            affectedQty: dep.qty,
            currentPromisedDate: nullableDateToYmd(dep.line.manualPromisedDate ?? dep.line.calculatedPromisedDate),
            requestedShipDate: nullableDateToYmd(dep.line.order.requestedShipDate),
            recommendedAction: canceledDependencyAction(r.receiptNumber, dep.qty),
            details: { receiptNumber: r.receiptNumber, releasedQty: dep.qty, cancelReason: dto.reason },
          },
        });
      }

      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'InboundReceipt',
        entityId: id,
        action: 'RECEIPT_CANCELED',
        previousValue: { status: r.status },
        newValue: { status: 'CANCELED' },
        reason: dto.reason,
        metadata: { dependentOrderLines: byLine.size, releasedQty: dependents.reduce((s, d) => s + d.quantity, 0) },
      });

      const recalc = await this.allocation.recalculate(tx, [r.skuId], {
        actorId,
        reason: `Receipt ${r.receiptNumber} canceled`,
      });
      const canceled = await tx.inboundReceipt.findUniqueOrThrow({ where: { id } });
      return {
        ...toDto(canceled),
        idempotent: false,
        recalculation: summarize(recalc),
        dependentLines: [...byLine.values()].map((v) => ({ orderNumber: v.line.order.orderNumber, releasedQty: v.qty })),
      };
    });
  }
}

export function toDto(r: InboundReceipt) {
  return {
    id: r.id,
    receiptNumber: r.receiptNumber,
    skuId: r.skuId,
    locationId: r.locationId,
    quantity: r.quantity,
    status: r.status,
    expectedArrivalTime: r.expectedArrivalTime.toISOString(),
    originalExpectedArrivalTime: r.originalExpectedArrivalTime.toISOString(),
    receivedAt: r.receivedAt?.toISOString() ?? null,
    canceledAt: r.canceledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    inTransitAt: r.inTransitAt?.toISOString() ?? null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function listDto(r: InboundReceipt & { sku: { skuCode: string; name: string }; location: { locationCode: string } }) {
  const delayDays = diffDaysYmd(toYmd(r.originalExpectedArrivalTime), toYmd(r.expectedArrivalTime));
  return {
    ...toDto(r),
    skuCode: r.sku.skuCode,
    productName: r.sku.name,
    locationCode: r.location.locationCode,
    delayDays,
  };
}

function summarize(r: { affectedOrderIds: number[]; changedLineIds: number[]; exceptionsCreated: number; exceptionsResolved: number }) {
  return {
    affectedOrders: r.affectedOrderIds.length,
    changedLines: r.changedLineIds.length,
    exceptionsCreated: r.exceptionsCreated,
    exceptionsResolved: r.exceptionsResolved,
  };
}

