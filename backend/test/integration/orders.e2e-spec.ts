import { Api, createTestContext, resetDatabase, TestContext, todayPlus } from './helpers';
import { Fixtures } from './fixtures';

describe('Orders and allocation (integration)', () => {
  let ctx: TestContext;
  let api: Api;
  let fx: Fixtures;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    api = new Api(ctx.http);
    fx = new Fixtures(api);
    await fx.location('NJ');
    await fx.location('CA');
    await fx.sku('SKU-A', { leadTimeDays: 10 });
  });

  const activeAllocations = (lineId?: number) =>
    ctx.prisma.allocation.findMany({ where: { status: 'ACTIVE', ...(lineId ? { orderLineId: lineId } : {}) } });

  it('creates an order as DRAFT (no allocation), then confirming reserves supply and reduces ATP', async () => {
    await fx.stock('SKU-A', 'NJ', 10);
    const draft = await fx.order('A300', 'SKU-A', 4, { confirm: false });
    expect(draft.status).toBe('DRAFT');
    expect(draft.lines[0].allocatedQty).toBe(0);
    expect(await activeAllocations()).toHaveLength(0);

    const confirmed = await api.post(`/orders/${draft.id}/confirm`, {});
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.lines[0].allocatedQty).toBe(4);
    expect(confirmed.lines[0].allocationStatus).toBe('FULLY_ALLOCATED');

    const atp = await api.get(`/atp?skuId=${fx.skus['SKU-A']}`);
    expect(atp.total.atp).toBe(6);
  });

  it('partially allocates 6 of 10 requested units, then completes when the missing 4 are received', async () => {
    await fx.stock('SKU-A', 'NJ', 6);
    const order = await fx.order('A104', 'SKU-A', 10, { priority: 'HIGH', requestedDays: 3 });
    const line = order.lines[0];
    expect(line.allocatedQty).toBe(6);
    expect(line.backorderedQty).toBe(4);
    expect(line.allocationStatus).toBe('PARTIALLY_ALLOCATED');
    expect(line.calculatedPromisedDate).toBe(todayPlus(10)); // lead-time estimate for the backorder

    const open = await api.get('/exceptions?status=OPEN&pageSize=50');
    expect(open.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['BACKORDER', 'HIGH_PRIORITY_INSUFFICIENT_STOCK']));

    const r = await fx.receipt('PO-41', 'SKU-A', 'NJ', 4, 2);
    const withInbound = await api.get(`/orders/${order.id}`);
    expect(withInbound.lines[0].allocatedQty).toBe(10);
    expect(withInbound.lines[0].backorderedQty).toBe(0);
    expect(withInbound.lines[0].calculatedPromisedDate).toBe(todayPlus(2));
    expect(withInbound.supplyDependencies[0].receiptNumber).toBe('PO-41');

    await api.post(`/receipts/${r.id}/receive`, {});
    const received = await api.get(`/orders/${order.id}`);
    expect(received.lines[0].allocatedQty).toBe(10);
    expect(received.lines[0].calculatedPromisedDate).toBe(new Date().toISOString().slice(0, 10));
    expect(received.supplyDependencies).toHaveLength(0);

    const stillBackordered = (await api.get('/exceptions?status=OPEN&pageSize=50')).filter((e: { type: string; order: { orderNumber: string } }) => e.type === 'BACKORDER' && e.order.orderNumber === 'A104');
    expect(stillBackordered).toHaveLength(0);
    const resolved = await ctx.prisma.exception.findMany({ where: { resolutionKind: 'AUTO_RESOLVED' } });
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('gives supply to the HIGH priority order when two orders compete for the last units', async () => {
    await fx.stock('SKU-A', 'NJ', 5);
    const low = await fx.order('A110', 'SKU-A', 5, { priority: 'LOW' });
    const high = await fx.order('A111', 'SKU-A', 5, { priority: 'HIGH' });
    expect((await api.get(`/orders/${high.id}`)).lines[0].allocatedQty).toBe(5);
    expect((await api.get(`/orders/${low.id}`)).lines[0].allocatedQty).toBe(0);
  });

  it('never allocates the same units twice under concurrent order creation', async () => {
    await fx.stock('SKU-A', 'NJ', 5);
    const requests = Array.from({ length: 8 }, (_, i) =>
      ctx.http
        .post('/api/v1/orders')
        .set('x-user-id', '1')
        .send({ orderNumber: `RACE-${i}`, customerName: 'Race Customer', priority: 'MED', confirm: true, lines: [{ skuId: fx.skus['SKU-A'], quantity: 1 }] }),
    );
    const responses = await Promise.all(requests);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));

    const allocated = (await activeAllocations()).reduce((s, a) => s + a.quantity, 0);
    expect(allocated).toBe(5);
    const bal = await ctx.prisma.inventoryBalance.findFirst({ where: { skuId: fx.skus['SKU-A'] } });
    expect(bal?.onHand).toBe(5);
    expect(allocated).toBeLessThanOrEqual(bal!.onHand);
  });

  it('recalculates without duplicating allocations when an order quantity is edited', async () => {
    await fx.stock('SKU-A', 'NJ', 20);
    const order = await fx.order('A301', 'SKU-A', 5);
    const lineId = order.lines[0].id;

    await api.patch(`/orders/${order.id}`, { version: order.version, updateLines: [{ lineId, quantity: 12 }] });
    const afterIncrease = await api.get(`/orders/${order.id}`);
    expect(afterIncrease.lines[0].allocatedQty).toBe(12);
    const rows = await activeAllocations(lineId);
    expect(rows.reduce((s, r) => s + r.quantity, 0)).toBe(12);
    expect(new Set(rows.map((r) => r.activeKey)).size).toBe(rows.length);

    await api.patch(`/orders/${order.id}`, { version: afterIncrease.version, updateLines: [{ lineId, quantity: 3 }] });
    const afterDecrease = await api.get(`/orders/${order.id}`);
    expect(afterDecrease.lines[0].allocatedQty).toBe(3);
    expect((await activeAllocations(lineId)).reduce((s, r) => s + r.quantity, 0)).toBe(3);
    // Quantity changes update the existing allocation row in place: exactly one ACTIVE row, no duplicates.
    expect(await activeAllocations(lineId)).toHaveLength(1);
  });

  it('rejects an edit made against a stale order version', async () => {
    await fx.stock('SKU-A', 'NJ', 20);
    const order = await fx.order('A302', 'SKU-A', 5);
    await api.patch(`/orders/${order.id}`, { version: order.version, priority: 'HIGH' });
    const res = await api.raw().patch(`/api/v1/orders/${order.id}`).set('x-user-id', '1').send({ version: order.version, priority: 'LOW' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('releases allocations on cancellation and gives the freed supply to a backordered order', async () => {
    await fx.stock('SKU-A', 'NJ', 10);
    const first = await fx.order('A310', 'SKU-A', 10, { priority: 'LOW' });
    const waiting = await fx.order('A311', 'SKU-A', 4, { priority: 'LOW' });
    expect((await api.get(`/orders/${waiting.id}`)).lines[0].backorderedQty).toBe(4);

    const canceled = await api.post(`/orders/${first.id}/cancel`, { reason: 'Customer no longer needs these' });
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.releasedUnits).toBe(10);

    const after = await api.get(`/orders/${waiting.id}`);
    expect(after.lines[0].allocatedQty).toBe(4);
    expect(after.lines[0].backorderedQty).toBe(0);
    expect(await ctx.prisma.allocation.count({ where: { orderLine: { orderId: first.id }, status: 'ACTIVE' } })).toBe(0);
  });

  it('refuses to cancel an order that is partially shipped', async () => {
    await fx.stock('SKU-A', 'NJ', 10);
    const order = await fx.order('A312', 'SKU-A', 6);
    await api.post(`/orders/${order.id}/ship`, { lines: [{ orderLineId: order.lines[0].id, quantity: 2 }] });
    const res = await api.raw().post(`/api/v1/orders/${order.id}/cancel`).set('x-user-id', '1').send({ reason: 'changed mind' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_PARTIALLY_SHIPPED');
  });

  it('ships from on-hand allocations, decrements inventory once, and keeps the remainder allocated', async () => {
    await fx.stock('SKU-A', 'NJ', 10);
    const order = await fx.order('A313', 'SKU-A', 6);
    const res = await api.post(`/orders/${order.id}/ship`, { lines: [{ orderLineId: order.lines[0].id, quantity: 4 }], reason: 'First tranche' });
    expect(res.orderStatus).toBe('FULFILLING');

    const bal = await ctx.prisma.inventoryBalance.findFirst({ where: { skuId: fx.skus['SKU-A'] } });
    expect(bal?.onHand).toBe(6);
    const detail = await api.get(`/orders/${order.id}`);
    expect(detail.lines[0].shippedQty).toBe(4);
    expect(detail.lines[0].allocatedQty).toBe(2);
    expect(detail.shipments).toHaveLength(1);
    expect(detail.shipments[0].isSplit).toBe(true);
  });

  it('refuses to ship units that are only allocated from inbound stock that has not arrived', async () => {
    await fx.receipt('PO-50', 'SKU-A', 'NJ', 5, 4);
    const order = await fx.order('A314', 'SKU-A', 5);
    const res = await api.raw().post(`/api/v1/orders/${order.id}/ship`).set('x-user-id', '1').send({ lines: [{ orderLineId: order.lines[0].id, quantity: 5 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SHIP_QTY_NOT_AVAILABLE');
  });

  it('recalculation is repeatable: a second run on unchanged data changes nothing', async () => {
    await fx.stock('SKU-A', 'NJ', 7);
    await fx.order('A320', 'SKU-A', 5, { priority: 'HIGH' });
    await fx.order('A321', 'SKU-A', 5, { priority: 'LOW' });
    const first = await api.post('/allocations/recalculate', { skuIds: [fx.skus['SKU-A']] });
    const second = await api.post('/allocations/recalculate', { skuIds: [fx.skus['SKU-A']] });
    expect(second.changedLines).toBe(0);
    expect(second.exceptionsCreated).toBe(0);
    expect(second.exceptionsResolved).toBe(0);
    expect(first).toBeDefined();
  });

  it('rejects duplicate order numbers and unknown SKUs with clear codes', async () => {
    await fx.stock('SKU-A', 'NJ', 3);
    await fx.order('A330', 'SKU-A', 1);
    const dup = await api.raw().post('/api/v1/orders').set('x-user-id', '1').send({ orderNumber: 'A330', customerName: 'X Customer', priority: 'LOW', lines: [{ skuId: fx.skus['SKU-A'], quantity: 1 }] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ORDER_NUMBER_EXISTS');

    const unknown = await api.raw().post('/api/v1/orders').set('x-user-id', '1').send({ orderNumber: 'A331', customerName: 'X Customer', priority: 'LOW', lines: [{ skuId: 999999, quantity: 1 }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('SKU_NOT_FOUND');
  });

  it('preview reports expected fulfillment and persists nothing', async () => {
    await fx.stock('SKU-A', 'NJ', 4);
    const preview = await api.post('/orders/preview', {
      customerName: 'Preview Co',
      priority: 'HIGH',
      requestedShipDate: todayPlus(3),
      lines: [{ skuId: fx.skus['SKU-A'], quantity: 6 }],
    });
    expect(preview.persisted).toBe(false);
    expect(preview.lines[0].allocatedQty).toBe(4);
    expect(preview.lines[0].backorderedQty).toBe(2);
    expect(await ctx.prisma.order.count()).toBe(0);
    expect(await activeAllocations()).toHaveLength(0);
  });
});
