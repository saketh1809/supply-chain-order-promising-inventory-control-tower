import { Api, todayPlus } from './helpers';

/** Builds a small, explicit scenario through the public API. */
export class Fixtures {
  skus: Record<string, number> = {};
  locs: Record<string, number> = {};
  counter = 0;

  constructor(private readonly api: Api) {}

  async location(code: string) {
    const l = await this.api.post('/locations', { locationCode: code, name: `${code} site` });
    this.locs[code] = l.id;
    return l.id as number;
  }

  async sku(code: string, opts: { leadTimeDays?: number | null; safetyStockQty?: number } = {}) {
    const s = await this.api.post('/skus', {
      skuCode: code,
      name: `${code} product`,
      leadTimeDays: opts.leadTimeDays === undefined ? 10 : opts.leadTimeDays,
      safetyStockQty: opts.safetyStockQty ?? 0,
    });
    this.skus[code] = s.id;
    return s.id as number;
  }

  async stock(sku: string, loc: string, qty: number) {
    return this.api.post('/inventory/adjustments', {
      skuId: this.skus[sku],
      locationId: this.locs[loc],
      quantityDelta: qty,
      reason: 'Opening stock for test scenario',
    });
  }

  async receipt(number: string, sku: string, loc: string, qty: number, arrivalDays: number, status?: 'PLANNED' | 'IN_TRANSIT') {
    return this.api.post('/receipts', {
      receiptNumber: number,
      skuId: this.skus[sku],
      locationId: this.locs[loc],
      quantity: qty,
      expectedArrivalTime: todayPlus(arrivalDays),
      ...(status ? { status } : {}),
    });
  }

  async order(number: string, sku: string, qty: number, opts: { priority?: 'HIGH' | 'MED' | 'LOW'; confirm?: boolean; requestedDays?: number; preferred?: string; customer?: string } = {}) {
    this.counter += 1;
    return this.api.post('/orders', {
      orderNumber: number,
      customerName: opts.customer ?? 'Test Customer',
      priority: opts.priority ?? 'MED',
      requestedShipDate: opts.requestedDays === undefined ? null : todayPlus(opts.requestedDays),
      preferredLocationId: opts.preferred ? this.locs[opts.preferred] : null,
      confirm: opts.confirm ?? true,
      lines: [{ skuId: this.skus[sku], quantity: qty }],
    });
  }
}
