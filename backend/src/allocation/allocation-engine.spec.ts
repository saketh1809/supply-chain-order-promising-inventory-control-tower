import { DemandLine, EngineInput, SupplySource, computeAtp, runAllocationEngine } from './allocation-engine';

const TODAY = '2026-11-06';

const onHand = (locationId: number, locationCode: string, qty: number): SupplySource => ({
  key: `ON_HAND:${locationId}`,
  kind: 'ON_HAND',
  locationId,
  locationCode,
  receiptId: null,
  receiptNumber: null,
  availableDate: TODAY,
  quantity: qty,
});

const inbound = (
  receiptId: number,
  locationId: number,
  locationCode: string,
  arrival: string,
  qty: number,
): SupplySource => ({
  key: `INBOUND:${receiptId}`,
  kind: 'INBOUND',
  locationId,
  locationCode,
  receiptId,
  receiptNumber: `PO-${receiptId}`,
  availableDate: arrival,
  quantity: qty,
});

const demand = (
  lineId: number,
  orderNumber: string,
  priority: DemandLine['priority'],
  openQty: number,
  overrides: Partial<DemandLine> = {},
): DemandLine => ({
  lineId,
  orderId: lineId,
  orderNumber,
  priority,
  orderCreatedAt: '2026-11-01T10:00:00.000Z',
  lineNumber: 1,
  openQty,
  preferredLocationId: null,
  ...overrides,
});

const input = (partial: Partial<EngineInput>): EngineInput => ({
  asOfDate: TODAY,
  leadTimeDays: null,
  supplies: [],
  demands: [],
  ...partial,
});

const line = (result: ReturnType<typeof runAllocationEngine>, lineId: number) => {
  const found = result.lines.find((l) => l.lineId === lineId);
  if (!found) throw new Error(`line ${lineId} missing`);
  return found;
};

describe('ATP calculation', () => {
  it('computes ATP = on-hand + eligible inbound - allocated demand', () => {
    expect(computeAtp({ onHand: 100, eligibleInbound: 40, allocatedDemand: 90 })).toBe(50);
  });

  it('can be negative when demand exceeds supply (projected shortage)', () => {
    expect(computeAtp({ onHand: 5, eligibleInbound: 0, allocatedDemand: 8 })).toBe(-3);
  });
});

describe('Allocation priority and tie-breaking', () => {
  it('gives the last units to a HIGH order even when a LOW order was created earlier', () => {
    const result = runAllocationEngine(
      input({
        supplies: [onHand(1, 'CA', 5)],
        demands: [
          demand(1, 'A100', 'LOW', 5, { orderCreatedAt: '2026-10-01T00:00:00.000Z' }),
          demand(2, 'A200', 'HIGH', 5, { orderCreatedAt: '2026-11-05T00:00:00.000Z' }),
        ],
      }),
    );
    expect(line(result, 2).allocatedQty).toBe(5);
    expect(line(result, 1).allocatedQty).toBe(0);
    expect(line(result, 1).allocationStatus).toBe('BACKORDERED');
  });

  it('ranks HIGH > MED > LOW before creation time', () => {
    const result = runAllocationEngine(
      input({
        supplies: [onHand(1, 'CA', 4)],
        demands: [
          demand(1, 'A1', 'MED', 4, { orderCreatedAt: '2026-01-01T00:00:00.000Z' }),
          demand(2, 'A2', 'LOW', 4, { orderCreatedAt: '2025-01-01T00:00:00.000Z' }),
          demand(3, 'A3', 'HIGH', 4, { orderCreatedAt: '2026-06-01T00:00:00.000Z' }),
        ],
      }),
    );
    expect(line(result, 3).allocatedQty).toBe(4);
    expect(line(result, 1).allocatedQty).toBe(0);
    expect(line(result, 2).allocatedQty).toBe(0);
  });

  it('breaks same-priority ties by earlier creation timestamp', () => {
    const result = runAllocationEngine(
      input({
        supplies: [onHand(1, 'CA', 3)],
        demands: [
          demand(1, 'A5', 'MED', 3, { orderCreatedAt: '2026-11-02T00:00:00.000Z' }),
          demand(2, 'A9', 'MED', 3, { orderCreatedAt: '2026-11-01T00:00:00.000Z' }),
        ],
      }),
    );
    expect(line(result, 2).allocatedQty).toBe(3);
    expect(line(result, 1).allocatedQty).toBe(0);
  });

  it('uses the order number as the final deterministic tie-breaker', () => {
    const ts = '2026-11-01T00:00:00.000Z';
    const result = runAllocationEngine(
      input({
        supplies: [onHand(1, 'CA', 2)],
        demands: [
          demand(10, 'A104', 'LOW', 2, { orderCreatedAt: ts }),
          demand(11, 'A101', 'LOW', 2, { orderCreatedAt: ts }),
        ],
      }),
    );
    expect(line(result, 11).allocatedQty).toBe(2);
    expect(line(result, 10).allocatedQty).toBe(0);
  });

  it('never allocates the same unit to two orders', () => {
    const result = runAllocationEngine(
      input({
        supplies: [onHand(1, 'CA', 7)],
        demands: [demand(1, 'A1', 'HIGH', 5), demand(2, 'A2', 'HIGH', 5), demand(3, 'A3', 'LOW', 5)],
      }),
    );
    const total = result.lines.reduce((s, l) => s + l.allocatedQty, 0);
    expect(total).toBe(7);
    expect(result.remainingSupply[0].remainingQty).toBe(0);
  });
});

describe('Partial allocation and backorders', () => {
  it('allocates 6 of 10 requested units and backorders 4', () => {
    const result = runAllocationEngine(
      input({
        leadTimeDays: 14,
        supplies: [onHand(1, 'NJ', 6)],
        demands: [demand(1, 'A104', 'MED', 10)],
      }),
    );
    const l = line(result, 1);
    expect(l.allocatedQty).toBe(6);
    expect(l.backorderedQty).toBe(4);
    expect(l.allocationStatus).toBe('PARTIALLY_ALLOCATED');
  });

  it('completes the allocation automatically once the missing 4 units arrive', () => {
    const before = runAllocationEngine(
      input({ supplies: [onHand(1, 'NJ', 6)], demands: [demand(1, 'A104', 'MED', 10)] }),
    );
    expect(line(before, 1).backorderedQty).toBe(4);

    const after = runAllocationEngine(
      input({
        supplies: [onHand(1, 'NJ', 6), inbound(22, 1, 'NJ', '2026-11-12', 4)],
        demands: [demand(1, 'A104', 'MED', 10)],
      }),
    );
    const l = line(after, 1);
    expect(l.allocatedQty).toBe(10);
    expect(l.backorderedQty).toBe(0);
    expect(l.allocationStatus).toBe('FULLY_ALLOCATED');
    expect(l.calculatedPromisedDate).toBe('2026-11-12');
  });

  it('leaves the promise null for a backorder when the SKU has no lead time', () => {
    const result = runAllocationEngine(input({ supplies: [], demands: [demand(1, 'A1', 'LOW', 3)] }));
    expect(line(result, 1).allocationStatus).toBe('BACKORDERED');
    expect(line(result, 1).backorderedQty).toBe(3);
    expect(line(result, 1).calculatedPromisedDate).toBeNull();
  });

  it('estimates a backorder promise from the SKU lead time', () => {
    const result = runAllocationEngine(
      input({ leadTimeDays: 21, supplies: [], demands: [demand(1, 'A1', 'LOW', 3)] }),
    );
    expect(line(result, 1).calculatedPromisedDate).toBe('2026-11-27');
  });
});

describe('Promised ship dates', () => {
  it('promises the arrival day of the inbound receipt that covers demand', () => {
    const result = runAllocationEngine(
      input({
        supplies: [inbound(7, 2, 'CA', '2026-11-20', 8)],
        demands: [demand(1, 'A1', 'MED', 8)],
      }),
    );
    expect(line(result, 1).calculatedPromisedDate).toBe('2026-11-20');
    expect(line(result, 1).earliestShipDate).toBe('2026-11-20');
  });

  it('moves the promise later when a receipt is delayed', () => {
    const onTime = runAllocationEngine(
      input({ supplies: [inbound(7, 2, 'CA', '2026-11-20', 8)], demands: [demand(1, 'A1', 'MED', 8)] }),
    );
    const delayed = runAllocationEngine(
      input({ supplies: [inbound(7, 2, 'CA', '2026-11-27', 8)], demands: [demand(1, 'A1', 'MED', 8)] }),
    );
    expect(line(onTime, 1).calculatedPromisedDate).toBe('2026-11-20');
    expect(line(delayed, 1).calculatedPromisedDate).toBe('2026-11-27');
  });

  it('treats an overdue receipt as available today (never before the planning day)', () => {
    const result = runAllocationEngine(
      input({ supplies: [inbound(7, 2, 'CA', '2026-10-15', 2)], demands: [demand(1, 'A1', 'MED', 2)] }),
    );
    expect(line(result, 1).calculatedPromisedDate).toBe(TODAY);
  });

  it('promises the later of the allocated dates when a line uses on-hand and inbound', () => {
    const result = runAllocationEngine(
      input({
        supplies: [onHand(1, 'NJ', 3), inbound(9, 1, 'NJ', '2026-11-10', 5)],
        demands: [demand(1, 'A1', 'MED', 6)],
      }),
    );
    expect(line(result, 1).allocatedQty).toBe(6);
    expect(line(result, 1).calculatedPromisedDate).toBe('2026-11-10');
    expect(line(result, 1).earliestShipDate).toBe(TODAY);
  });
});

describe('Location selection and preferred locations', () => {
  const supplies = [onHand(1, 'NJ', 5), onHand(2, 'CA', 10)];

  it('without a preference, consumes the earliest supply first then the next location', () => {
    const result = runAllocationEngine(input({ supplies, demands: [demand(1, 'A1', 'MED', 12)] }));
    const pieces = line(result, 1).allocations.map((a) => [a.locationCode, a.quantity]);
    expect(pieces).toEqual([
      ['CA', 10],
      ['NJ', 2],
    ]);
  });

  it('allocates from the preferred location first', () => {
    const result = runAllocationEngine(
      input({ supplies, demands: [demand(1, 'A1', 'MED', 6, { preferredLocationId: 1 })] }),
    );
    expect(line(result, 1).allocations).toEqual([
      expect.objectContaining({ locationCode: 'NJ', quantity: 5 }),
      expect.objectContaining({ locationCode: 'CA', quantity: 1 }),
    ]);
    expect(line(result, 1).fulfillmentLocationId).toBe(1);
  });

  it('honours a preferred location even when it is only available later (documented trade-off)', () => {
    const result = runAllocationEngine(
      input({
        supplies: [onHand(2, 'CA', 10), inbound(5, 1, 'NJ', '2026-11-16', 10)],
        demands: [demand(1, 'A1', 'MED', 4, { preferredLocationId: 1 })],
      }),
    );
    const l = line(result, 1);
    expect(l.allocations).toEqual([expect.objectContaining({ locationCode: 'NJ', quantity: 4 })]);
    expect(l.calculatedPromisedDate).toBe('2026-11-16');
  });

  it('reports the location supplying the largest share as the fulfillment location', () => {
    const result = runAllocationEngine(input({ supplies, demands: [demand(1, 'A1', 'MED', 12)] }));
    expect(line(result, 1).fulfillmentLocationId).toBe(2);
  });
});

describe('Determinism and idempotency', () => {
  const base: EngineInput = input({
    leadTimeDays: 7,
    supplies: [onHand(1, 'NJ', 5), onHand(2, 'CA', 6), inbound(3, 1, 'NJ', '2026-11-12', 4)],
    demands: [
      demand(1, 'A101', 'LOW', 4, { orderCreatedAt: '2026-11-03T00:00:00.000Z' }),
      demand(2, 'A102', 'HIGH', 6, { orderCreatedAt: '2026-11-04T00:00:00.000Z' }),
      demand(3, 'A103', 'MED', 5, { orderCreatedAt: '2026-11-02T00:00:00.000Z', preferredLocationId: 2 }),
      demand(4, 'A104', 'MED', 10),
    ],
  });

  it('produces identical output when the input arrays are reordered', () => {
    const shuffled: EngineInput = {
      ...base,
      supplies: [...base.supplies].reverse(),
      demands: [...base.demands].reverse(),
    };
    expect(runAllocationEngine(shuffled)).toEqual(runAllocationEngine(base));
  });

  it('is repeatable: running the engine again on the same input yields the same result', () => {
    const first = runAllocationEngine(base);
    const second = runAllocationEngine(base);
    expect(second).toEqual(first);
  });

  it('never allocates more than the supply available in any source', () => {
    const result = runAllocationEngine(base);
    for (const s of base.supplies) {
      const used = result.lines.flatMap((l) => l.allocations).filter((a) => a.sourceKey === s.key);
      const total = used.reduce((sum, a) => sum + a.quantity, 0);
      expect(total).toBeLessThanOrEqual(s.quantity);
    }
  });

  it('conserves quantity: allocated + backordered equals open quantity for every line', () => {
    const result = runAllocationEngine(base);
    for (const d of base.demands) {
      const l = line(result, d.lineId);
      expect(l.allocatedQty + l.backorderedQty).toBe(d.openQty);
    }
  });

  it('ignores lines with no open quantity (fully shipped)', () => {
    const result = runAllocationEngine(input({ supplies: [onHand(1, 'NJ', 5)], demands: [demand(1, 'A1', 'HIGH', 0)] }));
    expect(line(result, 1).allocationStatus).toBe('NOT_APPLICABLE');
    expect(line(result, 1).allocatedQty).toBe(0);
  });
});
