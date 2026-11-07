import { Injectable } from '@nestjs/common';
import { Prisma, Priority } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api/api-error';
import { paginate, Paginated } from '../common/api/api.interceptors';
import { nullableDateToYmd, ymdToDate } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { SequenceService } from '../common/sequence/sequence.service';
import {
  AUTO_RESOLVABLE_TYPES,
  DesiredException,
  ExceptionTypeName,
  SeverityName,
} from '../allocation/exception-rules';

export const EXCEPTION_SEVERITY_RANK: Record<SeverityName, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export const EXCEPTION_PRIORITY_RANK: Record<Priority, number> = { HIGH: 0, MED: 1, LOW: 2 };

export interface LineMeta {
  orderId: number;
  skuId: number;
  priority: Priority;
  requestedShipDate: string | null;
}

export interface ExceptionListQuery {
  page: number;
  pageSize: number;
  search?: string;
  severity?: SeverityName;
  type?: ExceptionTypeName;
  priority?: Priority;
  status?: 'OPEN' | 'RESOLVED';
  sort?: 'risk' | 'created' | 'promised' | 'qty';
}

export const openKeyFor = (lineId: number, type: string, reference: string) =>
  `${lineId}|${type}|${reference || '0'}`;

@Injectable()
export class ExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
  ) {}

  /**
   * Reconciles desired exceptions for a set of order lines with the database.
   *  - creates exceptions that should be open but are not
   *  - refreshes open exceptions whose severity/quantity/promise changed
   *  - auto-resolves auto-type exceptions whose condition has cleared
   * CANCELED_INBOUND_DEPENDENCY exceptions are event-based and are only resolved by a planner.
   */
  async reconcile(
    tx: Tx,
    params: {
      lineIds: number[];
      lineMeta: Map<number, LineMeta>;
      desiredByLine: Map<number, DesiredException[]>;
      actorId: number | null;
    },
  ): Promise<{ created: number; resolved: number }> {
    if (params.lineIds.length === 0) return { created: 0, resolved: 0 };

    const open = await tx.exception.findMany({
      where: { orderLineId: { in: params.lineIds }, status: 'OPEN' },
    });
    const openByKey = new Map(open.map((e) => [e.openKey as string, e]));
    const desiredKeys = new Set<string>();
    let created = 0;
    let resolved = 0;

    for (const lineId of params.lineIds) {
      const meta = params.lineMeta.get(lineId);
      if (!meta) continue;
      for (const d of params.desiredByLine.get(lineId) ?? []) {
        const key = openKeyFor(lineId, d.type, d.reference);
        desiredKeys.add(key);
        const existing = openByKey.get(key);
        if (existing) {
          if (existing.severity !== d.severity || existing.affectedQty !== d.affectedQty) {
            await tx.exception.update({
              where: { id: existing.id },
              data: {
                severity: d.severity,
                severityRank: EXCEPTION_SEVERITY_RANK[d.severity],
                affectedQty: d.affectedQty,
                currentPromisedDate: ymdToNullable(d.currentPromisedDate),
                recommendedAction: d.recommendedAction,
                details: toJson(d.details),
              },
            });
          }
          continue;
        }
        await this.openNew(tx, { lineId, meta, d, key, actorId: params.actorId, reason: 'Detected by allocation recalculation' });
        created += 1;
      }
    }

    for (const e of open) {
      if (desiredKeys.has(e.openKey as string)) continue;
      if (!AUTO_RESOLVABLE_TYPES.includes(e.type as ExceptionTypeName)) continue;
      await this.closeException(tx, e.id, {
        actorId: params.actorId,
        note: 'Condition cleared by allocation recalculation',
        kind: 'AUTO_RESOLVED',
      });
      resolved += 1;
    }
    return { created, resolved };
  }

  /** Opens an event-driven exception (e.g. a receipt was canceled while a line depended on it). */
  async openEvent(
    tx: Tx,
    params: { lineId: number; lineMeta: LineMeta; desired: DesiredException; actorId: number | null; reason: string },
  ): Promise<void> {
    const key = openKeyFor(params.lineId, params.desired.type, params.desired.reference);
    const existing = await tx.exception.findUnique({ where: { openKey: key } });
    if (existing) return;
    await this.openNew(tx, {
      lineId: params.lineId,
      meta: params.lineMeta,
      d: params.desired,
      key,
      actorId: params.actorId,
      reason: params.reason,
    });
  }

  async resolve(id: number, params: { actorId: number; note: string }) {
    return this.prisma.transact(async (tx) => {
      const exc = await tx.exception.findUnique({ where: { id } });
      if (!exc) throw ApiError.notFound('Exception', id);
      if (exc.status === 'RESOLVED') {
        throw ApiError.conflict('EXCEPTION_ALREADY_RESOLVED', `Exception ${exc.exceptionNumber} is already resolved`);
      }
      await this.closeException(tx, id, { actorId: params.actorId, note: params.note, kind: 'MANUAL' });
      return this.detail(tx, id);
    });
  }

  /** Exception with its line allocations and audit history. */
  async get(id: number) {
    return this.prisma.transact((tx) => this.detail(tx, id));
  }

  async list(query: ExceptionListQuery): Promise<Paginated<unknown>> {
    const where: Prisma.ExceptionWhereInput = { status: query.status ?? 'OPEN' };
    if (query.severity) where.severity = query.severity;
    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { exceptionNumber: { contains: q } },
        { order: { orderNumber: { contains: q } } },
        { order: { customer: { name: { contains: q } } } },
        { sku: { skuCode: { contains: q } } },
      ];
    }
    const orderBy: Prisma.ExceptionOrderByWithRelationInput[] =
      query.sort === 'created'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : query.sort === 'promised'
          ? [{ currentPromisedDate: 'asc' }, { id: 'asc' }]
          : query.sort === 'qty'
            ? [{ affectedQty: 'desc' }, { id: 'asc' }]
            : [{ severityRank: 'asc' }, { priorityRank: 'asc' }, { affectedQty: 'desc' }, { id: 'asc' }];

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.exception.count({ where }),
      this.prisma.exception.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: EXCEPTION_INCLUDE,
      }),
    ]);
    return paginate(rows.map(toExceptionDto), query.page, query.pageSize, total);
  }

  async detail(tx: Tx | PrismaService, id: number) {
    const exc = await tx.exception.findUnique({ where: { id }, include: EXCEPTION_INCLUDE });
    if (!exc) throw ApiError.notFound('Exception', id);
    const history = await this.audit.historyFor('Exception', id, tx as Tx);
    const orderLine = exc.orderLine
      ? await tx.orderLine.findUnique({
          where: { id: exc.orderLine.id },
          include: { allocations: { where: { status: 'ACTIVE' }, include: { location: true, receipt: true } } },
        })
      : null;
    return {
      ...toExceptionDto(exc),
      details: exc.details,
      resolutionNote: exc.resolutionNote,
      resolutionKind: exc.resolutionKind,
      resolvedAt: exc.resolvedAt?.toISOString() ?? null,
      resolvedBy: exc.resolvedBy ? { id: exc.resolvedBy.id, name: exc.resolvedBy.name } : null,
      currentAllocations: (orderLine?.allocations ?? []).map((a) => ({
        location: a.location.locationCode,
        source: a.sourceType,
        receiptNumber: a.receipt?.receiptNumber ?? null,
        quantity: a.quantity,
        availableDate: nullableDateToYmd(a.availableDate),
      })),
      history,
    };
  }

  /** Context used by the AI exception summary (advisory only; read-only query). */
  async context(tx: Tx | PrismaService, id: number) {
    return this.detail(tx, id);
  }

  // ---- internal -------------------------------------------------------------------------------

  private async openNew(
    tx: Tx,
    p: { lineId: number; meta: LineMeta; d: DesiredException; key: string; actorId: number | null; reason: string },
  ) {
    const exceptionNumber = await this.sequence.formatted(tx, 'exception', 'EXC');
    const exc = await tx.exception.create({
      data: {
        exceptionNumber,
        type: p.d.type,
        severity: p.d.severity,
        severityRank: EXCEPTION_SEVERITY_RANK[p.d.severity],
        priority: p.meta.priority,
        priorityRank: EXCEPTION_PRIORITY_RANK[p.meta.priority],
        status: 'OPEN',
        orderId: p.meta.orderId,
        orderLineId: p.lineId,
        skuId: p.meta.skuId,
        receiptId: p.d.receiptId,
        affectedQty: p.d.affectedQty,
        currentPromisedDate: ymdToNullable(p.d.currentPromisedDate),
        requestedShipDate: ymdToNullable(p.meta.requestedShipDate),
        recommendedAction: p.d.recommendedAction,
        details: toJson(p.d.details),
        openKey: p.key,
      },
    });
    await this.audit.record(tx, {
      userId: p.actorId,
      entityType: 'Exception',
      entityId: exc.id,
      action: 'EXCEPTION_CREATED',
      newValue: { exceptionNumber, type: p.d.type, severity: p.d.severity, affectedQty: p.d.affectedQty, orderLineId: p.lineId },
      reason: p.reason,
    });
  }

  private async closeException(
    tx: Tx,
    id: number,
    p: { actorId: number | null; note: string; kind: 'MANUAL' | 'AUTO_RESOLVED' },
  ) {
    const before = await tx.exception.findUniqueOrThrow({ where: { id } });
    await tx.exception.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        openKey: null,
        resolvedAt: new Date(),
        resolvedById: p.kind === 'MANUAL' ? p.actorId : null,
        resolutionNote: p.note.slice(0, 500),
        resolutionKind: p.kind,
      },
    });
    await this.audit.record(tx, {
      userId: p.actorId,
      entityType: 'Exception',
      entityId: id,
      action: p.kind === 'MANUAL' ? 'EXCEPTION_RESOLVED' : 'EXCEPTION_AUTO_RESOLVED',
      previousValue: { status: before.status, severity: before.severity, affectedQty: before.affectedQty },
      newValue: { status: 'RESOLVED' },
      reason: p.note,
    });
  }
}

export const EXCEPTION_INCLUDE = {
  order: { include: { customer: true } },
  sku: true,
  location: true,
  receipt: true,
  orderLine: true,
  resolvedBy: true,
} satisfies Prisma.ExceptionInclude;

export function toExceptionDto(e: Prisma.ExceptionGetPayload<{ include: typeof EXCEPTION_INCLUDE }>) {
  return {
    id: e.id,
    exceptionNumber: e.exceptionNumber,
    type: e.type,
    severity: e.severity,
    priority: e.priority,
    status: e.status,
    order: { id: e.order.id, orderNumber: e.order.orderNumber, status: e.order.status },
    customer: e.order.customer.name,
    orderLineId: e.orderLineId,
    sku: { id: e.sku.id, skuCode: e.sku.skuCode, name: e.sku.name },
    location: e.location ? { id: e.location.id, locationCode: e.location.locationCode } : null,
    receipt: e.receipt
      ? { id: e.receipt.id, receiptNumber: e.receipt.receiptNumber, status: e.receipt.status, expectedArrival: nullableDateToYmd(e.receipt.expectedArrivalTime) }
      : null,
    affectedQty: e.affectedQty,
    currentPromisedDate: nullableDateToYmd(e.currentPromisedDate),
    requestedShipDate: nullableDateToYmd(e.requestedShipDate),
    recommendedAction: e.recommendedAction,
    createdAt: e.createdAt.toISOString(),
    resolvedAt: e.resolvedAt?.toISOString() ?? null,
  };
}

function ymdToNullable(value: string | null | undefined): Date | null {
  return value ? ymdToDate(value) : null;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

