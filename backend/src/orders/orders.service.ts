import { Injectable } from '@nestjs/common';
import { Order, OrderLine, Prisma, Priority } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AllocationService } from '../allocation/allocation.service';
import { ApiError } from '../common/api/api-error';
import { paginate } from '../common/api/api.interceptors';
import { parseDateInput } from '../common/dto/date';
import { diffDaysYmd, nullableDateToYmd, todayYmd, toYmd } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { SequenceService } from '../common/sequence/sequence.service';
import { CustomersService } from '../customers/customers.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryLedgerService } from '../inventory/inventory-ledger.service';
import { ExceptionTypeName } from '../allocation/exception-rules';
import {
  CancelOrderDto,
  CommunicationDto,
  CreateOrderDto,
  OrderLineInputDto,
  OrderListQueryDto,
  PreviewOrderDto,
  ShipOrderDto,
  TimelineQueryDto,
  UpdateOrderDto,
  VersionDto,
} from './orders.dto';

const OPEN_ORDER: Order['status'][] = ['CONFIRMED', 'FULFILLING'];
const EDITABLE: Order['status'][] = ['DRAFT', 'CONFIRMED', 'FULFILLING'];

export const ORDER_LIST_INCLUDE = {
  customer: true,
  exceptions: { where: { status: 'OPEN' as const }, select: { id: true, severity: true, type: true } },
  lines: { select: { id: true, requestedQty: true, shippedQty: true, canceledAt: true } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: AllocationService,
    private readonly sequence: SequenceService,
    private readonly customers: CustomersService,
    private readonly inventory: InventoryService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  // ---------------------------------------------------------------- queries

  async list(q: OrderListQueryDto) {
    const where: Prisma.OrderWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.priority) where.priority = q.priority;
    if (q.search) {
      const s = q.search.trim();
      where.OR = [{ orderNumber: { contains: s } }, { customer: { name: { contains: s } } }];
    }
    if (q.exceptionType) where.exceptions = { some: { type: q.exceptionType as ExceptionTypeName, status: 'OPEN' } };
    if (q.locationId) {
      where.lines = { some: { OR: [{ fulfillmentLocationId: q.locationId }, { preferredLocationId: q.locationId }] } };
    }
    if (q.requestedFrom || q.requestedTo) {
      where.requestedShipDate = {
        ...(q.requestedFrom ? { gte: parseDateInput(q.requestedFrom, 'requestedFrom') } : {}),
        ...(q.requestedTo ? { lte: parseDateInput(q.requestedTo, 'requestedTo') } : {}),
      };
    }
    if (q.promisedFrom || q.promisedTo) {
      where.promisedShipDate = {
        ...(q.promisedFrom ? { gte: parseDateInput(q.promisedFrom, 'promisedFrom') } : {}),
        ...(q.promisedTo ? { lte: parseDateInput(q.promisedTo, 'promisedTo') } : {}),
      };
    }
    const orderBy: Prisma.OrderOrderByWithRelationInput[] =
      q.sort === 'promised'
        ? [{ promisedShipDate: 'asc' }, { id: 'asc' }]
        : q.sort === 'oldest'
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : q.sort === 'priority'
            ? [{ priorityRank: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
            : q.sort === 'backorder'
              ? [{ backorderedQty: 'desc' }, { riskRank: 'asc' }, { id: 'asc' }]
              : q.sort === 'requested'
                ? [{ requestedShipDate: 'asc' }, { id: 'asc' }]
                : [{ riskRank: 'asc' }, { backorderedQty: 'desc' }, { priorityRank: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: ORDER_LIST_INCLUDE,
      }),
    ]);
    return paginate(rows.map(listDto), q.page, q.pageSize, total);
  }

  async detail(id: number) {
    return this.prisma.transact(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          customer: { include: { preferredLocation: true } },
          preferredLocation: true,
          createdBy: true,
          lines: {
            where: { canceledAt: null },
            orderBy: { lineNumber: 'asc' },
            include: {
              sku: true,
              preferredLocation: true,
              fulfillmentLocation: true,
              allocations: {
                where: { status: 'ACTIVE' },
                include: { location: true, receipt: true },
                orderBy: [{ sourceType: 'asc' }, { availableDate: 'asc' }, { id: 'asc' }],
              },
            },
          },
          shipments: { include: { location: true, lines: { include: { orderLine: { include: { sku: true } } } } }, orderBy: { shippedAt: 'asc' } },
          exceptions: { where: { status: 'OPEN' }, orderBy: [{ severityRank: 'asc' }, { id: 'asc' }] },
          _count: { select: { communications: true } },
        },
      });
      if (!order) throw ApiError.notFound('Order', id);
      return orderDetailDto(order, todayYmd());
    });
  }

  /** Preview: what would happen if this order were created now. Never persists. */
  async preview(dto: PreviewOrderDto) {
    return this.prisma.transact(async (tx) => {
      const resolved = await this.resolveLines(tx, dto.lines);
      const customer = await tx.customer.findUnique({ where: { name: dto.customerName } });
      const defaultPref = dto.preferredLocationId ?? customer?.preferredLocationId ?? null;
      const now = new Date().toISOString();
      const extra = resolved.map((r, i) => ({
        lineId: -(i + 1),
        skuId: r.skuId,
        orderNumber: 'PREVIEW',
        priority: dto.priority as Priority,
        orderCreatedAt: now,
        openQty: r.quantity,
        preferredLocationId: r.preferredLocationId ?? defaultPref,
      }));
      const skuIds = [...new Set(resolved.map((r) => r.skuId))];
      const sim = await this.allocation.simulate(tx, skuIds, { extraDemands: extra });
      const codes = await tx.location.findMany({ select: { id: true, locationCode: true } });
      const codeOf = new Map(codes.map((c) => [c.id, c.locationCode]));

      const lines = resolved.map((r, i) => {
        const s = sim.after.get(-(i + 1));
        return {
          skuId: r.skuId,
          skuCode: r.skuCode,
          productName: r.productName,
          requestedQty: r.quantity,
          allocatedQty: s?.allocatedQty ?? 0,
          backorderedQty: s?.backorderedQty ?? r.quantity,
          allocationStatus: s?.allocationStatus ?? 'BACKORDERED',
          fulfillmentLocation: s?.fulfillmentLocationCode ?? null,
          preferredLocation: extra[i].preferredLocationId ? codeOf.get(extra[i].preferredLocationId as number) ?? null : null,
          promisedShipDate: s?.calculatedPromisedDate ?? null,
          earliestShipDate: s?.earliestShipDate ?? null,
          allocations: (s?.allocations ?? []).map((a) => ({ ...a })),
        };
      });

      // Other orders whose promise would change because this order takes supply.
      const impactedOthers: Array<{ lineId: number; before: string | null; after: string | null; backorderedBefore: number; backorderedAfter: number }> = [];
      for (const [lineId, after] of sim.after) {
        if (lineId < 0) continue;
        const b = sim.before.get(lineId);
        if (!b) continue;
        if (b.effectivePromisedDate !== after.effectivePromisedDate || b.backorderedQty !== after.backorderedQty) {
          impactedOthers.push({
            lineId,
            before: b.effectivePromisedDate,
            after: after.effectivePromisedDate,
            backorderedBefore: b.backorderedQty,
            backorderedAfter: after.backorderedQty,
          });
        }
      }
      const orderPromise = lines.every((l) => l.promisedShipDate)
        ? lines.reduce<string | null>((max, l) => (max === null || (l.promisedShipDate as string) > max ? (l.promisedShipDate as string) : max), null)
        : null;
      const stock = (await this.inventory.matrix(tx, {})).filter((r) => skuIds.includes(r.skuId));

      return {
        persisted: false,
        customer: { name: dto.customerName, existing: !!customer, preferredLocation: customer?.preferredLocationId ? codeOf.get(customer.preferredLocationId) ?? null : null },
        requestedShipDate: dto.requestedShipDate ?? null,
        orderPromisedShipDate: orderPromise,
        fullyAllocated: lines.every((l) => l.backorderedQty === 0),
        totalBackorderedQty: lines.reduce((s, l) => s + l.backorderedQty, 0),
        lines,
        stock,
        impactedOtherOrders: impactedOthers.length,
        impactedOthers: impactedOthers.slice(0, 20),
        riskNote:
          dto.requestedShipDate && orderPromise && orderPromise > dto.requestedShipDate
            ? `Promised ${orderPromise} is ${diffDaysYmd(dto.requestedShipDate, orderPromise)} day(s) after the requested date.`
            : null,
      };
    });
  }

  /** Full chronological supply-demand timeline with an explanation of each promise. */
  async timeline(id: number, query: TimelineQueryDto) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { lines: { include: { sku: true, fulfillmentLocation: true } } } });
    if (!order) throw ApiError.notFound('Order', id);
    const lineIds = order.lines.map((l) => l.id);
    const skuIds = [...new Set(order.lines.map((l) => l.skuId))];

    return this.prisma.transact(async (tx) => {
      const receipts = await tx.inboundReceipt.findMany({ where: { skuId: { in: skuIds } }, include: { sku: true, location: true } });
      const [allocations, shipments, auditRows, exceptions, balances, ledgerRows] = await Promise.all([
        tx.allocation.findMany({ where: { orderLineId: { in: lineIds } }, include: { location: true, receipt: true, sku: true, orderLine: true } }),
        tx.shipment.findMany({ where: { orderId: id }, include: { location: true, lines: { include: { orderLine: { include: { sku: true } } } } } }),
        tx.auditLog.findMany({
          where: {
            OR: [
              { entityType: 'Order', entityId: String(id) },
              { entityType: 'OrderLine', entityId: { in: lineIds.map(String) } },
              { entityType: 'InboundReceipt', entityId: { in: receipts.map((r) => String(r.id)) } },
            ],
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.exception.findMany({ where: { orderId: id }, include: { sku: true, location: true } }),
        tx.inventoryBalance.findMany({ where: { skuId: { in: skuIds } }, include: { sku: true, location: true } }),
        tx.inventoryAdjustment.findMany({ where: { skuId: { in: skuIds }, createdAt: { gt: order.createdAt } } }),
      ]);

      type Ev = { at: Date; order: number; type: string; label: string; sku: string | null; location: string | null; quantity: number | null; reference: string | null; atpImpact: number | null; note: string | null; source: string };
      const events: Ev[] = [];
      const skuCode = (id: number) => order.lines.find((l) => l.skuId === id)?.sku.skuCode ?? null;
      const receiptById = new Map(receipts.map((r) => [r.id, r]));

      events.push({ at: order.createdAt, order: 0, type: 'ORDER_CREATED', label: `Order ${order.orderNumber} created`, sku: null, location: null, quantity: order.lines.reduce((s, l) => s + l.requestedQty, 0), reference: order.orderNumber, atpImpact: 0, note: `Priority ${order.priority}`, source: 'ORDER' });
      if (order.confirmedAt) {
        const open = order.lines.reduce((s, l) => s + l.requestedQty - l.shippedQty, 0);
        events.push({ at: order.confirmedAt, order: 1, type: 'ORDER_CONFIRMED', label: 'Order confirmed: demand committed to ATP', sku: null, location: null, quantity: open, reference: order.orderNumber, atpImpact: -open, note: 'Confirmed demand reduces ATP', source: 'ORDER' });
      }
      for (const l of order.lines) {
        events.push({ at: l.createdAt, order: 2, type: 'CUSTOMER_DEMAND', label: `Demand: ${l.requestedQty} units requested`, sku: l.sku.skuCode, location: null, quantity: l.requestedQty, reference: `${order.orderNumber}-L${l.lineNumber}`, atpImpact: 0, note: order.requestedShipDate ? `Requested ship ${toYmd(order.requestedShipDate)}` : 'No requested date', source: 'LINE' });
      }
      for (const b of balances) {
        if (!skuIds.includes(b.skuId)) continue;
        const later = ledgerRows.filter((a) => a.skuId === b.skuId && a.locationId === b.locationId).reduce((s, a) => s + a.quantityDelta, 0);
        const atOrder = b.onHand - later;
        if (atOrder > 0) {
          events.push({ at: order.createdAt, order: 0, type: 'OPENING_INVENTORY', label: `Opening on-hand ${atOrder}`, sku: b.sku.skuCode, location: b.location.locationCode, quantity: atOrder, reference: null, atpImpact: 0, note: 'Physical stock when the order was created', source: 'INVENTORY' });
        }
      }
      for (const r of receipts) {
        if (!skuIds.includes(r.skuId)) continue;
        events.push({ at: r.createdAt, order: 3, type: 'RECEIPT_EXPECTED', label: `Inbound ${r.receiptNumber} expected`, sku: r.sku.skuCode, location: r.location.locationCode, quantity: r.quantity, reference: r.receiptNumber, atpImpact: r.status === 'PLANNED' || r.status === 'IN_TRANSIT' ? r.quantity : 0, note: `Expected arrival ${toYmd(r.expectedArrivalTime)}`, source: 'RECEIPT' });
        if (r.status === 'RECEIVED' && r.receivedAt) {
          events.push({ at: r.receivedAt, order: 4, type: 'RECEIPT_RECEIVED', label: `Receipt ${r.receiptNumber} received into on-hand`, sku: r.sku.skuCode, location: r.location.locationCode, quantity: r.quantity, reference: r.receiptNumber, atpImpact: 0, note: 'Moves from inbound to on-hand; ATP unchanged', source: 'RECEIPT' });
        }
        if (r.status === 'CANCELED' && r.canceledAt) {
          events.push({ at: r.canceledAt, order: 4, type: 'RECEIPT_CANCELED', label: `Receipt ${r.receiptNumber} canceled`, sku: r.sku.skuCode, location: r.location.locationCode, quantity: r.quantity, reference: r.receiptNumber, atpImpact: -r.quantity, note: r.cancelReason ?? 'Removed from future ATP', source: 'RECEIPT' });
        }
      }
      for (const a of auditRows) {
        if (a.entityType === 'InboundReceipt' && (a.action === 'RECEIPT_DELAYED' || a.action === 'RECEIPT_EXPEDITED')) {
          const r = receiptById.get(Number(a.entityId));
          if (!r) continue;
          const nv = a.newValue as { expectedArrivalTime?: string } | null;
          events.push({ at: a.createdAt, order: 4, type: a.action === 'RECEIPT_DELAYED' ? 'RECEIPT_DELAYED' : 'RECEIPT_EXPEDITED', label: `${r.receiptNumber} ${a.action === 'RECEIPT_DELAYED' ? 'delayed' : 'expedited'} to ${nv?.expectedArrivalTime ? toYmd(nv.expectedArrivalTime) : '?'}`, sku: r.sku.skuCode, location: r.location.locationCode, quantity: r.quantity, reference: r.receiptNumber, atpImpact: 0, note: a.reason, source: 'AUDIT' });
        }
        if (a.entityType === 'OrderLine' && a.action === 'ALLOCATION_RECALCULATED') {
          const nv = a.newValue as { allocatedQty: number; backorderedQty: number; calculatedPromisedDate: string | null } | null;
          const line = order.lines.find((l) => String(l.id) === a.entityId);
          if (!nv || !line) continue;
          events.push({ at: a.createdAt, order: 5, type: nv.backorderedQty > 0 ? 'PARTIAL_ALLOCATION' : 'INVENTORY_ALLOCATED', label: nv.backorderedQty > 0 ? `Allocated ${nv.allocatedQty}, backordered ${nv.backorderedQty}` : `Allocated ${nv.allocatedQty} units`, sku: line.sku.skuCode, location: line.fulfillmentLocation?.locationCode ?? null, quantity: nv.allocatedQty, reference: order.orderNumber, atpImpact: 0, note: `${a.reason ?? 'Recalculated'} · promise ${nv.calculatedPromisedDate ?? 'none'}`, source: 'AUDIT' });
        }
        if (a.entityType === 'OrderLine' && a.action === 'PLANNER_PROMISE_OVERRIDE') {
          const line = order.lines.find((l) => String(l.id) === a.entityId);
          events.push({ at: a.createdAt, order: 6, type: 'PROMISE_OVERRIDE', label: 'Manual promise override', sku: line?.sku.skuCode ?? null, location: null, quantity: null, reference: order.orderNumber, atpImpact: 0, note: a.reason, source: 'PLANNER' });
        }
      }
      for (const al of allocations) {
        if (al.status === 'RELEASED' && al.releasedAt) {
          events.push({ at: al.releasedAt, order: 5, type: 'ALLOCATION_RELEASED', label: `Released ${al.quantity} units from ${al.sourceType === 'INBOUND' ? al.receipt?.receiptNumber : 'on-hand'}`, sku: al.sku.skuCode, location: al.location.locationCode, quantity: al.quantity, reference: al.receipt?.receiptNumber ?? null, atpImpact: 0, note: al.releaseReason ?? 'Recalculated', source: 'ALLOCATION' });
        }
      }
      for (const s of shipments) {
        for (const sl of s.lines) {
          events.push({ at: s.shippedAt, order: 7, type: s.isSplit ? 'PARTIAL_SHIPMENT' : 'SHIPMENT', label: `${s.isSplit ? 'Split shipment' : 'Shipment'} ${s.shipmentNumber}: ${sl.quantity} units`, sku: sl.orderLine.sku.skuCode, location: s.location.locationCode, quantity: sl.quantity, reference: s.shipmentNumber, atpImpact: 0, note: s.reason ?? (sl.onTime ? 'On time' : 'Late vs promise'), source: 'SHIPMENT' });
        }
      }
      for (const e of exceptions) {
        events.push({ at: e.createdAt, order: 8, type: 'EXCEPTION_RAISED', label: `${e.type.replace(/_/g, ' ').toLowerCase()} (${e.severity})`, sku: e.sku.skuCode, location: e.location?.locationCode ?? null, quantity: e.affectedQty, reference: e.exceptionNumber, atpImpact: null, note: e.recommendedAction, source: 'EXCEPTION' });
      }
      if (order.status === 'CANCELED' && order.canceledAt) {
        const released = order.lines.reduce((s, l) => s + (l.requestedQty - l.shippedQty), 0);
        events.push({ at: order.canceledAt, order: 9, type: 'ORDER_CANCELED', label: 'Order canceled: allocations released to ATP', sku: null, location: null, quantity: released, reference: order.orderNumber, atpImpact: released, note: 'Released supply is available to other orders', source: 'ORDER' });
      }

      let filtered = events;
      if (query.skuId) filtered = filtered.filter((e) => e.sku === null || e.sku === skuCode(query.skuId as number));
      if (query.locationId) {
        const code = (await tx.location.findUnique({ where: { id: query.locationId } }))?.locationCode;
        filtered = filtered.filter((e) => e.location === null || e.location === code);
      }
      filtered.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);

      const explanations = await this.promiseExplanations(tx, order.lines.map((l) => l.id));
      return {
        orderId: id,
        orderNumber: order.orderNumber,
        events: filtered.map((e) => ({
          at: e.at.toISOString(),
          type: e.type,
          label: e.label,
          sku: e.sku,
          location: e.location,
          quantity: e.quantity,
          reference: e.reference,
          atpImpact: e.atpImpact,
          note: e.note,
          source: e.source,
        })),
        promiseExplanations: explanations,
      };
    });
  }

  // ---------------------------------------------------------------- commands

  async create(dto: CreateOrderDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      if (await tx.order.findUnique({ where: { orderNumber: dto.orderNumber } })) {
        throw ApiError.conflict('ORDER_NUMBER_EXISTS', `Order number ${dto.orderNumber} already exists`);
      }
      await this.checkLocation(tx, dto.preferredLocationId);
      const resolved = await this.resolveLines(tx, dto.lines);
      const customer = await this.customers.findOrCreate(tx, dto.customerName.trim());
      await this.allocation.lockSkus(tx, resolved.map((r) => r.skuId));

      const order = await tx.order.create({
        data: {
          orderNumber: dto.orderNumber,
          customerId: customer.id,
          priority: dto.priority,
          priorityRank: priorityRank(dto.priority),
          status: 'DRAFT',
          requestedShipDate: dto.requestedShipDate ? parseDateInput(dto.requestedShipDate, 'requestedShipDate') : null,
          preferredLocationId: dto.preferredLocationId ?? null,
          createdById: actorId,
          lines: {
            create: resolved.map((r, i) => ({
              lineNumber: i + 1,
              skuId: r.skuId,
              requestedQty: r.quantity,
              preferredLocationId: r.preferredLocationId ?? null,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Order',
        entityId: order.id,
        action: 'ORDER_CREATED',
        newValue: { orderNumber: order.orderNumber, customer: customer.name, priority: order.priority, lines: resolved.length },
        reason: 'Order created',
      });

      if (dto.confirm) {
        await this.confirmInTx(tx, order.id, actorId, null);
      }
      return this.detailInTx(tx, order.id);
    });
  }

  async update(id: number, dto: UpdateOrderDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      // Lock order: first read the lines to know which SKUs are involved, then lock SKUs
      // (ascending id) and the order row. Same order as every other writer => no deadlock.
      const pre = await tx.orderLine.findMany({ where: { orderId: id }, select: { skuId: true } });
      const newResolved = dto.addLines?.length ? await this.resolveLines(tx, dto.addLines) : [];
      const newSkus = newResolved.map((r) => r.skuId);
      await this.allocation.lockSkus(tx, [...pre.map((p) => p.skuId), ...newSkus]);
      await this.lockOrderRow(tx, id, dto.version);

      const order = await tx.order.findUnique({ where: { id }, include: { lines: { orderBy: { lineNumber: 'asc' } }, customer: true } });
      if (!order) throw ApiError.notFound('Order', id);
      if (!EDITABLE.includes(order.status)) {
        throw ApiError.conflict('ORDER_NOT_EDITABLE', `An order that is ${order.status} cannot be edited`);
      }
      const before = orderSnapshot(order);

      if (dto.preferredLocationId !== undefined) await this.checkLocation(tx, dto.preferredLocationId);

      // header
      const headerData: Prisma.OrderUpdateInput = {};
      if (dto.priority) {
        headerData.priority = dto.priority;
        headerData.priorityRank = priorityRank(dto.priority);
      }
      if (dto.requestedShipDate !== undefined) {
        headerData.requestedShipDate = dto.requestedShipDate ? parseDateInput(dto.requestedShipDate, 'requestedShipDate') : null;
      }
      if (dto.preferredLocationId !== undefined) {
        headerData.preferredLocation = dto.preferredLocationId ? { connect: { id: dto.preferredLocationId } } : { disconnect: true };
      }
      if (dto.customerName && dto.customerName.trim() !== order.customer.name) {
        const c = await this.customers.findOrCreate(tx, dto.customerName.trim());
        headerData.customer = { connect: { id: c.id } };
      }

      // line edits
      for (const u of dto.updateLines ?? []) {
        const line = order.lines.find((l) => l.id === u.lineId);
        if (!line || line.canceledAt) throw ApiError.badRequest('LINE_NOT_FOUND', `Line ${u.lineId} is not part of this order`);
        if (u.quantity !== undefined && u.quantity < line.shippedQty) {
          throw ApiError.unprocessable('QTY_BELOW_SHIPPED', `Line ${line.lineNumber} has already shipped ${line.shippedQty} units`);
        }
        if (u.preferredLocationId !== undefined) await this.checkLocation(tx, u.preferredLocationId);
        await tx.orderLine.update({
          where: { id: line.id },
          data: {
            requestedQty: u.quantity ?? undefined,
            preferredLocationId: u.preferredLocationId === undefined ? undefined : u.preferredLocationId,
            version: { increment: 1 },
          },
        });
      }

      for (const rid of dto.removeLineIds ?? []) {
        const line = order.lines.find((l) => l.id === rid);
        if (!line || line.canceledAt) throw ApiError.badRequest('LINE_NOT_FOUND', `Line ${rid} is not part of this order`);
        if (line.shippedQty > 0) throw ApiError.unprocessable('LINE_HAS_SHIPMENTS', `Line ${line.lineNumber} has shipments and cannot be removed`);
      }
      if (dto.removeLineIds?.length) {
        // Soft-remove: history is preserved; the engine ignores canceled lines and releases their allocations.
        await tx.orderLine.updateMany({ where: { id: { in: dto.removeLineIds } }, data: { canceledAt: new Date() } });
      }

      if (newResolved.length) {
        const resolved = newResolved;
        let next = Math.max(0, ...order.lines.map((l) => l.lineNumber));
        for (const r of resolved) {
          next += 1;
          await tx.orderLine.create({
            data: { orderId: id, lineNumber: next, skuId: r.skuId, requestedQty: r.quantity, preferredLocationId: r.preferredLocationId ?? null },
          });
        }
      }

      const headerChanged = Object.keys(headerData).length > 0;
      if (headerChanged) {
        await tx.order.update({ where: { id }, data: { ...headerData, version: { increment: 1 } } });
      } else {
        await tx.order.update({ where: { id }, data: { version: { increment: 1 } } });
      }

      const reloaded = await tx.order.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNumber: 'asc' } }, customer: true } });
      const after = orderSnapshot(reloaded);
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Order',
        entityId: id,
        action: 'ORDER_UPDATED',
        previousValue: before,
        newValue: after,
        reason: dto.reason ?? 'Order edited',
      });

      const skuIds = [...new Set([...pre.map((p) => p.skuId), ...newSkus, ...reloaded.lines.map((l) => l.skuId)])];
      const recalc = await this.allocation.recalculate(tx, skuIds, { actorId, reason: `Order ${order.orderNumber} edited` });
      return { ...(await this.detailInTx(tx, id)), recalculation: summarize(recalc) };
    });
  }

  async confirm(id: number, dto: VersionDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const pre = await tx.orderLine.findMany({ where: { orderId: id }, select: { skuId: true } });
      await this.allocation.lockSkus(tx, pre.map((p) => p.skuId));
      await this.lockOrderRow(tx, id, dto.version);
      await this.confirmInTx(tx, id, actorId, dto.version ?? null);
      return this.detailInTx(tx, id);
    });
  }

  private async confirmInTx(tx: Tx, id: number, actorId: number, _version: number | null) {
    const order = await tx.order.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw ApiError.notFound('Order', id);
    if (order.status !== 'DRAFT') {
      throw ApiError.conflict('ORDER_NOT_DRAFT', `Only DRAFT orders can be confirmed; this order is ${order.status}`);
    }
    const open = order.lines.filter((l) => !l.canceledAt && l.requestedQty - l.shippedQty > 0);
    if (open.length === 0) throw ApiError.unprocessable('NO_OPEN_LINES', 'An order needs at least one open line to be confirmed');
    await tx.order.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } } });
    await this.audit.record(tx, {
      userId: actorId,
      entityType: 'Order',
      entityId: id,
      action: 'ORDER_CONFIRMED',
      previousValue: { status: 'DRAFT' },
      newValue: { status: 'CONFIRMED', lines: open.length },
      reason: 'Order confirmed; demand reserved against ATP',
    });
    const recalc = await this.allocation.recalculate(tx, [...new Set(order.lines.map((l) => l.skuId))], {
      actorId,
      reason: `Order ${order.orderNumber} confirmed`,
    });
    return recalc;
  }

  async cancel(id: number, dto: CancelOrderDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const pre = await tx.orderLine.findMany({ where: { orderId: id }, select: { skuId: true } });
      await this.allocation.lockSkus(tx, pre.map((p) => p.skuId));
      await this.lockOrderRow(tx, id, dto.version);
      const order = await tx.order.findUnique({ where: { id }, include: { lines: true } });
      if (!order) throw ApiError.notFound('Order', id);
      if (order.status === 'CANCELED') {
        return { ...(await this.detailInTx(tx, id)), idempotent: true };
      }
      if (order.status === 'SHIPPED') throw ApiError.conflict('ORDER_ALREADY_SHIPPED', 'A shipped order cannot be canceled');
      if (order.lines.some((l) => l.shippedQty > 0)) {
        throw ApiError.conflict('ORDER_PARTIALLY_SHIPPED', 'Part of this order has already shipped; remove the open lines instead of canceling');
      }
      const releasedAllocations = await tx.allocation.count({ where: { orderLine: { orderId: id }, status: 'ACTIVE' } });
      const releasedUnits = order.lines.reduce((s, l) => s + (l.requestedQty - l.shippedQty), 0);
      await tx.order.update({
        where: { id },
        data: { status: 'CANCELED', canceledAt: new Date(), version: { increment: 1 } },
      });
      await tx.orderLine.updateMany({ where: { orderId: id, canceledAt: null }, data: { canceledAt: new Date() } });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Order',
        entityId: id,
        action: 'ORDER_CANCELED',
        previousValue: { status: order.status },
        newValue: { status: 'CANCELED', releasedUnits, releasedAllocations },
        reason: dto.reason,
      });
      const recalc = await this.allocation.recalculate(tx, [...new Set(order.lines.map((l) => l.skuId))], {
        actorId,
        reason: `Order ${order.orderNumber} canceled: ${dto.reason}`,
      });
      return { ...(await this.detailInTx(tx, id)), releasedUnits, releasedAllocations, idempotent: false, recalculation: summarize(recalc) };
    });
  }

  /**
   * Ships quantities from on-hand stock that is allocated to the lines. Units that are only allocated
   * from inbound receipts cannot ship until those receipts are received (they are not on-hand yet).
   * Creates a Shipment, decrements on-hand through the ledger, and recalculates the remainder, which
   * stays allocated or backordered.
   */
  async ship(id: number, dto: ShipOrderDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const pre = await tx.orderLine.findMany({ where: { orderId: id, id: { in: dto.lines.map((l) => l.orderLineId) } }, select: { skuId: true } });
      if (pre.length !== dto.lines.length) {
        throw ApiError.badRequest('LINE_NOT_FOUND', 'One or more lines do not belong to this order');
      }
      await this.allocation.lockSkus(tx, pre.map((p) => p.skuId));
      await this.lockOrderRow(tx, id, dto.version);
      const order = await tx.order.findUnique({ where: { id }, include: { lines: true } });
      if (!order) throw ApiError.notFound('Order', id);
      if (!OPEN_ORDER.includes(order.status)) {
        throw ApiError.conflict('ORDER_NOT_SHIPPABLE', `An order that is ${order.status} cannot ship`);
      }
      const today = todayYmd();
      const plan: Array<{ line: OrderLine; qty: number; promised: Date | null; onTime: boolean; draws: Array<{ locationId: number; qty: number; code: string }> }> = [];

      for (const req of dto.lines) {
        const line = order.lines.find((l) => l.id === req.orderLineId);
        if (!line || line.canceledAt) throw ApiError.badRequest('LINE_NOT_FOUND', `Line ${req.orderLineId} is not part of this order`);
        const open = line.requestedQty - line.shippedQty;
        if (req.quantity > open) {
          throw ApiError.unprocessable('QTY_EXCEEDS_OPEN', `Only ${open} units remain open on line ${line.lineNumber}`);
        }
        const onHandAlloc = await tx.allocation.findMany({
          where: { orderLineId: line.id, status: 'ACTIVE', sourceType: 'ON_HAND', availableDate: { lte: new Date(`${today}T00:00:00.000Z`) } },
          include: { location: true },
          orderBy: [{ location: { locationCode: 'asc' } }, { id: 'asc' }],
        });
        const shippable = onHandAlloc.reduce((s, a) => s + a.quantity, 0);
        if (shippable < req.quantity) {
          throw ApiError.unprocessable('SHIP_QTY_NOT_AVAILABLE', `Line ${line.lineNumber}: ${req.quantity} requested but only ${shippable} units are allocated from on-hand stock`, {
            orderLineId: line.id,
            requested: req.quantity,
            shippableNow: shippable,
          });
        }
        let remaining = req.quantity;
        const draws: Array<{ locationId: number; qty: number; code: string }> = [];
        for (const a of onHandAlloc) {
          if (remaining === 0) break;
          const take = Math.min(remaining, a.quantity);
          draws.push({ locationId: a.locationId, qty: take, code: a.location.locationCode });
          remaining -= take;
        }
        const promised = line.manualPromisedDate ?? line.calculatedPromisedDate;
        plan.push({ line, qty: req.quantity, promised, onTime: promised ? today <= toYmd(promised) : false, draws });
      }

      const shipment = await tx.shipment.create({
        data: {
          shipmentNumber: await this.sequence.formatted(tx, 'shipment', 'SHP'),
          orderId: id,
          locationId: plan[0].draws[0]?.locationId ?? (plan[0].line.fulfillmentLocationId as number),
          shippedAt: new Date(),
          isSplit: dto.isSplit ?? (dto.lines.length < order.lines.length || plan.some((p) => p.qty < p.line.requestedQty - p.line.shippedQty)),
          reason: dto.reason ?? null,
          createdById: actorId,
        },
      });

      for (const p of plan) {
        const sl = await tx.shipmentLine.create({
          data: { shipmentId: shipment.id, orderLineId: p.line.id, skuId: p.line.skuId, quantity: p.qty, promisedDate: p.promised, onTime: p.onTime },
        });
        for (const d of p.draws) {
          await this.ledger.post(tx, {
            skuId: p.line.skuId,
            locationId: d.locationId,
            delta: -d.qty,
            movementType: 'SHIPMENT',
            reason: `Shipment ${shipment.shipmentNumber} · ${order.orderNumber}`,
            referenceKey: `SHIPMENT:${shipment.id}:${sl.id}:${d.locationId}`,
            userId: actorId,
          });
        }
        await tx.orderLine.update({ where: { id: p.line.id }, data: { shippedQty: { increment: p.qty }, version: { increment: 1 } } });
      }

      const reloaded = await tx.orderLine.findMany({ where: { orderId: id, canceledAt: null } });
      const allShipped = reloaded.every((l) => l.shippedQty >= l.requestedQty);
      const nextStatus = allShipped ? 'SHIPPED' : 'FULFILLING';
      await tx.order.update({
        where: { id },
        data: { status: nextStatus, ...(allShipped ? { shippedAt: new Date() } : {}), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Shipment',
        entityId: shipment.id,
        action: shipment.isSplit ? 'SPLIT_SHIPMENT_CREATED' : 'SHIPMENT_CREATED',
        newValue: { shipmentNumber: shipment.shipmentNumber, lines: plan.map((p) => ({ line: p.line.lineNumber, qty: p.qty })) },
        reason: dto.reason ?? (shipment.isSplit ? 'Partial shipment' : 'Shipment'),
        metadata: { orderId: id, orderNumber: order.orderNumber },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Order',
        entityId: id,
        action: nextStatus === 'SHIPPED' ? 'ORDER_SHIPPED' : 'ORDER_FULFILLMENT_PROGRESS',
        previousValue: { status: order.status },
        newValue: { status: nextStatus },
        reason: dto.reason ?? `Shipment ${shipment.shipmentNumber}`,
      });

      const recalc = await this.allocation.recalculate(tx, [...new Set(plan.map((p) => p.line.skuId))], {
        actorId,
        reason: `Shipment ${shipment.shipmentNumber} posted`,
      });
      return {
        shipment: { id: shipment.id, shipmentNumber: shipment.shipmentNumber, shippedAt: shipment.shippedAt.toISOString(), isSplit: shipment.isSplit },
        orderStatus: nextStatus,
        lines: plan.map((p) => ({ orderLineId: p.line.id, quantity: p.qty, promisedDate: nullableDateToYmd(p.promised), onTime: p.onTime })),
        recalculation: summarize(recalc),
      };
    });
  }

  // ---------------------------------------------------------------- communications

  async communications(id: number) {
    const rows = await this.prisma.customerCommunication.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: true, aiInteraction: true },
    });
    return rows.map((c) => ({
      id: c.id,
      channel: c.channel,
      subject: c.subject,
      body: c.body,
      status: c.status,
      sentAt: c.sentAt?.toISOString() ?? null,
      createdBy: c.createdBy?.name ?? null,
      aiInteractionId: c.aiInteractionId,
      aiGenerated: !!c.aiInteractionId,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  /** Saves a sent-message record. Actual email delivery is out of scope (per specification). */
  async recordCommunication(id: number, dto: CommunicationDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw ApiError.notFound('Order', id);
      if (dto.aiInteractionId) {
        const ai = await tx.aIInteraction.findUnique({ where: { id: dto.aiInteractionId } });
        if (!ai || ai.type !== 'CUSTOMER_COMMUNICATION') {
          throw ApiError.badRequest('AI_INTERACTION_INVALID', 'aiInteractionId must refer to a customer communication draft');
        }
      }
      const c = await tx.customerCommunication.create({
        data: {
          orderId: id,
          subject: dto.subject,
          body: dto.body,
          status: 'SENT',
          sentAt: new Date(),
          aiInteractionId: dto.aiInteractionId ?? null,
          createdById: actorId,
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Order',
        entityId: id,
        action: 'CUSTOMER_COMMUNICATION_SENT',
        newValue: { communicationId: c.id, subject: c.subject },
        reason: 'Customer update recorded as sent',
      });
      return { id: c.id, status: c.status, sentAt: c.sentAt?.toISOString() ?? null };
    });
  }

  // ---------------------------------------------------------------- helpers

  private async detailInTx(tx: Tx, id: number) {
    const order = await tx.order.findUnique({
      where: { id },
      include: {
        customer: { include: { preferredLocation: true } },
        preferredLocation: true,
        createdBy: true,
        lines: {
          where: { canceledAt: null },
          orderBy: { lineNumber: 'asc' },
          include: {
            sku: true,
            preferredLocation: true,
            fulfillmentLocation: true,
            allocations: { where: { status: 'ACTIVE' }, include: { location: true, receipt: true }, orderBy: [{ sourceType: 'asc' }, { availableDate: 'asc' }, { id: 'asc' }] },
          },
        },
        shipments: { include: { location: true, lines: { include: { orderLine: { include: { sku: true } } } } }, orderBy: { shippedAt: 'asc' } },
        exceptions: { where: { status: 'OPEN' }, orderBy: [{ severityRank: 'asc' }, { id: 'asc' }] },
        _count: { select: { communications: true } },
      },
    });
    if (!order) throw ApiError.notFound('Order', id);
    return orderDetailDto(order, todayYmd());
  }

  private async lockOrderRow(tx: Tx, id: number, expectedVersion?: number) {
    const rows = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM \`Order\` WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw ApiError.notFound('Order', id);
    if (expectedVersion !== undefined && rows[0].version !== expectedVersion) {
      throw ApiError.conflict(
        'VERSION_CONFLICT',
        'This order was changed by someone else (or by a recalculation). Reload the order and try again.',
        { currentVersion: rows[0].version, expectedVersion },
      );
    }
  }

  private async checkLocation(tx: Tx, locationId: number | null | undefined) {
    if (!locationId) return;
    const loc = await tx.location.findUnique({ where: { id: locationId } });
    if (!loc) throw ApiError.notFound('Location', locationId);
    if (!loc.isActive) throw ApiError.badRequest('LOCATION_INACTIVE', `Location ${loc.locationCode} is inactive`);
  }

  /** Resolves SKUs (by id or code) and validates quantities. */
  private async resolveLines(tx: Tx, lines: OrderLineInputDto[]) {
    const ids = lines.map((l) => l.skuId).filter((v): v is number => typeof v === 'number');
    const codes = lines.map((l) => l.skuCode).filter((v): v is string => !!v);
    const skus = await tx.sku.findMany({ where: { OR: [{ id: { in: ids } }, { skuCode: { in: codes } }] } });
    const out: Array<{ skuId: number; skuCode: string; productName: string; quantity: number; preferredLocationId: number | null | undefined }> = [];
    for (const l of lines) {
      const sku = skus.find((s) => (l.skuId !== undefined ? s.id === l.skuId : s.skuCode === l.skuCode));
      if (!sku) {
        throw ApiError.badRequest('SKU_NOT_FOUND', `SKU ${l.skuId ?? l.skuCode} does not exist`);
      }
      if (!Number.isInteger(l.quantity) || l.quantity < 1) {
        throw ApiError.badRequest('INVALID_QUANTITY', `Quantity for ${sku.skuCode} must be a positive whole number`);
      }
      if (l.preferredLocationId) await this.checkLocation(tx, l.preferredLocationId);
      out.push({ skuId: sku.id, skuCode: sku.skuCode, productName: sku.name, quantity: l.quantity, preferredLocationId: l.preferredLocationId ?? null });
    }
    return out;
  }

  private async promiseExplanations(tx: Tx, lineIds: number[]) {
    const lines = await tx.orderLine.findMany({
      where: { id: { in: lineIds } },
      include: { sku: true, allocations: { where: { status: 'ACTIVE' }, include: { location: true, receipt: true } }, order: true },
      orderBy: { lineNumber: 'asc' },
    });
    return lines.map((l) => {
      const promised = nullableDateToYmd(l.manualPromisedDate ?? l.calculatedPromisedDate);
      const parts = l.allocations
        .sort((a, b) => toYmd(a.availableDate).localeCompare(toYmd(b.availableDate)))
        .map((a) =>
          a.sourceType === 'ON_HAND'
            ? `${a.quantity} from ${a.location.locationCode} on-hand (available ${toYmd(a.availableDate)})`
            : `${a.quantity} from ${a.receipt?.receiptNumber} at ${a.location.locationCode} (arrives ${toYmd(a.availableDate)})`,
        );
      let text: string;
      if (l.manualPromisedDate) {
        text = `Manual override: promise set to ${toYmd(l.manualPromisedDate)}. Calculated promise: ${nullableDateToYmd(l.calculatedPromisedDate) ?? 'none'}.`;
      } else if (l.allocatedQty === 0) {
        text = promised
          ? `No allocated supply yet. Promise ${promised} is an estimate from the SKU lead time (${l.sku.leadTimeDays ?? 'n/a'} days).`
          : 'No supply and no lead time: no promise can be committed.';
      } else {
        text = `Promise ${promised} is the latest availability of ${parts.join(' + ')}.`;
        if (l.backorderedQty > 0) text += ` ${l.backorderedQty} unit(s) are backordered; the promise includes the lead-time estimate for them.`;
      }
      return { lineId: l.id, lineNumber: l.lineNumber, sku: l.sku.skuCode, promised, allocations: parts, backorderedQty: l.backorderedQty, explanation: text };
    });
  }
}

// ---------------------------------------------------------------- DTO mappers

export function priorityRank(p: Priority): number {
  return p === 'HIGH' ? 0 : p === 'MED' ? 1 : 2;
}

function listDto(o: Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>) {
  const openLines = o.lines.filter((l) => !l.canceledAt && l.requestedQty - l.shippedQty > 0);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.customer.name,
    priority: o.priority,
    status: o.status,
    allocationStatus: o.allocationStatus,
    riskLevel: o.riskLevel,
    createdAt: o.createdAt.toISOString(),
    requestedShipDate: nullableDateToYmd(o.requestedShipDate),
    promisedShipDate: nullableDateToYmd(o.promisedShipDate),
    backorderedQty: o.backorderedQty,
    lineCount: openLines.length,
    unitsRequested: o.lines.reduce((s, l) => s + l.requestedQty, 0),
    openExceptions: o.exceptions.length,
    topExceptionType: o.exceptions.length ? o.exceptions.sort((a, b) => a.severity.localeCompare(b.severity))[0].type : null,
    isLate: !!o.requestedShipDate && !!o.promisedShipDate && toYmd(o.promisedShipDate) > toYmd(o.requestedShipDate),
  };
}

function orderSnapshot(o: Order & { lines: OrderLine[]; customer: { name: string } }) {
  return {
    customer: o.customer.name,
    priority: o.priority,
    status: o.status,
    requestedShipDate: nullableDateToYmd(o.requestedShipDate),
    preferredLocationId: o.preferredLocationId,
    lines: o.lines
      .filter((l) => !l.canceledAt)
      .map((l) => ({ lineId: l.id, lineNumber: l.lineNumber, skuId: l.skuId, quantity: l.requestedQty, shipped: l.shippedQty, preferredLocationId: l.preferredLocationId })),
  };
}

type DetailOrder = Prisma.OrderGetPayload<{
  include: {
    customer: { include: { preferredLocation: true } };
    preferredLocation: true;
    createdBy: true;
    lines: {
      include: {
        sku: true;
        preferredLocation: true;
        fulfillmentLocation: true;
        allocations: { include: { location: true; receipt: true } };
      };
    };
    shipments: { include: { location: true; lines: { include: { orderLine: { include: { sku: true } } } } } };
    exceptions: true;
    _count: { select: { communications: true } };
  };
}>;

export function orderDetailDto(o: DetailOrder, today: string) {
  const open = o.lines.filter((l) => l.requestedQty - l.shippedQty > 0);
  const effective = (l: DetailOrder['lines'][number]) => nullableDateToYmd(l.manualPromisedDate ?? l.calculatedPromisedDate);
  const allPromised = open.map(effective);
  const orderPromise = open.length && allPromised.every((d) => d !== null) ? allPromised.reduce<string>((m, d) => (d as string) > m ? (d as string) : m, allPromised[0] as string) : null;
  const earliest = open.map((l) => nullableDateToYmd(l.earliestShipDate)).filter((d): d is string => !!d).sort()[0] ?? null;
  const dependencies = new Map<number, { receiptId: number; receiptNumber: string; status: string; expectedArrival: string; originalExpectedArrival: string; delayDays: number; location: string; sku: string; quantity: number; lines: number[] }>();
  for (const l of o.lines) {
    for (const a of l.allocations) {
      if (a.sourceType !== 'INBOUND' || !a.receipt) continue;
      const cur = dependencies.get(a.receipt.id) ?? {
        receiptId: a.receipt.id,
        receiptNumber: a.receipt.receiptNumber,
        status: a.receipt.status,
        expectedArrival: toYmd(a.receipt.expectedArrivalTime),
        originalExpectedArrival: toYmd(a.receipt.originalExpectedArrivalTime),
        delayDays: diffDaysYmd(toYmd(a.receipt.originalExpectedArrivalTime), toYmd(a.receipt.expectedArrivalTime)),
        location: a.location.locationCode,
        sku: l.sku.skuCode,
        quantity: 0,
        lines: [],
      };
      cur.quantity += a.quantity;
      if (!cur.lines.includes(l.lineNumber)) cur.lines.push(l.lineNumber);
      dependencies.set(a.receipt.id, cur);
    }
  }
  const status = (l: DetailOrder['lines'][number]) => l.allocationStatus;
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customer: { id: o.customer.id, name: o.customer.name, preferredLocation: o.customer.preferredLocation ? { id: o.customer.preferredLocation.id, locationCode: o.customer.preferredLocation.locationCode } : null },
    priority: o.priority,
    status: o.status,
    allocationStatus: o.allocationStatus,
    riskLevel: o.riskLevel,
    preferredLocation: o.preferredLocation ? { id: o.preferredLocation.id, locationCode: o.preferredLocation.locationCode } : null,
    createdAt: o.createdAt.toISOString(),
    confirmedAt: o.confirmedAt?.toISOString() ?? null,
    shippedAt: o.shippedAt?.toISOString() ?? null,
    canceledAt: o.canceledAt?.toISOString() ?? null,
    requestedShipDate: nullableDateToYmd(o.requestedShipDate),
    promisedShipDate: nullableDateToYmd(o.promisedShipDate),
    orderPromiseFromLines: orderPromise,
    version: o.version,
    communicationCount: o._count.communications,
    isEditable: EDITABLE.includes(o.status),
    lines: o.lines.map((l) => ({
      id: l.id,
      lineNumber: l.lineNumber,
      sku: { id: l.skuId, skuCode: l.sku.skuCode, name: l.sku.name, leadTimeDays: l.sku.leadTimeDays },
      requestedQty: l.requestedQty,
      shippedQty: l.shippedQty,
      openQty: l.requestedQty - l.shippedQty,
      allocatedQty: l.allocatedQty,
      backorderedQty: l.backorderedQty,
      allocationStatus: status(l),
      preferredLocation: l.preferredLocation ? { id: l.preferredLocation.id, locationCode: l.preferredLocation.locationCode } : null,
      fulfillmentLocation: l.fulfillmentLocation ? { id: l.fulfillmentLocation.id, locationCode: l.fulfillmentLocation.locationCode } : null,
      calculatedPromisedDate: nullableDateToYmd(l.calculatedPromisedDate),
      manualPromisedDate: nullableDateToYmd(l.manualPromisedDate),
      manualPromiseReason: l.manualPromiseReason,
      effectivePromisedDate: effective(l),
      earliestShipDate: nullableDateToYmd(l.earliestShipDate),
      expectedCompletionDate: nullableDateToYmd(l.expectedCompletionDate),
      version: l.version,
      allocations: l.allocations.map((a) => ({
        id: a.id,
        location: a.location.locationCode,
        source: a.sourceType,
        receiptId: a.receiptId,
        receiptNumber: a.receipt?.receiptNumber ?? null,
        receiptStatus: a.receipt?.status ?? null,
        receiptExpectedArrival: a.receipt ? toYmd(a.receipt.expectedArrivalTime) : null,
        quantity: a.quantity,
        availableDate: toYmd(a.availableDate),
      })),
    })),
    summary: {
      lineCount: open.length,
      fullyAllocatedLines: open.filter((l) => l.allocationStatus === 'FULLY_ALLOCATED').length,
      partiallyAllocatedLines: open.filter((l) => l.allocationStatus === 'PARTIALLY_ALLOCATED').length,
      backorderedLines: open.filter((l) => l.allocationStatus === 'BACKORDERED').length,
      totalRequested: open.reduce((s, l) => s + l.requestedQty, 0),
      totalAllocated: open.reduce((s, l) => s + l.allocatedQty, 0),
      totalShipped: o.lines.reduce((s, l) => s + l.shippedQty, 0),
      backorderedUnits: open.reduce((s, l) => s + l.backorderedQty, 0),
      earliestPossibleShipment: earliest,
      expectedCompletionDate: orderPromise,
      requestedShipDate: nullableDateToYmd(o.requestedShipDate),
      daysLate: o.requestedShipDate && orderPromise ? Math.max(0, diffDaysYmd(toYmd(o.requestedShipDate), orderPromise)) : 0,
      asOf: today,
    },
    supplyDependencies: [...dependencies.values()],
    shipments: o.shipments.map((s) => ({
      id: s.id,
      shipmentNumber: s.shipmentNumber,
      shippedAt: s.shippedAt.toISOString(),
      location: s.location.locationCode,
      isSplit: s.isSplit,
      reason: s.reason,
      lines: s.lines.map((sl) => ({ sku: sl.orderLine.sku.skuCode, quantity: sl.quantity, promisedDate: nullableDateToYmd(sl.promisedDate), onTime: sl.onTime })),
    })),
    openExceptions: o.exceptions.map((e) => ({ id: e.id, exceptionNumber: e.exceptionNumber, type: e.type, severity: e.severity, affectedQty: e.affectedQty })),
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
