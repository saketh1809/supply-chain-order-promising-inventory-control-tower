/**
 * Deterministic allocation engine.
 *
 * PURE FUNCTION: no I/O, no clock reads (the planning day is passed in), no randomness.
 * The same input always yields the same output, regardless of the order in which the caller
 * supplies supplies/demands. See docs/ALLOCATION_ALGORITHM.md for the full specification.
 */
import { addDaysYmd, maxYmd, minYmd } from '../common/dates';

export type DemandPriority = 'HIGH' | 'MED' | 'LOW';
export type SupplyKind = 'ON_HAND' | 'INBOUND';
export type LineAllocationStatus =
  | 'FULLY_ALLOCATED'
  | 'PARTIALLY_ALLOCATED'
  | 'BACKORDERED'
  | 'NOT_APPLICABLE';

/** A unit pool that can satisfy demand: on-hand stock at a location, or an eligible inbound receipt. */
export interface SupplySource {
  /** Stable unique key, e.g. "ON_HAND:3" or "INBOUND:42". */
  key: string;
  kind: SupplyKind;
  locationId: number;
  locationCode: string;
  receiptId: number | null;
  receiptNumber: string | null;
  /** Date (YYYY-MM-DD) from which these units can ship. Engine clamps it to asOfDate. */
  availableDate: string;
  quantity: number;
}

export interface DemandLine {
  lineId: number;
  orderId: number;
  orderNumber: string;
  priority: DemandPriority;
  /** ISO timestamp of order creation (tie-breaker). */
  orderCreatedAt: string;
  lineNumber: number;
  /** Units still to be allocated (requested - shipped). */
  openQty: number;
  /** Effective preferred location (line > order > customer). Null = no preference. */
  preferredLocationId: number | null;
}

export interface EngineInput {
  /** Planning day, YYYY-MM-DD. Nothing can ship before this day. */
  asOfDate: string;
  /** SKU replenishment lead time in days; used to estimate promises for backordered units. */
  leadTimeDays: number | null;
  supplies: SupplySource[];
  demands: DemandLine[];
}

export interface AllocationPiece {
  sourceKey: string;
  kind: SupplyKind;
  locationId: number;
  locationCode: string;
  receiptId: number | null;
  receiptNumber: string | null;
  availableDate: string;
  quantity: number;
}

export interface LineAllocationResult {
  lineId: number;
  orderId: number;
  openQty: number;
  allocatedQty: number;
  backorderedQty: number;
  allocations: AllocationPiece[];
  allocationStatus: LineAllocationStatus;
  /** Earliest day any allocated unit can ship. Null if nothing is allocated. */
  earliestShipDate: string | null;
  /** Day the full open quantity is expected to be complete; this is the calculated promise. */
  calculatedPromisedDate: string | null;
  /** Location that supplies the largest share of this line (ties: earliest date, then lowest id). */
  fulfillmentLocationId: number | null;
}

export interface EngineResult {
  lines: LineAllocationResult[];
  /** Remaining unallocated quantity per supply source after all demand is processed. */
  remainingSupply: Array<{ sourceKey: string; remainingQty: number }>;
}

export const PRIORITY_RANK: Record<DemandPriority, number> = { HIGH: 0, MED: 1, LOW: 2 };
const KIND_RANK: Record<SupplyKind, number> = { ON_HAND: 0, INBOUND: 1 };

/**
 * Demand processing order (the allocation tie-breaker):
 *   1. priority (HIGH, then MED, then LOW)
 *   2. order creation timestamp (earlier first)
 *   3. order number (lexicographic, final deterministic tie-breaker)
 *   4. line number, then line id (only ever relevant for multi-line orders)
 */
export function compareDemand(a: DemandLine, b: DemandLine): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    compareStrings(a.orderCreatedAt, b.orderCreatedAt) ||
    compareStrings(a.orderNumber, b.orderNumber) ||
    a.lineNumber - b.lineNumber ||
    a.lineId - b.lineId
  );
}

/**
 * Supply consumption order: earliest availability first; on-hand before inbound at the same day;
 * then location code, receipt number and key so the order is total.
 */
export function compareSupply(a: SupplySource, b: SupplySource): number {
  return (
    compareStrings(a.availableDate, b.availableDate) ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    compareStrings(a.locationCode, b.locationCode) ||
    compareStrings(a.receiptNumber ?? '', b.receiptNumber ?? '') ||
    compareStrings(a.key, b.key)
  );
}

export function runAllocationEngine(input: EngineInput): EngineResult {
  const asOf = input.asOfDate;

  // Working copy of the supply pool; clamp availability to "not before today".
  const pool = input.supplies
    .filter((s) => s.quantity > 0)
    .map((s) => ({
      source: s,
      availableDate: maxYmd(asOf, s.availableDate) as string,
      remaining: s.quantity,
    }));
  pool.sort((a, b) =>
    compareSupply(
      { ...a.source, availableDate: a.availableDate },
      { ...b.source, availableDate: b.availableDate },
    ),
  );

  const demands = [...input.demands].sort(compareDemand);
  const resultsById = new Map<number, LineAllocationResult>();

  for (const demand of demands) {
    const pieces: AllocationPiece[] = [];
    let need = Math.max(0, demand.openQty);

    if (need > 0) {
      // Preferred location first (in availability order), then every other location in availability order.
      const preferred = demand.preferredLocationId;
      const candidates =
        preferred === null
          ? pool
          : [...pool.filter((p) => p.source.locationId === preferred), ...pool.filter((p) => p.source.locationId !== preferred)];

      for (const entry of candidates) {
        if (need === 0) break;
        if (entry.remaining <= 0) continue;
        const take = Math.min(need, entry.remaining);
        entry.remaining -= take;
        need -= take;
        pieces.push({
          sourceKey: entry.source.key,
          kind: entry.source.kind,
          locationId: entry.source.locationId,
          locationCode: entry.source.locationCode,
          receiptId: entry.source.receiptId,
          receiptNumber: entry.source.receiptNumber,
          availableDate: entry.availableDate,
          quantity: take,
        });
      }
    }

    resultsById.set(demand.lineId, buildLineResult(demand, pieces, need, input.leadTimeDays, asOf));
  }

  return {
    lines: input.demands
      .map((d) => resultsById.get(d.lineId) as LineAllocationResult)
      .sort((a, b) => a.lineId - b.lineId),
    remainingSupply: pool
      .map((p) => ({ sourceKey: p.source.key, remainingQty: p.remaining }))
      .sort((a, b) => compareStrings(a.sourceKey, b.sourceKey)),
  };
}

function buildLineResult(
  demand: DemandLine,
  pieces: AllocationPiece[],
  backorderedQty: number,
  leadTimeDays: number | null,
  asOf: string,
): LineAllocationResult {
  const allocatedQty = demand.openQty - backorderedQty;
  const openQty = Math.max(0, demand.openQty);

  let allocationStatus: LineAllocationStatus;
  if (openQty === 0) allocationStatus = 'NOT_APPLICABLE';
  else if (allocatedQty === 0) allocationStatus = 'BACKORDERED';
  else if (backorderedQty > 0) allocationStatus = 'PARTIALLY_ALLOCATED';
  else allocationStatus = 'FULLY_ALLOCATED';

  const earliestShipDate = minYmd(...pieces.map((p) => p.availableDate));
  const latestAllocatedDate = maxYmd(...pieces.map((p) => p.availableDate));

  // Promise for the full open quantity:
  //  - fully allocated: the day the last unit is available.
  //  - backordered units: no committed supply exists yet, so use the SKU's replenishment lead time
  //    (planning estimate). If the SKU has no lead time, the line is unpromisable (null).
  let calculatedPromisedDate: string | null = null;
  if (openQty > 0) {
    if (backorderedQty === 0) {
      calculatedPromisedDate = latestAllocatedDate;
    } else if (leadTimeDays !== null) {
      calculatedPromisedDate = maxYmd(latestAllocatedDate, addDaysYmd(asOf, leadTimeDays));
    }
  }

  return {
    lineId: demand.lineId,
    orderId: demand.orderId,
    openQty,
    allocatedQty,
    backorderedQty,
    allocations: pieces,
    allocationStatus,
    earliestShipDate,
    calculatedPromisedDate,
    fulfillmentLocationId: pickFulfillmentLocation(pieces) ?? demand.preferredLocationId ?? null,
  };
}

function pickFulfillmentLocation(pieces: AllocationPiece[]): number | null {
  const byLocation = new Map<number, { qty: number; earliest: string }>();
  for (const p of pieces) {
    const cur = byLocation.get(p.locationId);
    if (cur) {
      cur.qty += p.quantity;
      cur.earliest = minYmd(cur.earliest, p.availableDate) as string;
    } else {
      byLocation.set(p.locationId, { qty: p.quantity, earliest: p.availableDate });
    }
  }
  let best: { id: number; qty: number; earliest: string } | null = null;
  for (const [id, v] of byLocation) {
    if (
      !best ||
      v.qty > best.qty ||
      (v.qty === best.qty && (v.earliest < best.earliest || (v.earliest === best.earliest && id < best.id)))
    ) {
      best = { id, qty: v.qty, earliest: v.earliest };
    }
  }
  return best ? best.id : null;
}

/**
 * ATP (Available-to-Promise) at a location:
 *   ATP = on-hand + eligible future receipts - allocated demand
 * "Eligible" receipts are PLANNED or IN_TRANSIT only (received receipts are already in on-hand;
 * canceled receipts are never eligible).
 */
export function computeAtp(params: { onHand: number; eligibleInbound: number; allocatedDemand: number }): number {
  return params.onHand + params.eligibleInbound - params.allocatedDemand;
}

/** Quantity that is physically reserved from on-hand stock (available = onHand - this). */
export function availableQty(onHand: number, allocatedFromOnHand: number): number {
  return onHand - allocatedFromOnHand;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

