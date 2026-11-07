import { Api, createTestContext, resetDatabase, TestContext } from './helpers';
import { Fixtures } from './fixtures';

describe('Inventory, catalog and audit integrity (integration)', () => {
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
    await fx.sku('SKU-Z');
  });

  it('requires a mandatory reason for inventory adjustments', async () => {
    const res = await api.raw().post('/api/v1/inventory/adjustments').set('x-user-id', '1').send({ skuId: fx.skus['SKU-Z'], locationId: fx.locs['NJ'], quantityDelta: 5 });
    expect(res.status).toBe(400);
  });

  it('previews an adjustment without persisting it, then posts it with an audit record and an append-only ledger row', async () => {
    await fx.stock('SKU-Z', 'NJ', 10);
    const preview = await api.post('/inventory/adjustments/preview', { skuId: fx.skus['SKU-Z'], locationId: fx.locs['NJ'], quantityDelta: -3, reason: 'Damaged in count' });
    expect(preview.previousOnHand).toBe(10);
    expect(preview.newOnHand).toBe(7);
    expect((await ctx.prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: fx.skus['SKU-Z'] } })).onHand).toBe(10);

    const posted = await api.post('/inventory/adjustments', { skuId: fx.skus['SKU-Z'], locationId: fx.locs['NJ'], quantityDelta: -3, reason: 'Damaged in count' });
    expect(posted.previousOnHand).toBe(10);
    expect(posted.newOnHand).toBe(7);
    const ledger = await ctx.prisma.inventoryAdjustment.findMany({ where: { skuId: fx.skus['SKU-Z'] }, orderBy: { id: 'asc' } });
    expect(ledger.map((l) => l.quantityDelta)).toEqual([10, -3]);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'INVENTORY_ADJUSTED' } })).toBe(2);
  });

  it('never lets on-hand inventory go negative', async () => {
    await fx.stock('SKU-Z', 'NJ', 2);
    const res = await api.raw().post('/api/v1/inventory/adjustments').set('x-user-id', '1').send({ skuId: fx.skus['SKU-Z'], locationId: fx.locs['NJ'], quantityDelta: -5, reason: 'Count error test' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await ctx.prisma.inventoryBalance.findFirstOrThrow({ where: { skuId: fx.skus['SKU-Z'] } })).onHand).toBe(2);
  });

  it('rejects a duplicate SKU code and refuses to delete a SKU that has history', async () => {
    const dup = await api.raw().post('/api/v1/skus').set('x-user-id', '1').send({ skuCode: 'SKU-Z', name: 'Dup' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SKU_CODE_EXISTS');

    await fx.stock('SKU-Z', 'NJ', 1);
    const del = await api.raw().delete(`/api/v1/skus/${fx.skus['SKU-Z']}`).set('x-user-id', '1');
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('SKU_IN_USE');
  });

  it('deletes an unused SKU and records the deletion', async () => {
    const sku = await fx.sku('SKU-UNUSED');
    const res = await api.raw().delete(`/api/v1/skus/${sku}`).set('x-user-id', '1');
    expect(res.status).toBe(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SKU_DELETED', entityId: String(sku) } })).toBe(1);
  });

  it('keeps the audit trail immutable at the database level', async () => {
    await fx.stock('SKU-Z', 'NJ', 1);
    const row = await ctx.prisma.auditLog.findFirstOrThrow();
    await expect(ctx.prisma.$executeRawUnsafe(`UPDATE AuditLog SET action = 'TAMPERED' WHERE id = ${row.id}`)).rejects.toThrow(/immutable/i);
    await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM AuditLog WHERE id = ${row.id}`)).rejects.toThrow(/immutable/i);
  });

  it('keeps the inventory ledger append-only at the database level', async () => {
    await fx.stock('SKU-Z', 'NJ', 4);
    const row = await ctx.prisma.inventoryAdjustment.findFirstOrThrow();
    await expect(ctx.prisma.$executeRawUnsafe(`UPDATE InventoryAdjustment SET quantityDelta = 999 WHERE id = ${row.id}`)).rejects.toThrow(/append-only/i);
    await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM InventoryAdjustment WHERE id = ${row.id}`)).rejects.toThrow(/append-only/i);
  });

  it('exposes audit logs with filters for entity type and action', async () => {
    await fx.stock('SKU-Z', 'NJ', 3);
    const logs = await api.get('/audit-logs?entityType=InventoryAdjustment&action=INVENTORY_ADJUSTED');
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.every((l: { entityType: string }) => l.entityType === 'InventoryAdjustment')).toBe(true);
  });
});
