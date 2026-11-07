/**
 * Pure exception-generation rules. Given the computed state of one order line, returns the set of
 * exceptions that SHOULD be open. The exception service reconciles this desired set with the
 * database (create missing, refresh changed, auto-resolve cleared conditions).
 */
import { diffDaysYmd } from '../common/dates';
import type { DemandPriority } from './allocation-engine';

export type ExceptionTypeName =
  | 'PROMISE_DATE_AT_RISK'
  | 'BACKORDER'
  | 'DELAYED_INBOUND'
  | 'CANCELED_INBOUND_DEPENDENCY'
  | 'HIGH_PRIORITY_INSUFFICIENT_STOCK';

export type SeverityName = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Types whose condition is derived from current state and therefore auto-resolve when cleared. */
export const AUTO_RESOLVABLE_TYPES: ExceptionTypeName[] = [
  'PROMISE_DATE_AT_RISK',
  'BACKORDER',
  'DELAYED_INBOUND',
  'HIGH_PRIORITY_INSUFFICIENT_STOCK',
];

export interface InboundDependency {
  receiptId: number;
  receiptNumber: string;
  quantity: number;
  status: 'PLANNED' | 'IN_TRANSIT';
  expectedArrival: string;
  originalExpectedArrival: string;
  locationCode: string;
}

export interface LineFacts {
  lineId: number;
  priority: DemandPriority;
  isActive: boolean;
  openQty: number;
  backorderedQty: number;
  requestedShipDate: string | null;
  /** Effective promise: manual override if set, otherwise the calculated date. */
  effectivePromisedDate: string | null;
  skuCode: string;
  /** Replenishment candidates that could cover backorders (planned/in-transit receipts not yet used). */
  unusedInbound: Array<{ receiptNumber: string; expectedArrival: string; quantity: number }>;
  inboundDependencies: InboundDependency[];
}

export interface DesiredException {
  type: ExceptionTypeName;
  /** Distinguishes multiple exceptions of the same type on one line (e.g. one per receipt). */
  reference: string;
  receiptId: number | null;
  severity: SeverityName;
  affectedQty: number;
  currentPromisedDate: string | null;
  requestedShipDate: string | null;
  recommendedAction: string;
  details: Record<string, unknown>;
}

const SEVERITY_ORDER: SeverityName[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function bumpSeverity(s: SeverityName, steps = 1): SeverityName {
  const idx = Math.min(SEVERITY_ORDER.length - 1, SEVERITY_ORDER.indexOf(s) + steps);
  return SEVERITY_ORDER[idx];
}

export function severityFromPriority(priority: DemandPriority): SeverityName {
  return priority === 'HIGH' ? 'CRITICAL' : priority === 'MED' ? 'HIGH' : 'MEDIUM';
}

/** Rules are only evaluated for active (confirmed/fulfilling, open) lines. */
export function evaluateLineExceptions(f: LineFacts): DesiredException[] {
  if (!f.isActive || f.openQty <= 0) return [];
  const out: DesiredException[] = [];

  // BACKORDER: part of the open quantity has no supply.
  if (f.backorderedQty > 0) {
    let severity = severityFromPriority(f.priority);
    if (f.effectivePromisedDate === null) severity = bumpSeverity(severity);
    const suggestion =
      f.unusedInbound.length > 0
        ? `Expedite inbound ${f.unusedInbound[0].receiptNumber} (arrives ${f.unusedInbound[0].expectedArrival}) to cover ${f.backorderedQty} backordered units, or split the shipment and approve a partial ship.`
        : `No committed supply for ${f.backorderedQty} units of ${f.skuCode}. Raise a replenishment receipt or reassign to a location with stock.`;
    out.push({
      type: 'BACKORDER',
      reference: '',
      receiptId: null,
      severity,
      affectedQty: f.backorderedQty,
      currentPromisedDate: f.effectivePromisedDate,
      requestedShipDate: f.requestedShipDate,
      recommendedAction: suggestion,
      details: { backorderedQty: f.backorderedQty, unusedInbound: f.unusedInbound },
    });
  }

  // HIGH_PRIORITY_INSUFFICIENT_STOCK: a HIGH priority line cannot be fully covered.
  if (f.priority === 'HIGH' && f.backorderedQty > 0) {
    out.push({
      type: 'HIGH_PRIORITY_INSUFFICIENT_STOCK',
      reference: '',
      receiptId: null,
      severity: 'CRITICAL',
      affectedQty: f.backorderedQty,
      currentPromisedDate: f.effectivePromisedDate,
      requestedShipDate: f.requestedShipDate,
      recommendedAction:
        'High-priority order is short. Expedite supply, reassign the line to a location with stock, or planner-override the promise with justification.',
      details: { priority: f.priority },
    });
  }

  // PROMISE_DATE_AT_RISK: the effective promise is later than the requested ship date (or unknown).
  if (f.requestedShipDate !== null) {
    if (f.effectivePromisedDate === null) {
      out.push({
        type: 'PROMISE_DATE_AT_RISK',
        reference: '',
        receiptId: null,
        severity: f.priority === 'HIGH' ? 'CRITICAL' : 'HIGH',
        affectedQty: f.openQty,
        currentPromisedDate: null,
        requestedShipDate: f.requestedShipDate,
        recommendedAction: 'No promise date can be committed for this line. Expedite supply or set a manual promise with justification.',
        details: { reason: 'UNPROMISABLE' },
      });
    } else if (f.effectivePromisedDate > f.requestedShipDate) {
      const lateDays = diffDaysYmd(f.requestedShipDate, f.effectivePromisedDate);
      let severity: SeverityName = lateDays >= 7 ? 'HIGH' : 'MEDIUM';
      if (f.priority === 'HIGH') severity = lateDays >= 3 ? 'CRITICAL' : 'HIGH';
      out.push({
        type: 'PROMISE_DATE_AT_RISK',
        reference: '',
        receiptId: null,
        severity,
        affectedQty: f.openQty,
        currentPromisedDate: f.effectivePromisedDate,
        requestedShipDate: f.requestedShipDate,
        recommendedAction: `Promise (${f.effectivePromisedDate}) is ${lateDays} day(s) after the requested date (${f.requestedShipDate}). Consider expediting the dependent receipt or splitting the shipment.`,
        details: { lateDays },
      });
    }
  }

  // DELAYED_INBOUND: an allocation depends on a receipt that slipped past its original date.
  for (const dep of f.inboundDependencies) {
    const delayDays = diffDaysYmd(dep.originalExpectedArrival, dep.expectedArrival);
    if (delayDays > 0) {
      out.push({
        type: 'DELAYED_INBOUND',
        reference: String(dep.receiptId),
        receiptId: dep.receiptId,
        severity: delayDays >= 5 ? 'HIGH' : 'MEDIUM',
        affectedQty: dep.quantity,
        currentPromisedDate: f.effectivePromisedDate,
        requestedShipDate: f.requestedShipDate,
        recommendedAction: `Receipt ${dep.receiptNumber} slipped ${delayDays} day(s) to ${dep.expectedArrival}. Expedite the receipt, or reassign ${dep.quantity} units to a location with on-hand stock.`,
        details: { receiptNumber: dep.receiptNumber, delayDays, originalExpectedArrival: dep.originalExpectedArrival },
      });
    }
  }

  return out;
}

/** Recommended action text for a receipt that was canceled while this line depended on it. */
export function canceledDependencyAction(receiptNumber: string, qty: number): string {
  return `Receipt ${receiptNumber} was canceled. ${qty} units were released from this line. Reassign to another location, expedite an alternative receipt, or contact the customer about a revised date.`;
}

export function severityRank(s: SeverityName): number {
  return SEVERITY_ORDER.indexOf(s);
}
