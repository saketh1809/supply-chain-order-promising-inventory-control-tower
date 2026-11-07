import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowRight, Boxes, Pencil, Truck } from 'lucide-react';
import { errorMessage, useAtpQuery, useGetSkuQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { OrderStatusBadge, PriorityBadge, ReceiptBadge, StockBadge } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { SkuFormDialog } from '../../components/master/master-forms';
import { AdjustmentDialog } from '../../components/inventory/adjustment-dialog';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtDateTime, fmtNum, fmtShortDate, humanize } from '../../lib/utils';

export function SkuDetailPage() {
  const { id } = useParams();
  const skuId = Number(id);
  const q = useGetSkuQuery(skuId, { skip: !Number.isFinite(skuId) });
  const atp = useAtpQuery({ skuId }, { skip: !Number.isFinite(skuId) });
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <ErrorState message={errorMessage(q.error, 'SKU not found.')} onRetry={() => q.refetch()} />;
  const d = q.data;
  const t = d.totals;
  const status = t.atp < 0 ? 'SHORTAGE' : t.onHand === 0 && t.inbound > 0 ? 'INCOMING_ONLY' : t.onHand === 0 ? 'OUT_OF_STOCK' : t.atp <= d.sku.safetyStockQty ? 'LOW_STOCK' : 'HEALTHY';

  return (
    <>
      <PageHeader
        title={d.sku.skuCode}
        description={`${d.sku.name} · UoM ${d.sku.unitOfMeasure ?? '—'} · lead time ${d.sku.leadTimeDays ?? 'not set'}${d.sku.leadTimeDays !== null ? ' days' : ''} · safety stock ${fmtNum(d.sku.safetyStockQty)}`}
        crumbs={[{ label: 'Products', to: '/products' }, { label: d.sku.skuCode }]}
        actions={<><Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Edit</Button><Button onClick={() => setAdjust(true)}><Boxes className="h-4 w-4" /> Adjust stock</Button></>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[['On hand', t.onHand], ['Allocated', t.allocated], ['Available to promise', t.atp], ['Incoming', t.inbound]].map(([l, v]) => (
          <div key={String(l)} className="rounded-2xl border border-border bg-card p-4 shadow-card"><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{l}</p><p className={`tabular mt-1 text-xl font-semibold ${l === 'Available to promise' && (v as number) < 0 ? 'text-danger' : ''}`}>{fmtNum(v as number)}</p></div>
        ))}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card"><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Health</p><div className="mt-2"><StockBadge value={status} /></div></div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="ATP over 30 days" description="Time-phased available-to-promise across all warehouses" />
          <CardBody>
            {atp.isLoading ? <Skeleton className="h-56 w-full" /> : (
              <div className="h-56" role="img" aria-label="ATP projection for this SKU">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={atp.data?.timeline.map((p) => ({ ...p, label: fmtShortDate(p.date) })) ?? []} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={4} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Area type="stepAfter" dataKey="atp" name="ATP" stroke="hsl(217 85% 55%)" fill="hsl(217 85% 55%)" fillOpacity={0.12} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Inventory across locations" description="Per warehouse" />
          <CardBody className="space-y-2">
            {d.byLocation.length === 0 && <p className="text-sm text-muted-foreground">No stock records yet.</p>}
            {d.byLocation.map((l: any) => (
              <Link key={l.balanceId} to={`/inventory/${l.balanceId}`} className="block rounded-lg border border-border p-3 text-sm hover:bg-accent">
                <div className="flex items-center justify-between"><span className="font-semibold">{l.location.locationCode}</span><span className={`tabular text-xs ${l.atp < 0 ? 'text-danger' : 'text-muted-foreground'}`}>ATP {fmtNum(l.atp)}</span></div>
                <div className="tabular mt-1 flex gap-3 text-xs text-muted-foreground"><span>On hand {fmtNum(l.onHand)}</span><span>Allocated {fmtNum(l.allocated)}</span><span>Incoming {fmtNum(l.incoming)}</span></div>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Incoming receipts" description="Supply for this SKU" actions={<Link to="/supply?tab=receipts" className="text-xs text-info hover:underline">All receipts</Link>} />
          <CardBody className="space-y-2">
            {d.receipts.length === 0 && <EmptyState icon={Truck} title="No receipts" description="Create a receipt to add inbound supply." />}
            {d.receipts.map((r: any) => (
              <Link key={r.id} to={`/supply/receipts/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-accent"><span className="font-medium">{r.receiptNumber} <span className="text-xs font-normal text-muted-foreground">→ {r.location}</span></span><span className="flex items-center gap-2"><ReceiptBadge value={r.status} /><span className="tabular text-xs">{fmtDate(r.expectedArrivalTime.slice(0, 10))} · {fmtNum(r.quantity)}</span></span></Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Related customer orders" description="Lines for this SKU and their allocation state" />
          <CardBody className="p-0">
            {d.orders.length === 0 ? <div className="p-5"><EmptyState title="No orders" description="No order has requested this SKU yet." /></div> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2 text-right">Requested</th><th className="px-4 py-2 text-right">Backorder</th><th className="px-4 py-2">Promised</th></tr></thead>
                <tbody className="divide-y divide-border">{d.orders.map((o: any) => (<tr key={o.lineId} className="hover:bg-accent/50"><td className="px-4 py-2"><Link to={`/orders/${o.orderId}`} className="font-medium hover:text-info hover:underline">{o.orderNumber}</Link><span className="block text-xs text-muted-foreground">{o.customer}</span></td><td className="px-4 py-2"><OrderStatusBadge value={o.orderStatus} /></td><td className="px-4 py-2"><PriorityBadge value={o.priority} /></td><td className="tabular px-4 py-2 text-right">{fmtNum(o.requestedQty)}</td><td className={`tabular px-4 py-2 text-right ${o.backorderedQty ? 'font-semibold text-danger' : ''}`}>{fmtNum(o.backorderedQty)}</td><td className="tabular px-4 py-2 text-xs">{fmtDate(o.promisedShipDate)}</td></tr>))}</tbody></table></div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Historical inventory movements" description="Append-only ledger for this SKU" />
        <CardBody className="p-0">
          {d.movements.length === 0 ? <div className="p-5"><EmptyState title="No movements" description="Stock changes appear here with their reasons." /></div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Reference</th><th className="px-4 py-2">Location</th><th className="px-4 py-2">Type</th><th className="px-4 py-2 text-right">Change</th><th className="px-4 py-2 text-right">New on hand</th><th className="px-4 py-2">Reason</th></tr></thead>
              <tbody className="divide-y divide-border">{d.movements.map((m: any) => (<tr key={m.id}><td className="tabular px-4 py-2 text-xs text-muted-foreground">{fmtDateTime(m.createdAt)}</td><td className="px-4 py-2 font-mono text-xs">{m.adjustmentNumber}</td><td className="px-4 py-2">{m.location}</td><td className="px-4 py-2 text-xs">{humanize(m.movementType)}</td><td className={`tabular px-4 py-2 text-right font-medium ${m.quantityDelta < 0 ? 'text-danger' : 'text-success'}`}>{m.quantityDelta > 0 ? '+' : ''}{fmtNum(m.quantityDelta)}</td><td className="tabular px-4 py-2 text-right">{fmtNum(m.newOnHand)}</td><td className="max-w-[260px] truncate px-4 py-2 text-xs" title={m.reason}>{m.reason}</td></tr>))}</tbody></table></div>
          )}
        </CardBody>
      </Card>

      <SkuFormDialog open={edit} onClose={() => setEdit(false)} sku={d.sku} />
      <AdjustmentDialog open={adjust} onClose={() => setAdjust(false)} defaults={{ skuId: d.sku.id }} />
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><ArrowRight className="h-3 w-3" /> ATP is recalculated on every change.</p>
    </>
  );
}
