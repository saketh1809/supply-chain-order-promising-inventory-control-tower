#!/usr/bin/env node
/**
 * Runs the five demo scenarios from the specification against a running API and asserts the
 * business outcomes (not just HTTP codes). Run on a freshly seeded database:
 *
 *   npm --prefix backend run seed -- --reset
 *   node scripts/demo-scenarios.mjs            # API_BASE=http://localhost:3000/api/v1 by default
 *
 * Scenarios 2–5 change data; re-seed before running them again.
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const USER = process.env.ACTOR_ID ?? '1';

const H = { 'content-type': 'application/json', 'x-user-id': USER };
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`);
  return json.data;
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b ?? {});
const patch = (p, b) => call('PATCH', p, b);

const today = new Date();
const day = (n) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);

let failures = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

// List endpoints return the page of items directly in `data` (pagination lives in `meta`).
async function orderByNumber(n) {
  const items = await get(`/orders?search=${encodeURIComponent(n)}&pageSize=5`);
  const hit = items.find((o) => o.orderNumber === n);
  if (!hit) throw new Error(`order ${n} not found; seed the database first`);
  return get(`/orders/${hit.id}`);
}
async function receiptByNumber(n) {
  const items = await get(`/receipts?search=${encodeURIComponent(n)}&pageSize=5`);
  return items.find((r) => r.receiptNumber === n) ?? null;
}
async function openExceptionsFor(orderNumber) {
  const items = await get(`/exceptions?status=OPEN&pageSize=100&search=${encodeURIComponent(orderNumber)}`);
  return items.filter((e) => e.order.orderNumber === orderNumber);
}
async function locationId(code) {
  const items = await get('/locations?pageSize=50');
  return items.find((l) => l.locationCode === code).id;
}

async function s1() {
  console.log('\nScenario 1 · HIGH vs LOW competing for limited stock (SKU-MON-27 at CA)');
  const high = await orderByNumber('A111');
  const low = await orderByNumber('A110');
  check('A111 (HIGH, 12 units) is fully allocated', high.lines[0].allocatedQty === 12 && high.lines[0].backorderedQty === 0, JSON.stringify(high.lines[0]));
  check('A110 (LOW, 15 units) receives the remainder and is short', low.lines[0].backorderedQty > 0 && low.lines[0].allocatedQty + low.lines[0].backorderedQty === 15, JSON.stringify(low.lines[0]));
}

async function s2() {
  console.log('\nScenario 2 · 10 requested, 6 available: allocate 6, backorder 4; then receive more');
  const a104 = await orderByNumber('A104');
  check('A104 has 6 allocated and 4 backordered', a104.lines[0].allocatedQty === 6 && a104.lines[0].backorderedQty === 4, JSON.stringify(a104.lines[0]));
  let rec = await receiptByNumber('PO-41');
  if (!rec) {
    rec = await post('/receipts', { receiptNumber: 'PO-41', skuId: a104.lines[0].sku.id, locationId: await locationId('NJ'), quantity: 4, expectedArrivalTime: day(2) });
  }
  const afterInbound = await orderByNumber('A104');
  check('Creating PO-41 (4 units, arrives in 2 days) completes the allocation automatically', afterInbound.lines[0].allocatedQty === 10 && afterInbound.lines[0].backorderedQty === 0, JSON.stringify(afterInbound.lines[0]));
  await post(`/receipts/${rec.id}/receive`, {});
  const afterReceive = await orderByNumber('A104');
  check('Receiving PO-41 keeps 10 allocated and is not double-counted', afterReceive.lines[0].allocatedQty === 10, JSON.stringify(afterReceive.lines[0]));
  const again = await post(`/receipts/${rec.id}/receive`, {});
  check('Receiving PO-41 a second time reports idempotent: true', again.idempotent === true);
  const exc = await openExceptionsFor('A104');
  check('BACKORDER exception for A104 is gone', !exc.some((e) => e.type === 'BACKORDER'));
}

async function s3() {
  console.log('\nScenario 3 · Delay PO-22 by 5 days: dependent promises move and exceptions appear');
  const po22 = await receiptByNumber('PO-22');
  const before = await orderByNumber('A101');
  const target = day(3 + 5);
  const res = await patch(`/receipts/${po22.id}`, { expectedArrivalTime: target, reason: 'Vendor confirmed a 5-day slip' });
  check('PO-22 arrival moved later with a direction of LATER', res.delta.direction === 'LATER' && res.delta.days === 5, JSON.stringify(res.delta));
  const after = await orderByNumber('A101');
  check('A101 promise moved with the receipt', after.lines[0].calculatedPromisedDate === target, `before=${before.lines[0].calculatedPromisedDate} after=${after.lines[0].calculatedPromisedDate}`);
  const exc = await openExceptionsFor('A101');
  check('DELAYED_INBOUND and PROMISE_DATE_AT_RISK raised for A101', exc.some((e) => e.type === 'DELAYED_INBOUND') && exc.some((e) => e.type === 'PROMISE_DATE_AT_RISK'), JSON.stringify(exc.map((e) => e.type)));
}

async function s4() {
  console.log('\nScenario 4 · Cancel inbound PO-27: dependent order lines are exposed');
  const po27 = await receiptByNumber('PO-27');
  const before = await orderByNumber('A108');
  check('A108 depends on PO-27 before the cancel (allocated above on-hand)', before.lines[0].allocatedQty === 40 && before.supplyDependencies.some((d) => d.receiptNumber === 'PO-27'));
  const res = await post(`/receipts/${po27.id}/cancel`, { reason: 'Supplier canceled the lot' });
  check('PO-27 is CANCELED and reports the affected lines', res.status === 'CANCELED' && res.dependentLines.length >= 1, JSON.stringify(res.dependentLines));
  const after = await orderByNumber('A108');
  check('A108 loses the 30 units that came from PO-27 and is backordered', after.lines[0].backorderedQty === 30, JSON.stringify(after.lines[0]));
  const exc = await openExceptionsFor('A108');
  const dep = exc.find((e) => e.type === 'CANCELED_INBOUND_DEPENDENCY');
  check('CANCELED_INBOUND_DEPENDENCY exception with 30 affected units', !!dep && dep.affectedQty === 30, JSON.stringify(dep ?? null));
  check('HIGH priority insufficient stock is also raised', exc.some((e) => e.type === 'HIGH_PRIORITY_INSUFFICIENT_STOCK'));
}

async function s5() {
  console.log('\nScenario 5 · Cancel A120: its released docks cover the backordered A126');
  const a126 = await orderByNumber('A126');
  check('A126 starts short of dock stock', a126.lines[0].backorderedQty > 0, JSON.stringify(a126.lines[0]));
  const a120 = await orderByNumber('A120');
  const res = await post(`/orders/${a120.id}/cancel`, { reason: 'Customer withdrew the docks' });
  check('A120 is CANCELED and reports released units', res.status === 'CANCELED' && res.releasedUnits === 10, JSON.stringify({ status: res.status, released: res.releasedUnits }));
  const after = await orderByNumber('A126');
  check('A126 now has full allocation from the released supply', after.lines[0].backorderedQty === 0 && after.lines[0].allocatedQty === 8, JSON.stringify(after.lines[0]));
}

(async () => {
  console.log(`Demo scenarios against ${BASE}`);
  try {
    await s1();
    await s2();
    await s3();
    await s4();
    await s5();
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${err.message}`);
  }
  console.log(failures === 0 ? '\nAll scenario checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})();
