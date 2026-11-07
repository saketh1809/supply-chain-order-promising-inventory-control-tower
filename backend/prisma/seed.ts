/**
 * Demo seed. Runs through the REAL application services (inside a Nest application context), so the
 * seeded state is exactly what the business rules produce: allocations, exceptions, ledger rows and
 * audit records are all genuine.
 *
 *   npm run seed            # seed if the database is empty (no-op otherwise)
 *   npm run seed -- --reset # truncate all application tables, then seed
 *
 * Scenarios seeded (see README "Demo scenarios"):
 *   S1  A110 (LOW) vs A111 (HIGH) compete for SKU-MON-27 stock at CA.
 *   S2  A104 (HIGH) requests 10 keyboards, only 6 exist: 6 allocated, 4 backordered.
 *   S3  A101 depends on PO-22 (PWR-65W at NJ). Slipping PO-22 moves the promise past the requested date.
 *   S4  A108 (HIGH) depends on PO-27 (SSD at CA). Canceling PO-27 raises exceptions.
 *   S5  A126 (LOW) is backordered 6 docks. Cancel A120 (LOW, 10 docks) and its released supply covers A126.
 *       (A124 was already canceled in the seed, so the cancellation history is visible.)
 * Also seeded: a RECEIVED receipt (PO-18), a CANCELED receipt (PO-30), a DELAYED receipt (PO-24),
 * a DRAFT order (A123), a partially shipped order (A102, FULFILLING) and a fully shipped order (A125).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { SkusService } from '../src/skus/skus.service';
import { LocationsService } from '../src/locations/locations.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { OrdersService } from '../src/orders/orders.service';
import { AllocationService } from '../src/allocation/allocation.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { addDaysYmd, todayYmd } from '../src/common/dates';

const ACTOR_PLANNER = 1;

const USERS = [
  { id: 1, email: 'dana.ortiz@northwind.example', name: 'Dana Ortiz', role: 'PLANNER' as const },
  { id: 2, email: 'marcus.lee@northwind.example', name: 'Marcus Lee', role: 'SUPPORT' as const },
  { id: 3, email: 'priya.shah@northwind.example', name: 'Priya Shah', role: 'ADMIN' as const },
];

const LOCATIONS = [
  { locationCode: 'NJ', name: 'New Jersey Warehouse', timezone: 'America/New_York' },
  { locationCode: 'CA', name: 'California Warehouse', timezone: 'America/Los_Angeles' },
  { locationCode: 'TX', name: 'Texas Distribution Center', timezone: 'America/Chicago' },
];

const SKUS = [
  { skuCode: 'SKU-HDMI-2M', name: 'HDMI Cable 2m', unitOfMeasure: 'EA', leadTimeDays: 14, safetyStockQty: 20 },
  { skuCode: 'SKU-USBC-1M', name: 'USB-C Cable 1m', unitOfMeasure: 'EA', leadTimeDays: 10, safetyStockQty: 30 },
  { skuCode: 'SKU-PWR-65W', name: '65W USB-C Power Adapter', unitOfMeasure: 'EA', leadTimeDays: 21, safetyStockQty: 15 },
  { skuCode: 'SKU-MON-27', name: '27in 4K Monitor', unitOfMeasure: 'EA', leadTimeDays: 30, safetyStockQty: 5 },
  { skuCode: 'SKU-KB-MECH', name: 'Mechanical Keyboard', unitOfMeasure: 'EA', leadTimeDays: 25, safetyStockQty: 10 },
  { skuCode: 'SKU-MS-WL', name: 'Wireless Mouse', unitOfMeasure: 'EA', leadTimeDays: 12, safetyStockQty: 25 },
  { skuCode: 'SKU-DOCK-TB4', name: 'Thunderbolt 4 Dock', unitOfMeasure: 'EA', leadTimeDays: 28, safetyStockQty: 8 },
  { skuCode: 'SKU-SSD-1TB', name: '1TB NVMe SSD', unitOfMeasure: 'EA', leadTimeDays: 18, safetyStockQty: 12 },
  { skuCode: 'SKU-RAM-16', name: '16GB DDR5 Memory Kit', unitOfMeasure: 'EA', leadTimeDays: 20, safetyStockQty: 10 },
  { skuCode: 'SKU-WC-HD', name: 'HD Webcam', unitOfMeasure: 'EA', leadTimeDays: 15, safetyStockQty: 15 },
  { skuCode: 'SKU-HUB-7P', name: '7-Port USB Hub', unitOfMeasure: 'EA', leadTimeDays: 9, safetyStockQty: 20 },
  { skuCode: 'SKU-SPK-BT', name: 'Bluetooth Speaker', unitOfMeasure: 'EA', leadTimeDays: 16, safetyStockQty: 10 },
];

/** Opening physical counts by SKU code -> { locationCode: qty }. */
const OPENING_STOCK: Record<string, Record<string, number>> = {
  'SKU-HDMI-2M': { NJ: 120, CA: 40, TX: 10 },
  'SKU-USBC-1M': { NJ: 200, CA: 90, TX: 30 },
  'SKU-PWR-65W': { NJ: 10, CA: 25 },
  'SKU-MON-27': { NJ: 14, CA: 22 },
  'SKU-KB-MECH': { NJ: 6 },
  'SKU-MS-WL': { NJ: 80, CA: 30, TX: 20 },
  'SKU-DOCK-TB4': { NJ: 12, CA: 6 },
  'SKU-SSD-1TB': { CA: 10 },
  'SKU-RAM-16': { NJ: 25, CA: 48 },
  'SKU-WC-HD': { NJ: 10, CA: 25 },
  'SKU-HUB-7P': { NJ: 60, CA: 20, TX: 8 },
  'SKU-SPK-BT': { NJ: 18, CA: 9 },
};

const CUSTOMERS = [
  { name: 'Acme Retail', preferred: 'NJ' },
  { name: 'Globex Electronics', preferred: null },
  { name: 'Initech Office', preferred: null },
  { name: 'Umbrella Stores', preferred: 'TX' },
  { name: 'Stark Industries', preferred: null },
  { name: 'Wayne Tech', preferred: 'CA' },
  { name: 'Hooli Devices', preferred: null },
  { name: 'Vandelay Imports', preferred: 'NJ' },
];

type Line = { sku: string; qty: number; pref?: string };
const ORDERS: Array<{ n: string; c: string; p: 'HIGH' | 'MED' | 'LOW'; req: number | null; pref?: string; lines: Line[]; confirm?: boolean }> = [
  { n: 'A101', c: 'Globex Electronics', p: 'MED', req: 4, lines: [{ sku: 'SKU-PWR-65W', qty: 30 }] },
  { n: 'A102', c: 'Acme Retail', p: 'HIGH', req: 3, lines: [{ sku: 'SKU-HDMI-2M', qty: 25 }], pref: 'CA' },
  { n: 'A103', c: 'Initech Office', p: 'LOW', req: 7, lines: [{ sku: 'SKU-USBC-1M', qty: 50, pref: 'CA' }] },
  { n: 'A104', c: 'Stark Industries', p: 'HIGH', req: 5, lines: [{ sku: 'SKU-KB-MECH', qty: 10 }] },
  { n: 'A105', c: 'Hooli Devices', p: 'MED', req: 10, lines: [{ sku: 'SKU-MON-27', qty: 8 }] },
  { n: 'A106', c: 'Umbrella Stores', p: 'LOW', req: 12, lines: [{ sku: 'SKU-HUB-7P', qty: 15, pref: 'TX' }] },
  { n: 'A107', c: 'Wayne Tech', p: 'MED', req: 6, lines: [{ sku: 'SKU-HUB-7P', qty: 6 }] },
  { n: 'A108', c: 'Wayne Tech', p: 'HIGH', req: 12, lines: [{ sku: 'SKU-SSD-1TB', qty: 40 }] },
  { n: 'A109', c: 'Vandelay Imports', p: 'LOW', req: 20, lines: [{ sku: 'SKU-SSD-1TB', qty: 5, pref: 'TX' }] },
  { n: 'A110', c: 'Initech Office', p: 'LOW', req: 9, lines: [{ sku: 'SKU-MON-27', qty: 15 }] },
  { n: 'A111', c: 'Acme Retail', p: 'HIGH', req: 5, lines: [{ sku: 'SKU-MON-27', qty: 12 }] },
  { n: 'A112', c: 'Acme Retail', p: 'HIGH', req: 6, lines: [{ sku: 'SKU-PWR-65W', qty: 20 }] },
  { n: 'A113', c: 'Globex Electronics', p: 'MED', req: 15, lines: [{ sku: 'SKU-DOCK-TB4', qty: 6 }] },
  { n: 'A114', c: 'Stark Industries', p: 'LOW', req: 10, lines: [{ sku: 'SKU-WC-HD', qty: 20 }] },
  { n: 'A115', c: 'Hooli Devices', p: 'MED', req: 5, lines: [{ sku: 'SKU-HUB-7P', qty: 40, pref: 'NJ' }] },
  { n: 'A116', c: 'Hooli Devices', p: 'HIGH', req: 2, lines: [{ sku: 'SKU-SPK-BT', qty: 30 }] },
  { n: 'A117', c: 'Umbrella Stores', p: 'LOW', req: 9, lines: [{ sku: 'SKU-MS-WL', qty: 20, pref: 'TX' }] },
  { n: 'A118', c: 'Initech Office', p: 'MED', req: 8, lines: [{ sku: 'SKU-MS-WL', qty: 50 }] },
  { n: 'A119', c: 'Globex Electronics', p: 'HIGH', req: 7, lines: [{ sku: 'SKU-MON-27', qty: 6, pref: 'NJ' }] },
  { n: 'A120', c: 'Vandelay Imports', p: 'LOW', req: 20, lines: [{ sku: 'SKU-DOCK-TB4', qty: 10 }] },
  { n: 'A121', c: 'Acme Retail', p: 'MED', req: 14, lines: [{ sku: 'SKU-SSD-1TB', qty: 15, pref: 'NJ' }] },
  { n: 'A122', c: 'Wayne Tech', p: 'HIGH', req: 4, lines: [{ sku: 'SKU-RAM-16', qty: 30 }] },
  { n: 'A123', c: 'Hooli Devices', p: 'HIGH', req: 9, lines: [{ sku: 'SKU-SPK-BT', qty: 12 }], confirm: false },
  { n: 'A124', c: 'Umbrella Stores', p: 'MED', req: 11, lines: [{ sku: 'SKU-USBC-1M', qty: 40 }] },
  { n: 'A125', c: 'Globex Electronics', p: 'LOW', req: 2, lines: [{ sku: 'SKU-USBC-1M', qty: 20 }] },
  { n: 'A126', c: 'Vandelay Imports', p: 'LOW', req: 30, lines: [{ sku: 'SKU-DOCK-TB4', qty: 8 }] },
];

async function main() {
  const reset = process.argv.includes('--reset');
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const prisma = new PrismaClient();
  try {
    const existingSkus = await prisma.sku.count();
    if (existingSkus > 0 && !reset) {
      logger.log('Database already contains data; skipping seed. Use --reset to rebuild.');
      return;
    }
    if (reset) {
      logger.warn('Resetting application tables...');
      await truncateAll(prisma);
    }

    const skus = app.get(SkusService);
    const locations = app.get(LocationsService);
    const inventory = app.get(InventoryService);
    const receipts = app.get(ReceiptsService);
    const orders = app.get(OrdersService);
    const allocation = app.get(AllocationService);
    const db = app.get(PrismaService);

    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, companyName: 'Northwind Supply Co.', timezone: 'UTC', defaultSafetyStock: 10 },
      update: {},
    });
    for (const u of USERS) {
      await prisma.user.upsert({ where: { id: u.id }, create: u, update: u });
    }

    const locIds: Record<string, number> = {};
    for (const l of LOCATIONS) {
      const created = await locations.create(l, ACTOR_PLANNER);
      locIds[l.locationCode] = created.id;
    }

    const skuIds: Record<string, number> = {};
    for (const s of SKUS) {
      const created = await skus.create(s, ACTOR_PLANNER);
      skuIds[s.skuCode] = created.id;
    }

    for (const c of CUSTOMERS) {
      const cust = await prisma.customer.upsert({ where: { name: c.name }, create: { name: c.name }, update: {} });
      if (c.preferred) await prisma.customer.update({ where: { id: cust.id }, data: { preferredLocationId: locIds[c.preferred] } });
    }

    // Opening stock through the inventory adjustment workflow (reason is mandatory).
    for (const [sku, perLoc] of Object.entries(OPENING_STOCK)) {
      for (const [loc, qty] of Object.entries(perLoc)) {
        if (qty <= 0) continue;
        await inventory.adjust(
          { skuId: skuIds[sku], locationId: locIds[loc], quantityDelta: qty, reason: 'Opening balance from physical count' },
          ACTOR_PLANNER,
        );
      }
    }

    const today = todayYmd();
    const at = (n: number) => addDaysYmd(today, n);

    // ---- receipts ------------------------------------------------------------------------------
    // PO-18: RECEIVED 3 days ago (creates ledger history)
    const po18 = await receipts.create({ receiptNumber: 'PO-18', skuId: skuIds['SKU-RAM-16'], locationId: locIds.CA, quantity: 30, expectedArrivalTime: at(-3) }, ACTOR_PLANNER);
    await receipts.markInTransit(po18.id, ACTOR_PLANNER);
    await receipts.receive(po18.id, ACTOR_PLANNER, 'Dock count matched PO');

    // PO-22: NJ power adapters, arriving in 3 days (S3)
    await receipts.create({ receiptNumber: 'PO-22', skuId: skuIds['SKU-PWR-65W'], locationId: locIds.NJ, quantity: 40, expectedArrivalTime: at(3) }, ACTOR_PLANNER);

    // PO-24: NJ speakers, originally due tomorrow, now slipped to in 4 days (DELAYED seed)
    const po24 = await receipts.create({ receiptNumber: 'PO-24', skuId: skuIds['SKU-SPK-BT'], locationId: locIds.NJ, quantity: 36, expectedArrivalTime: at(1) }, ACTOR_PLANNER);
    await receipts.markInTransit(po24.id, ACTOR_PLANNER);
    await receipts.update(po24.id, { expectedArrivalTime: at(4), reason: 'Carrier reported a customs hold' }, ACTOR_PLANNER);

    // PO-27: CA SSD in transit, arriving in 10 days (S4)
    const po27 = await receipts.create({ receiptNumber: 'PO-27', skuId: skuIds['SKU-SSD-1TB'], locationId: locIds.CA, quantity: 50, expectedArrivalTime: at(10), status: 'IN_TRANSIT' }, ACTOR_PLANNER);

    // PO-30: TX hubs, CANCELED before anything depended on it (history)
    const po30 = await receipts.create({ receiptNumber: 'PO-30', skuId: skuIds['SKU-HUB-7P'], locationId: locIds.TX, quantity: 25, expectedArrivalTime: at(6) }, ACTOR_PLANNER);
    await receipts.cancel(po30.id, { reason: 'Supplier withdrew the lot before shipping' }, ACTOR_PLANNER);

    // PO-33: CA HDMI cables, planned for 2 days
    await receipts.create({ receiptNumber: 'PO-33', skuId: skuIds['SKU-HDMI-2M'], locationId: locIds.CA, quantity: 60, expectedArrivalTime: at(2) }, ACTOR_PLANNER);

    // ---- orders -------------------------------------------------------------------------------
    for (const o of ORDERS) {
      const confirm = o.confirm !== false;
      await orders.create(
        {
          orderNumber: o.n,
          customerName: o.c,
          priority: o.p,
          requestedShipDate: o.req === null ? null : at(o.req),
          preferredLocationId: o.pref ? locIds[o.pref] : null,
          confirm,
          lines: o.lines.map((l) => ({
            skuId: skuIds[l.sku],
            quantity: l.qty,
            preferredLocationId: l.pref ? locIds[l.pref] : null,
          })),
        },
        ACTOR_PLANNER,
      );
    }

    // A124: confirmed then canceled (released supply) -> history for scenario 5
    await orders.cancel((await prisma.order.findUniqueOrThrow({ where: { orderNumber: 'A124' } })).id, { reason: 'Customer withdrew the request' }, ACTOR_PLANNER);

    // A102: partially shipped (split shipment) -> FULFILLING
    const a102 = await prisma.order.findUniqueOrThrow({ where: { orderNumber: 'A102' }, include: { lines: true } });
    await orders.ship(a102.id, { lines: [{ orderLineId: a102.lines[0].id, quantity: 10 }], reason: 'First tranche ready at CA' }, ACTOR_PLANNER);

    // A125: fully shipped -> SHIPPED
    const a125 = await prisma.order.findUniqueOrThrow({ where: { orderNumber: 'A125' }, include: { lines: true } });
    await orders.ship(a125.id, { lines: [{ orderLineId: a125.lines[0].id, quantity: 20 }] }, ACTOR_PLANNER);

    // ---- history: spread creation/confirmation timestamps over the last 14 days -------------------
    const spread = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const all = await prisma.order.findMany({ orderBy: { id: 'asc' } });
    for (let i = 0; i < all.length; i++) {
      const days = spread[i % spread.length];
      const hour = String(8 + (i % 8)).padStart(2, '0');
      const ts = new Date(`${addDaysYmd(today, -days)}T${hour}:15:00.000Z`);
      if (ts > new Date()) continue;
      await prisma.order.update({ where: { id: all[i].id }, data: { createdAt: ts, ...(all[i].confirmedAt ? { confirmedAt: ts } : {}) } });
    }
    await prisma.order.update({
      where: { orderNumber: 'A125' },
      data: { shippedAt: new Date(`${addDaysYmd(today, -2)}T15:00:00.000Z`) },
    });
    await prisma.shipmentLine.updateMany({ data: { createdAt: new Date(`${addDaysYmd(today, -2)}T15:00:00.000Z`) } });
    await prisma.shipment.updateMany({ data: { shippedAt: new Date(`${addDaysYmd(today, -2)}T15:00:00.000Z`) } });

    // Final consistency pass over every SKU (deterministic; repeat runs produce the same state).
    const allSkus = await prisma.sku.findMany({ select: { id: true } });
    await db.transact((tx) => allocation.recalculate(tx, allSkus.map((s) => s.id), { actorId: ACTOR_PLANNER, reason: 'Seed finalization' }));

    logger.log(
      `Seeded ${LOCATIONS.length} locations, ${SKUS.length} SKUs, ${ORDERS.length} orders, 6 receipts, ${USERS.length} users.`,
    );
  } finally {
    await prisma.$disconnect();
    await app.close();
  }
}

async function truncateAll(prisma: PrismaClient) {
  const tables = [
    'AIInteraction',
    'CustomerCommunication',
    'ShipmentLine',
    'Shipment',
    'Exception',
    'Allocation',
    'InventoryAdjustment',
    'InboundReceipt',
    'OrderLine',
    'Order',
    'Customer',
    'InventoryBalance',
    'Sku',
    'Location',
    'AuditLog',
    'AppSetting',
    'Sequence',
    'User',
  ];
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  }
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
