import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { paginate, Paginated } from '../common/api/api.interceptors';
import { ymdToDate } from '../common/dates';

export interface AuditEntry {
  userId?: number | null;
  entityType: string;
  entityId: string | number;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditQuery {
  page: number;
  pageSize: number;
  userId?: number;
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
  entityId?: string;
}

/**
 * Writes immutable audit records. Only INSERTs are ever issued; MySQL triggers reject UPDATE/DELETE.
 * Always called inside the same transaction as the change it describes, so the audit trail can
 * never disagree with the data.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        eventId: randomUUID(),
        userId: entry.userId ?? null,
        entityType: entry.entityType,
        entityId: String(entry.entityId),
        action: entry.action,
        previousValue: toJson(entry.previousValue),
        newValue: toJson(entry.newValue),
        reason: entry.reason ?? null,
        metadata: toJson(entry.metadata),
      },
    });
  }

  async list(query: AuditQuery): Promise<Paginated<unknown>> {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action) where.action = { contains: query.action };
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: ymdToDate(query.from) } : {}),
        ...(query.to ? { lt: new Date(ymdToDate(query.to).getTime() + 86_400_000) } : {}),
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, name: true, role: true } } },
      }),
    ]);
    return paginate(
      rows.map((r) => ({
        id: r.id.toString(),
        eventId: r.eventId,
        user: r.user ? { id: r.user.id, name: r.user.name, role: r.user.role } : null,
        entityType: r.entityType,
        entityId: r.entityId,
        action: r.action,
        previousValue: r.previousValue,
        newValue: r.newValue,
        reason: r.reason,
        metadata: r.metadata,
        timestamp: r.createdAt.toISOString(),
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  /** Full history for one entity (used by exception history, receipt audit, order timeline). */
  async historyFor(entityType: string, entityId: string | number, tx?: Tx) {
    const db = tx ?? this.prisma;
    const rows = await db.auditLog.findMany({
      where: { entityType, entityId: String(entityId) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { user: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      previousValue: r.previousValue,
      newValue: r.newValue,
      reason: r.reason,
      metadata: r.metadata,
      user: r.user ? { id: r.user.id, name: r.user.name } : null,
      timestamp: r.createdAt.toISOString(),
    }));
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
