import { Api, createTestContext, resetDatabase, TestContext, todayPlus } from './helpers';
import { Fixtures } from './fixtures';

describe('Exceptions, planner actions and AI workflow (integration)', () => {
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
    await fx.sku('SKU-PWR', { leadTimeDays: 21 });
    await fx.sku('SKU-SSD', { leadTimeDays: 18 });
  });

  const openExceptions = async () => (await api.get('/exceptions?status=OPEN&pageSize=100')) as Array<{ id: number; type: string; order: { orderNumber: string }; severity: string }>;

  it('generates an exception, lets a planner resolve it with a note, and records the history', async () => {
    await fx.stock('SKU-PWR', 'NJ', 2);
    await fx.order('A400', 'SKU-PWR', 5, { priority: 'MED', requestedDays: 5 });
    const exc = (await openExceptions()).find((e) => e.type === 'BACKORDER' && e.order.orderNumber === 'A400');
    expect(exc).toBeDefined();

    const resolved = await api.post(`/exceptions/${exc!.id}/resolve`, { note: 'Customer agreed to a 2-week split' });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionKind).toBe('MANUAL');
    expect(resolved.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['EXCEPTION_CREATED', 'EXCEPTION_RESOLVED']));

    const again = await api.raw().post(`/api/v1/exceptions/${exc!.id}/resolve`).set('x-user-id', '1').send({ note: 'again' });
    expect(again.status).toBe(409);
  });

  it('expedite-receipt preview shows the impact, and applying it improves the promise and records a reason', async () => {
    const receipt = await fx.receipt('PO-22', 'SKU-PWR', 'NJ', 20, 10);
    const order = await fx.order('A101', 'SKU-PWR', 15, { priority: 'MED', requestedDays: 4 });
    expect(order.lines[0].calculatedPromisedDate).toBe(todayPlus(10));

    const newArrival = todayPlus(3);
    const preview = await api.post('/planner/expedite-receipt/preview', { receiptId: receipt.id, newExpectedArrival: newArrival, reason: 'Expedite to make the customer date' });
    expect(preview.impact[0].promiseBefore).toBe(todayPlus(10));
    expect(preview.impact[0].promiseAfter).toBe(newArrival);

    const before = await api.get(`/orders/${order.id}`);
    expect(before.lines[0].calculatedPromisedDate).toBe(todayPlus(10)); // preview did not persist

    const applied = await api.post('/planner/expedite-receipt', { receiptId: receipt.id, newExpectedArrival: newArrival, reason: 'Expedite to make the customer date' });
    expect(applied.direction).toBe('EARLIER');
    expect((await api.get(`/orders/${order.id}`)).lines[0].calculatedPromisedDate).toBe(newArrival);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PLANNER_EXPEDITE_RECEIPT', reason: 'Expedite to make the customer date' } })).toBe(1);
  });

  it('expedite rejects a date that is not earlier', async () => {
    const receipt = await fx.receipt('PO-23', 'SKU-PWR', 'NJ', 5, 4);
    const res = await api.raw().post('/api/v1/planner/expedite-receipt').set('x-user-id', '1').send({ receiptId: receipt.id, newExpectedArrival: todayPlus(9), reason: 'should fail' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_AN_EXPEDITE');
  });

  it('reassign-location lists every location with stock, and applying moves the line to the chosen warehouse', async () => {
    await fx.stock('SKU-PWR', 'CA', 10);
    const order = await fx.order('A401', 'SKU-PWR', 8, { priority: 'MED' });
    const lineId = order.lines[0].id;
    const preview = await api.post('/planner/reassign-location/preview', { orderLineId: lineId });
    expect(preview.options.length).toBeGreaterThanOrEqual(2);
    const nj = preview.options.find((o: { locationCode: string }) => o.locationCode === 'NJ');
    expect(nj.onHand).toBe(0);

    const applied = await api.post('/planner/reassign-location', { orderLineId: lineId, locationId: fx.locs['CA'], reason: 'Customer prefers CA' });
    expect(applied.after.preferredLocation).toBe('CA');
    expect(applied.after.fulfillmentLocation).toBe('CA');
  });

  it('manual promise override requires a justification, keeps the calculated date, and is flagged', async () => {
    const order = await fx.order('A402', 'SKU-SSD', 3, { priority: 'HIGH', requestedDays: 1 });
    const lineId = order.lines[0].id;
    const short = await api.raw().post('/api/v1/planner/override-promise').set('x-user-id', '1').send({ orderLineId: lineId, promisedDate: todayPlus(5), justification: 'ok' });
    expect(short.status).toBe(400);

    const res = await api.post('/planner/override-promise', { orderLineId: lineId, promisedDate: todayPlus(5), justification: 'Customer accepted a delayed date by phone' });
    expect(res.after.manualPromisedDate).toBe(todayPlus(5));
    expect(res.after.calculatedPromisedDate).toBe(res.before.calculatedPromisedDate);
    const detail = await api.get(`/orders/${order.id}`);
    expect(detail.lines[0].manualPromisedDate).toBe(todayPlus(5));
    expect(detail.lines[0].effectivePromisedDate).toBe(todayPlus(5));
    expect(detail.lines[0].calculatedPromisedDate).toBe(res.before.calculatedPromisedDate);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PLANNER_PROMISE_OVERRIDE' } })).toBe(1);
  });

  it('split shipment ships part now and leaves the remainder allocated or backordered', async () => {
    await fx.stock('SKU-PWR', 'NJ', 6);
    const order = await fx.order('A403', 'SKU-PWR', 10, { priority: 'HIGH' });
    const res = await api.post('/planner/split-shipment', { orderId: order.id, lines: [{ orderLineId: order.lines[0].id, quantity: 6 }], reason: 'Customer wants partial ASAP' });
    expect(res.shipment.isSplit).toBe(true);
    const detail = await api.get(`/orders/${order.id}`);
    expect(detail.lines[0].shippedQty).toBe(6);
    expect(detail.lines[0].backorderedQty).toBe(4);
    expect(detail.shipments[0].isSplit).toBe(true);
  });

  describe('AI planner note: propose → validate → approve', () => {
    const NOTE = 'Vendor confirmed PO-22 slips by 5 days. Can we move Order #A104 to NJ warehouse? The customer wants partial ASAP.';

    async function seedScenario() {
      await fx.stock('SKU-PWR', 'CA', 6);
      await fx.receipt('PO-22', 'SKU-PWR', 'NJ', 40, 3);
      await fx.order('A104', 'SKU-PWR', 10, { priority: 'HIGH', requestedDays: 4, preferred: 'CA' });
    }

    it('proposes validated actions with entity confidence and persists nothing until approved', async () => {
      await seedScenario();
      const receiptBefore = await ctx.prisma.inboundReceipt.findUniqueOrThrow({ where: { receiptNumber: 'PO-22' } });

      const proposal = await api.post('/ai/planner-note', { note: NOTE }, 201);
      expect(proposal.status).toBe('PROPOSED');
      expect(proposal.provider).toBe('heuristic');
      const types = proposal.output.actions.map((a: { type: string }) => a.type);
      expect(types).toEqual(expect.arrayContaining(['DELAY_RECEIPT', 'REASSIGN_LOCATION', 'SPLIT_SHIPMENT']));
      const delay = proposal.output.actions.find((a: { type: string }) => a.type === 'DELAY_RECEIPT');
      expect(delay.valid).toBe(true);
      expect(delay.resolved.newArrival).toBe(todayPlus(8));
      expect(delay.confidence).toBeGreaterThan(0.8);
      expect(proposal.output.impact.lines.length).toBeGreaterThan(0);

      const receiptAfter = await ctx.prisma.inboundReceipt.findUniqueOrThrow({ where: { receiptNumber: 'PO-22' } });
      expect(receiptAfter.expectedArrivalTime.getTime()).toBe(receiptBefore.expectedArrivalTime.getTime());
      const a104 = await api.get(`/orders/${(await ctx.prisma.order.findUniqueOrThrow({ where: { orderNumber: 'A104' } })).id}`);
      expect(a104.preferredLocation?.locationCode).toBe('CA'); // order-level preference, untouched until approval
    });

    it('applies approved actions through the normal services and records the decision', async () => {
      await seedScenario();
      const proposal = await api.post('/ai/planner-note', { note: NOTE }, 201);
      const approved = await api.post(`/ai/planner-note/${proposal.id}/approve`, { reason: 'Looks right' });
      expect(['APPROVED', 'PARTIALLY_APPLIED']).toContain(approved.status);
      const results = approved.output.applied as Array<{ type: string; status: string }>;
      expect(results.find((r) => r.type === 'DELAY_RECEIPT')?.status).toBe('APPLIED');

      const receipt = await ctx.prisma.inboundReceipt.findUniqueOrThrow({ where: { receiptNumber: 'PO-22' } });
      expect(receipt.expectedArrivalTime.toISOString().slice(0, 10)).toBe(todayPlus(8));
      expect(await ctx.prisma.auditLog.count({ where: { action: 'AI_PROPOSAL_APPROVED', entityId: String(proposal.id) } })).toBe(1);
      expect(await ctx.prisma.aIInteraction.findUniqueOrThrow({ where: { id: proposal.id } })).toMatchObject({ status: approved.status, decidedById: 1 });
    });

    it('refuses to approve a proposal whose plan changed after it was generated', async () => {
      await seedScenario();
      const proposal = await api.post('/ai/planner-note', { note: NOTE }, 201);
      await fx.stock('SKU-PWR', 'NJ', 5); // the world changed
      const res = await api.raw().post(`/api/v1/ai/planner-note/${proposal.id}/approve`).set('x-user-id', '1').send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROPOSAL_STALE');
      const row = await ctx.prisma.aIInteraction.findUniqueOrThrow({ where: { id: proposal.id } });
      expect(row.status).toBe('STALE');
    });

    it('records a rejection with a reason and forbids approving it afterwards', async () => {
      await seedScenario();
      const proposal = await api.post('/ai/planner-note', { note: NOTE }, 201);
      const rejected = await api.post(`/ai/planner-note/${proposal.id}/reject`, { reason: 'Customer did not ask for a move' });
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.decisionReason).toBe('Customer did not ask for a move');
      const res = await api.raw().post(`/api/v1/ai/planner-note/${proposal.id}/approve`).set('x-user-id', '1').send({});
      expect(res.status).toBe(409);
    });

    it('marks actions that reference unknown entities as invalid instead of guessing', async () => {
      await seedScenario();
      const proposal = await api.post('/ai/planner-note', { note: 'Vendor confirmed PO-999 slips by 4 days.' }, 201);
      expect(proposal.output.actions).toHaveLength(0);
      const delay = await api.post('/ai/planner-note', { note: 'Vendor said PO-22 slips by 4 days but please check it.' }, 201);
      expect(delay.output.actions[0].valid).toBe(true);
    });
  });

  it('generates a customer update draft that is saved as a sent-message record', async () => {
    await fx.stock('SKU-PWR', 'NJ', 4);
    const order = await fx.order('A404', 'SKU-PWR', 6, { priority: 'HIGH', requestedDays: 3 });
    const draft = await api.post('/ai/customer-communication', { orderId: order.id, tone: 'formal' }, 201);
    expect(draft.output.body).toMatch(/A404/);
    expect(draft.output.facts.totals.backordered).toBe(2);
    expect(draft.status).toBe('GENERATED');

    const sent = await api.post(`/orders/${order.id}/communications`, { subject: draft.output.subject, body: draft.output.body, aiInteractionId: draft.id }, 201);
    expect(sent.status).toBe('SENT');
    const list = await api.get(`/orders/${order.id}/communications`);
    expect(list[0]).toMatchObject({ aiGenerated: true, status: 'SENT' });
  });

  it('exception summary is advisory and structured, and never changes data', async () => {
    await fx.stock('SKU-PWR', 'NJ', 2);
    await fx.order('A405', 'SKU-PWR', 5, { priority: 'HIGH', requestedDays: 2 });
    const exc = (await openExceptions()).find((e) => e.order.orderNumber === 'A405' && e.type === 'BACKORDER')!;
    const summary = await api.post('/ai/exception-summary', { exceptionId: exc.id }, 201);
    expect(summary.output).toEqual(expect.objectContaining({ whatHappened: expect.any(String), currentPlan: expect.any(String), nextBestActions: expect.any(Array), impact: expect.any(String) }));
    expect((await api.get(`/exceptions/${exc.id}`)).status).toBe('OPEN');
  });
});
