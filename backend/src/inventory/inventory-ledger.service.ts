import { Injectable } from '@nestjs/common';
import { MovementType } from '@prisma/client';
import { ApiError } from '../common/api/api-error';
import { Tx } from '../common/prisma/prisma.service';
import { SequenceService } from '../common/sequence/sequence.service';
import { AuditService } from '../audit/audit.service';

export interface LedgerPosting {
  skuId: number;
  locationId: number;
  delta: number;
  movementType: MovementType;
  reason: string;
  /** Unique key for idempotency, e.g. "RECEIPT:42". A second posting with the same key fails. */
  referenceKey?: string | null;
  userId: number | null;
}

export interface LedgerResult {
  id: number;
  adjustmentNumber: string;
  previousOnHand: number;
  newOnHand: number;
  quantityDelta: number;
}

/**
 * The only code path that changes InventoryBalance.onHand. Every change:
 *   1. locks the balance row (SELECT ... FOR UPDATE),
 *   2. refuses to go negative (also enforced by a CHECK constraint),
 *   3. appends one immutable InventoryAdjustment row.
 * Callers must already hold the SKU lock (AllocationService.lockSkus).
 */
@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  async post(tx: Tx, p: LedgerPosting): Promise<LedgerResult> {
    if (!Number.isInteger(p.delta) || p.delta === 0) {
      throw ApiError.badRequest('INVALID_QUANTITY', 'Quantity change must be a non-zero integer');
    }
    await tx.inventoryBalance.upsert({
      where: { skuId_locationId: { skuId: p.skuId, locationId: p.locationId } },
      create: { skuId: p.skuId, locationId: p.locationId, onHand: 0 },
      update: {},
    });
    const locked = await tx.$queryRaw<Array<{ onHand: number }>>`
      SELECT onHand FROM InventoryBalance WHERE skuId = ${p.skuId} AND locationId = ${p.locationId} FOR UPDATE`;
    const previousOnHand = locked[0]?.onHand ?? 0;
    const newOnHand = previousOnHand + p.delta;
    if (newOnHand < 0) {
      throw ApiError.unprocessable(
        'INSUFFICIENT_STOCK',
        `This change would make on-hand negative (${previousOnHand} on hand, change ${p.delta}).`,
        { previousOnHand, requestedDelta: p.delta },
      );
    }
    await tx.inventoryBalance.update({
      where: { skuId_locationId: { skuId: p.skuId, locationId: p.locationId } },
      data: { onHand: newOnHand, version: { increment: 1 } },
    });
    const adjustmentNumber = await this.sequence.formatted(tx, 'adjustment', 'ADJ');
    const row = await tx.inventoryAdjustment.create({
      data: {
        adjustmentNumber,
        movementType: p.movementType,
        skuId: p.skuId,
        locationId: p.locationId,
        quantityDelta: p.delta,
        previousOnHand,
        newOnHand,
        reason: p.reason.slice(0, 500),
        referenceKey: p.referenceKey ?? null,
        userId: p.userId,
      },
    });
    return { id: row.id, adjustmentNumber, previousOnHand, newOnHand, quantityDelta: p.delta };
  }

  /** Reconstructs on-hand as it was at `asOf` by reversing ledger movements made after it. */
  async onHandAt(tx: Tx, skuId: number, locationId: number, asOf: Date, currentOnHand: number): Promise<number> {
    const later = await tx.inventoryAdjustment.aggregate({
      where: { skuId, locationId, createdAt: { gt: asOf } },
      _sum: { quantityDelta: true },
    });
    return currentOnHand - (later._sum.quantityDelta ?? 0);
  }

  async auditAdjustment(tx: Tx, userId: number | null, id: number, data: Record<string, unknown>) {
    await this.audit.record(tx, { userId, entityType: 'InventoryAdjustment', entityId: id, action: 'INVENTORY_LEDGER_POSTED', newValue: data });
  }
}
