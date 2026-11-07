/**
 * Validates AI-proposed actions against backend business rules. This is the gate between a language
 * model's output and the database: entities are resolved by exact identifier, and every rule that a
 * human planner would be held to is checked here, before any simulation or approval.
 */
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { addDaysYmd, diffDaysYmd, todayYmd, toYmd } from '../common/dates';
import { ProposedAction, ActionType } from './planner-note.parser';

export interface ResolvedRefs {
  receiptId?: number | null;
  receiptNumber?: string | null;
  skuId?: number | null;
  skuCode?: string | null;
  currentArrival?: string | null;
  newArrival?: string | null;
  orderId?: number | null;
  orderNumber?: string | null;
  locationId?: number | null;
  locationCode?: string | null;
  shippableNow?: number | null;
}

export interface ValidatedAction {
  id: string;
  type: ActionType;
  valid: boolean;
  errors: string[];
  warnings: string[];
  confidence: number;
  evidence: string;
  summary: string;
  resolved: ResolvedRefs;
}

export class PlannerNoteValidator {
  constructor(private readonly prisma: PrismaService) {}

  async validate(tx: Tx, actions: ProposedAction[]): Promise<ValidatedAction[]> {
    const today = todayYmd();
    const out: ValidatedAction[] = [];
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const errors: string[] = [];
      const warnings: string[] = [];
      const resolved: ResolvedRefs = {};
      let summary = '';

      if (a.confidence < 0.6) warnings.push('Low confidence: please check the identified entities.');

      if (a.type === 'DELAY_RECEIPT' || a.type === 'EXPEDITE_RECEIPT') {
        const receipt = a.receiptNumber
          ? await tx.inboundReceipt.findUnique({ where: { receiptNumber: a.receiptNumber }, include: { sku: true } })
          : null;
        if (!receipt) {
          errors.push(`Receipt "${a.receiptNumber ?? '(none)'}" was not found.`);
        } else {
          resolved.receiptId = receipt.id;
          resolved.receiptNumber = receipt.receiptNumber;
          resolved.skuId = receipt.skuId;
          resolved.skuCode = receipt.sku.skuCode;
          resolved.currentArrival = toYmd(receipt.expectedArrivalTime);
          if (receipt.status !== 'PLANNED' && receipt.status !== 'IN_TRANSIT') {
            errors.push(`Receipt ${receipt.receiptNumber} is ${receipt.status}; its arrival date can no longer change.`);
          }
          const delta = a.deltaDays ?? null;
          let newArrival: string | null = a.newArrival ?? null;
          if (!newArrival && delta !== null) {
            newArrival = addDaysYmd(resolved.currentArrival, a.type === 'DELAY_RECEIPT' ? Math.abs(delta) : -Math.abs(delta));
          }
          if (!newArrival) {
            errors.push('The amount of change (days or date) could not be determined from the note.');
          } else {
            resolved.newArrival = newArrival;
            if (a.type === 'DELAY_RECEIPT' && newArrival <= resolved.currentArrival!) {
              errors.push(`A delay must move the arrival later than ${resolved.currentArrival}.`);
            }
            if (a.type === 'EXPEDITE_RECEIPT') {
              if (newArrival >= resolved.currentArrival!) errors.push(`An expedite must move the arrival earlier than ${resolved.currentArrival}.`);
              if (newArrival < today) errors.push('An expedited arrival cannot be before today.');
            }
            summary = `${receipt.receiptNumber} (${receipt.sku.skuCode}) arrival ${resolved.currentArrival} → ${newArrival}`;
          }
        }
      }

      if (a.type === 'REASSIGN_LOCATION' || a.type === 'SPLIT_SHIPMENT') {
        const order = a.orderNumber
          ? await tx.order.findUnique({ where: { orderNumber: a.orderNumber }, include: { lines: { where: { canceledAt: null } } } })
          : null;
        if (!order) {
          errors.push(`Order "${a.orderNumber ?? '(none)'}" was not found.`);
        } else {
          resolved.orderId = order.id;
          resolved.orderNumber = order.orderNumber;
          if (!['CONFIRMED', 'FULFILLING'].includes(order.status)) {
            errors.push(`Order ${order.orderNumber} is ${order.status}; only confirmed or fulfilling orders can be changed.`);
          }
          const openLines = order.lines.filter((l) => l.requestedQty - l.shippedQty > 0);
          if (openLines.length === 0) errors.push(`Order ${order.orderNumber} has no open quantity.`);

          if (a.type === 'REASSIGN_LOCATION') {
            const loc = a.locationCode
              ? await tx.location.findUnique({ where: { locationCode: a.locationCode } })
              : null;
            if (!loc) {
              errors.push(`Location "${a.locationCode ?? '(none)'}" was not found.`);
            } else if (!loc.isActive) {
              errors.push(`Location ${loc.locationCode} is inactive.`);
            } else {
              resolved.locationId = loc.id;
              resolved.locationCode = loc.locationCode;
              if (openLines.length && openLines.every((l) => l.preferredLocationId === loc.id)) {
                errors.push(`Order ${order.orderNumber} is already assigned to ${loc.locationCode}.`);
              }
              summary = `Order ${order.orderNumber}: move ${openLines.length} open line(s) to ${loc.locationCode}`;
            }
          }

          if (a.type === 'SPLIT_SHIPMENT') {
            const shippable = await this.shippableNow(tx, order.id);
            resolved.shippableNow = shippable;
            if (shippable <= 0) {
              errors.push(`No on-hand units allocated to ${order.orderNumber} are available to ship today.`);
            }
            summary = `Order ${order.orderNumber}: ship ${shippable} available unit(s) now; the rest stays allocated or backordered`;
          }
        }
      }

      out.push({
        id: `a${i + 1}`,
        type: a.type,
        valid: errors.length === 0,
        errors,
        warnings,
        confidence: a.confidence,
        evidence: a.evidence,
        summary: summary || a.type.replace(/_/g, ' ').toLowerCase(),
        resolved,
      });
    }
    return out;
  }

  private async shippableNow(tx: Tx, orderId: number): Promise<number> {
    const today = new Date(`${todayYmd()}T00:00:00.000Z`);
    const rows = await tx.allocation.findMany({
      where: { orderLine: { orderId, canceledAt: null }, status: 'ACTIVE', sourceType: 'ON_HAND', availableDate: { lte: today } },
      select: { quantity: true },
    });
    return rows.reduce((s, r) => s + r.quantity, 0);
  }
}

export { diffDaysYmd };
