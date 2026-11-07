import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api/api-error';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { PreferredLocationDto } from '../locations/locations.service';
import { AllocationService } from '../allocation/allocation.service';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: AllocationService,
  ) {}

  list(search?: string) {
    return this.prisma.customer.findMany({
      where: search ? { name: { contains: search.trim() } } : {},
      orderBy: { name: 'asc' },
      include: { preferredLocation: true, _count: { select: { orders: true } } },
      take: 100,
    }).then((rows) =>
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        preferredLocation: c.preferredLocation
          ? { id: c.preferredLocation.id, locationCode: c.preferredLocation.locationCode }
          : null,
        orderCount: c._count.orders,
      })),
    );
  }

  /** Find-or-create by name. Used when an order names a customer. */
  async findOrCreate(tx: Tx, name: string) {
    // Prisma's upsert is select-then-insert on MySQL and can still collide under concurrency, so use a
    // single atomic INSERT .. ON DUPLICATE KEY UPDATE statement, then read the row back.
    await tx.$executeRaw`INSERT INTO Customer (name, createdAt, updatedAt) VALUES (${name}, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE name = name`;
    return tx.customer.findUniqueOrThrow({ where: { name } });
  }

  async setPreferredLocation(id: number, dto: PreferredLocationDto, actorId: number) {
    return this.prisma.transact(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw ApiError.notFound('Customer', id);
      if (dto.locationId) {
        const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
        if (!loc || !loc.isActive) throw ApiError.badRequest('LOCATION_INVALID', 'Preferred location must be an active location');
      }
      const after = await tx.customer.update({
        where: { id },
        data: { preferredLocationId: dto.locationId ?? null },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'Customer',
        entityId: id,
        action: 'CUSTOMER_PREFERRED_LOCATION_CHANGED',
        previousValue: { preferredLocationId: customer.preferredLocationId },
        newValue: { preferredLocationId: after.preferredLocationId },
        reason: 'Customer preferred fulfillment location updated',
      });
      // Preferences change allocation of open orders for this customer: recalculate those SKUs in-transaction.
      const lineSkus = await tx.orderLine.findMany({
        where: { order: { customerId: id, status: { in: ['CONFIRMED', 'FULFILLING'] } } },
        select: { skuId: true },
        distinct: ['skuId'],
      });
      const recalc = await this.allocation.recalculate(
        tx,
        lineSkus.map((l) => l.skuId),
        { actorId, reason: 'Customer preferred location changed' },
      );
      return { id, preferredLocationId: after.preferredLocationId, recalculatedOrders: recalc.affectedOrderIds.length };
    });
  }
}
