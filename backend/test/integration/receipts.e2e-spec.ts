import { Api, createTestContext, resetDatabase, TestContext } from './helpers';
import { Fixtures } from './fixtures';
import { todayPlus } from './helpers';

describe('Inbound receipts: idempotent receiving and cancellation (integration)', () => {
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

  const onHand = async (sku: string, loc: string) => {
    const row = await ctx.prisma.inventoryBalance.findUnique({
      where: { skuId_locationId: { skuId: fx.skus[sku], locationId: fx.locs[loc] } },
    });
    return row?.onHand ?? 0;
  };
  const ledgerCount = (receiptId: number) =>
    ctx.prisma.inventoryAdjustment.count({ where: { referenceKey: `RECEIPT:${receiptId}` } });

  it('increases on-hand exactly once when a receipt is received', async () => {
    const r = await fx.receipt('PO-1', 'SKU-A', 'NJ', 20, 2);
    const res = await api.post(`/receipts/${r.id}/receive`, {});

    expect(res.idempotent).toBe(false);
    expect(res.status).toBe('RECEIVED');
    expect(await onHand('SKU-A', 'NJ')).toBe(20);
    expect(await ledgerCount(r.id)).toBe(1);
  });

  it('is idempotent: receiving the same receipt again does not add inventory', async () => {
    const r = await fx.receipt('PO-2', 'SKU-A', 'NJ', 15, 1);
    await api.post(`/receipts/${r.id}/receive`, {});
    const second = await api.post(`/receipts/${r.id}/receive`, {});
    const third = await api.post(`/receipts/${r.id}/receive`, {});

    expect(second.idempotent).toBe(true);
    expect(third.idempotent).toBe(true);
    expect(await onHand('SKU-A', 'NJ')).toBe(15);
    expect(await ledgerCount(r.id)).toBe(1);
  });

  it('never double-counts under concurrent receive requests', async () => {
    const r = await fx.receipt('PO-3', 'SKU-A', 'NJ', 12, 1);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => ctx.http.post(`/api/v1/receipts/${r.id}/receive`).set('x-user-id', '1').send({})),
    );
    expect(responses.every((res) => res.status === 200 || res.status === 201)).toBe(true);
    const fresh = responses.filter((res) => res.body.data.idempotent === false);
    expect(fresh).toHaveLength(1);
    expect(await onHand('SKU-A', 'NJ')).toBe(12);
    expect(await ledgerCount(r.id)).toBe(1);
  });

  it('does not count a received receipt as future incoming supply', async () => {
    const r = await fx.receipt('PO-4', 'SKU-A', 'NJ', 9, 3);
    const before = await api.get(`/atp?skuId=${fx.skus['SKU-A']}`);
    expect(before.byLocation.find((l: { locationCode: string }) => l.locationCode === 'NJ').incoming).toBe(9);

    await api.post(`/receipts/${r.id}/receive`, {});
    const after = await api.get(`/atp?skuId=${fx.skus['SKU-A']}`);
    const nj = after.byLocation.find((l: { locationCode: string }) => l.locationCode === 'NJ');
    expect(nj.incoming).toBe(0);
    expect(nj.onHand).toBe(9);
    expect(nj.atp).toBe(9);
  });

  it('removes a canceled receipt from ATP and opens CANCELED_INBOUND_DEPENDENCY for dependent orders', async () => {
    const r = await fx.receipt('PO-5', 'SKU-A', 'NJ', 10, 3);
    const order = await fx.order('A200', 'SKU-A', 8, { priority: 'HIGH', requestedDays: 5 });
    expect(order.lines[0].allocatedQty).toBe(8);

    const canceled = await api.post(`/receipts/${r.id}/cancel`, { reason: 'Supplier withdrew the lot' });
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.dependentLines).toEqual([{ orderNumber: 'A200', releasedQty: 8 }]);

    const detail = await api.get(`/orders/${order.id}`);
    expect(detail.lines[0].allocatedQty).toBe(0);
    expect(detail.lines[0].backorderedQty).toBe(8);

    const exceptions = await api.get(`/exceptions?status=OPEN&pageSize=50`);
    const types = exceptions.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['CANCELED_INBOUND_DEPENDENCY', 'BACKORDER', 'HIGH_PRIORITY_INSUFFICIENT_STOCK']));
    const dep = exceptions.find((e: { type: string }) => e.type === 'CANCELED_INBOUND_DEPENDENCY');
    expect(dep.affectedQty).toBe(8);

    const atp = await api.get(`/atp?skuId=${fx.skus['SKU-A']}`);
    expect(atp.total.atp).toBe(0);
  });

  it('refuses to cancel a receipt that has already been received', async () => {
    const r = await fx.receipt('PO-6', 'SKU-A', 'NJ', 5, 0);
    await api.post(`/receipts/${r.id}/receive`, {});
    const res = await api.raw().post(`/api/v1/receipts/${r.id}/cancel`).set('x-user-id', '1').send({ reason: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECEIPT_ALREADY_RECEIVED');
    expect(await onHand('SKU-A', 'NJ')).toBe(5);
  });

  it('delaying an expected arrival moves the promise and raises DELAYED_INBOUND and PROMISE_DATE_AT_RISK', async () => {
    const r = await fx.receipt('PO-7', 'SKU-A', 'NJ', 6, 2);
    const order = await fx.order('A201', 'SKU-A', 6, { priority: 'MED', requestedDays: 4 });
    expect(order.promisedShipDate).toBe(todayPlus(2));

    const delayedTo = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await api.patch(`/receipts/${r.id}`, { expectedArrivalTime: delayedTo, reason: 'Vendor reported a port delay' });
    expect(res.delta.direction).toBe('LATER');
    expect(res.delta.days).toBe(5);

    const detail = await api.get(`/orders/${order.id}`);
    expect(detail.lines[0].calculatedPromisedDate).toBe(delayedTo);
    expect(detail.promisedShipDate).toBe(delayedTo);

    const types = (await api.get('/exceptions?status=OPEN&pageSize=50')).map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['DELAYED_INBOUND', 'PROMISE_DATE_AT_RISK']));

    const audit = await ctx.prisma.auditLog.findMany({ where: { entityType: 'InboundReceipt', entityId: String(r.id), action: 'RECEIPT_DELAYED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].reason).toBe('Vendor reported a port delay');
  });

  it('requires a reason when the expected arrival changes', async () => {
    const r = await fx.receipt('PO-8', 'SKU-A', 'NJ', 6, 2);
    const later = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    const res = await api.raw().patch(`/api/v1/receipts/${r.id}`).set('x-user-id', '1').send({ expectedArrivalTime: later });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REASON_REQUIRED');
  });
});
