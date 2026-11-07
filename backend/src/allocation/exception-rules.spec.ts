import { evaluateLineExceptions, LineFacts } from './exception-rules';
import { projectAtp, firstShortageDate } from './atp';

const base = (partial: Partial<LineFacts>): LineFacts => ({
  lineId: 1,
  priority: 'MED',
  isActive: true,
  openQty: 10,
  backorderedQty: 0,
  requestedShipDate: '2026-11-10',
  effectivePromisedDate: '2026-11-10',
  skuCode: 'SKU-1',
  unusedInbound: [],
  inboundDependencies: [],
  ...partial,
});

describe('Exception generation rules', () => {
  it('raises no exceptions for a healthy, on-time line', () => {
    expect(evaluateLineExceptions(base({}))).toEqual([]);
  });

  it('raises no exceptions for inactive lines (draft, canceled, shipped)', () => {
    expect(evaluateLineExceptions(base({ isActive: false, backorderedQty: 4 }))).toEqual([]);
  });

  it('raises BACKORDER and HIGH_PRIORITY_INSUFFICIENT_STOCK for a short HIGH priority line', () => {
    const types = evaluateLineExceptions(
      base({ priority: 'HIGH', backorderedQty: 4, effectivePromisedDate: '2026-11-10' }),
    ).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['BACKORDER', 'HIGH_PRIORITY_INSUFFICIENT_STOCK']));
  });

  it('marks a short HIGH priority line CRITICAL', () => {
    const backorder = evaluateLineExceptions(base({ priority: 'HIGH', backorderedQty: 4 })).find(
      (e) => e.type === 'BACKORDER',
    );
    expect(backorder?.severity).toBe('CRITICAL');
    expect(backorder?.affectedQty).toBe(4);
  });

  it('bumps backorder severity when the line has no committed promise', () => {
    const e = evaluateLineExceptions(base({ priority: 'LOW', backorderedQty: 3, effectivePromisedDate: null })).find(
      (x) => x.type === 'BACKORDER',
    );
    expect(e?.severity).toBe('HIGH');
  });

  it('raises PROMISE_DATE_AT_RISK when the promise is later than the requested date', () => {
    const e = evaluateLineExceptions(
      base({ priority: 'HIGH', effectivePromisedDate: '2026-11-14', requestedShipDate: '2026-11-10' }),
    ).find((x) => x.type === 'PROMISE_DATE_AT_RISK');
    expect(e).toBeDefined();
    expect(e?.details).toEqual({ lateDays: 4 });
    expect(e?.severity).toBe('CRITICAL');
  });

  it('does not raise PROMISE_DATE_AT_RISK when the promise meets the requested date', () => {
    const types = evaluateLineExceptions(base({ effectivePromisedDate: '2026-11-09' })).map((e) => e.type);
    expect(types).not.toContain('PROMISE_DATE_AT_RISK');
  });

  it('raises DELAYED_INBOUND per receipt that slipped past its original arrival', () => {
    const exceptions = evaluateLineExceptions(
      base({
        inboundDependencies: [
          {
            receiptId: 42,
            receiptNumber: 'PO-22',
            quantity: 6,
            status: 'IN_TRANSIT',
            expectedArrival: '2026-11-15',
            originalExpectedArrival: '2026-11-10',
            locationCode: 'NJ',
          },
        ],
        effectivePromisedDate: '2026-11-15',
      }),
    );
    const delayed = exceptions.find((e) => e.type === 'DELAYED_INBOUND');
    expect(delayed?.receiptId).toBe(42);
    expect(delayed?.affectedQty).toBe(6);
    expect(delayed?.severity).toBe('HIGH');
    expect(delayed?.details).toMatchObject({ delayDays: 5 });
  });
});

describe('Time-phased ATP projection', () => {
  it('accumulates inbound supply and committed demand by day', () => {
    const points = projectAtp({
      asOfDate: '2026-11-06',
      horizonDays: 6,
      onHand: 10,
      inbound: [{ date: '2026-11-08', quantity: 5, reference: 'PO-1' }],
      demand: [
        { date: '2026-11-07', quantity: 12, reference: 'A1' },
        { date: '2026-11-09', quantity: 1, reference: 'A2' },
      ],
    });
    // d0: 10 | d1: 10-12 = -2 (shortage until inbound lands) | d2: +5 inbound => 3 | d3: -1 => 2 | flat after
    expect(points.map((p) => p.atp)).toEqual([10, -2, 3, 2, 2, 2, 2]);
    expect(firstShortageDate(points)).toBe('2026-11-07');
  });

  it('reports the first day a projected shortage occurs', () => {
    const points = projectAtp({
      asOfDate: '2026-11-06',
      horizonDays: 3,
      onHand: 2,
      inbound: [],
      demand: [{ date: '2026-11-07', quantity: 5, reference: 'A1' }],
    });
    expect(firstShortageDate(points)).toBe('2026-11-07');
  });
});
