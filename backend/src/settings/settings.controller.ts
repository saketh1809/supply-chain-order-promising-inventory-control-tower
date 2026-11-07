import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiError } from '../common/api/api-error';
import { Actor } from '../common/actor/actor.guard';
import { AuditService } from '../audit/audit.service';

class UpdateSettingsDto {
  @IsOptional() @IsString() @Length(2, 255) companyName?: string;
  @IsOptional() @IsString() @Length(2, 64) timezone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) defaultSafetyStock?: number;
}

@ApiTags('Settings')
@Controller()
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings')
  async get() {
    return this.ensure();
  }

  @Patch('settings')
  async update(@Body() dto: UpdateSettingsDto, @Actor() actor: number) {
    const before = await this.ensure();
    const after = await this.prisma.transact(async (tx) => {
      const row = await tx.appSetting.upsert({
        where: { id: 1 },
        create: { id: 1, companyName: dto.companyName ?? 'Northwind Supply Co.', timezone: dto.timezone ?? 'UTC', defaultSafetyStock: dto.defaultSafetyStock ?? 10 },
        update: { companyName: dto.companyName, timezone: dto.timezone, defaultSafetyStock: dto.defaultSafetyStock },
      });
      await this.audit.record(tx, { userId: actor, entityType: 'Settings', entityId: 1, action: 'SETTINGS_UPDATED', previousValue: before, newValue: row, reason: 'Workspace settings updated' });
      return row;
    });
    return after;
  }

  @Get('users')
  users() {
    return this.prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, email: true, role: true } });
  }

  /** Global search across SKUs, orders, receipts and locations. */
  @Get('search')
  async search(@Query('q') q?: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return { query: term, skus: [], orders: [], receipts: [], locations: [] };
    if (term.length > 100) throw ApiError.badRequest('QUERY_TOO_LONG', 'Search text is too long');
    const [skus, orders, receipts, locations] = await Promise.all([
      this.prisma.sku.findMany({ where: { OR: [{ skuCode: { contains: term } }, { name: { contains: term } }] }, take: 6, orderBy: { skuCode: 'asc' } }),
      this.prisma.order.findMany({ where: { OR: [{ orderNumber: { contains: term } }, { customer: { name: { contains: term } } }] }, take: 6, orderBy: { createdAt: 'desc' }, include: { customer: true } }),
      this.prisma.inboundReceipt.findMany({ where: { receiptNumber: { contains: term } }, take: 6, orderBy: { id: 'desc' } }),
      this.prisma.location.findMany({ where: { OR: [{ locationCode: { contains: term } }, { name: { contains: term } }] }, take: 6, orderBy: { locationCode: 'asc' } }),
    ]);
    return {
      query: term,
      skus: skus.map((s) => ({ id: s.id, label: s.skuCode, sublabel: s.name, href: `/products/${s.id}` })),
      orders: orders.map((o) => ({ id: o.id, label: o.orderNumber, sublabel: o.customer.name, href: `/orders/${o.id}` })),
      receipts: receipts.map((r) => ({ id: r.id, label: r.receiptNumber, sublabel: r.status, href: `/supply/receipts/${r.id}` })),
      locations: locations.map((l) => ({ id: l.id, label: l.locationCode, sublabel: l.name, href: `/locations/${l.id}` })),
    };
  }

  private async ensure() {
    const row = await this.prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, companyName: 'Northwind Supply Co.', timezone: 'UTC', defaultSafetyStock: 10 },
      update: {},
    });
    return { companyName: row.companyName, timezone: row.timezone, defaultSafetyStock: row.defaultSafetyStock, updatedAt: row.updatedAt.toISOString() };
  }
}
