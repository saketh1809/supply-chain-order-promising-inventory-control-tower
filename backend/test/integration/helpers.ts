import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'mysql://sct:sct_password@localhost:3306/sct_test';
process.env.DATABASE_URL = TEST_DB_URL;

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  http: ReturnType<typeof request>;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { swagger: false });
  await app.init();
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  return {
    app,
    prisma,
    http: request(app.getHttpServer()),
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

const TABLES = [
  'AIInteraction', 'CustomerCommunication', 'ShipmentLine', 'Shipment', 'Exception', 'Allocation',
  'InventoryAdjustment', 'InboundReceipt', 'OrderLine', 'Order', 'Customer', 'InventoryBalance',
  'Sku', 'Location', 'AuditLog', 'AppSetting', 'Sequence', 'User',
];

/** Clears every application table (TRUNCATE is not blocked by the append-only triggers) and seeds the acting user. */
let resetClient: PrismaClient | null = null;
/** A single-connection client: SET FOREIGN_KEY_CHECKS is per connection, so truncation must share one. */
function getResetClient(): PrismaClient {
  if (!resetClient) {
    const sep = TEST_DB_URL.includes('?') ? '&' : '?';
    resetClient = new PrismaClient({ datasources: { db: { url: `${TEST_DB_URL}${sep}connection_limit=1` } } });
  }
  return resetClient;
}

export async function resetDatabase(prisma: PrismaClient) {
  const c = getResetClient();
  await c.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TABLES) await c.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  await c.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  await prisma.user.create({ data: { id: 1, email: 'planner@test.local', name: 'Test Planner', role: 'PLANNER' } });
  await prisma.user.create({ data: { id: 2, email: 'support@test.local', name: 'Test Support', role: 'SUPPORT' } });
}

/** Convenience API client for fixture setup and assertions. Every call asserts the expected status. */
export class Api {
  constructor(private readonly http: ReturnType<typeof request>, private readonly userId = 1) {}

  private h() {
    return { 'x-user-id': String(this.userId) };
  }
  async get(url: string, expect = 200) {
    const res = await this.http.get(`/api/v1${url}`).set(this.h());
    expectStatus(res, expect, `GET ${url}`);
    return res.body.data;
  }
  async post(url: string, body: unknown = {}, expect?: number) {
    const status = expect ?? (ACTION_PATH.test(url) ? 200 : 201);
    const res = await this.http.post(`/api/v1${url}`).set(this.h()).send(body as object);
    expectStatus(res, status, `POST ${url}`);
    return res.body.data;
  }
  async patch(url: string, body: unknown, expect = 200) {
    const res = await this.http.patch(`/api/v1${url}`).set(this.h()).send(body as object);
    expectStatus(res, expect, `PATCH ${url}`);
    return res.body.data;
  }
  /** Returns the raw response (for asserting error codes). */
  raw() {
    return this.http;
  }
}

function expectStatus(res: request.Response, expected: number, label: string) {
  if (res.status !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

/** Action endpoints (state transitions, previews, recalculations) answer 200; creations answer 201. */
const ACTION_PATH = /\/(confirm|cancel|ship|receive|in-transit|resolve|approve|reject|recalculate|preview|expedite-receipt|reassign-location|override-promise|split-shipment)(\?.*)?$/;

export const todayPlus = (days: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
