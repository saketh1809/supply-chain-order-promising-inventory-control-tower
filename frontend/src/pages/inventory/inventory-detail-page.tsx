import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { Area, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Line, ComposedChart } from 'recharts';
import { SlidersHorizontal } from 'lucide-react';
import { errorMessage, useGetInventoryItemQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { StockBadge, ReceiptBadge } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { DataTable } from '../../components/ui/data-table';
import { ErrorState, Skeleton, EmptyState } from '../../components/ui/states';
import { AdjustmentDialog } from '../../components/inventory/adjustment-dialog';
import { fmtDate, fmtDateTime, fmtNum, fmtShortDate, humanize } from '../../lib/utils';
import type { ColumnDef } from '@tanstack/react-table';

export function InventoryDetailPage() {
  const { id } = useParams();
  const balanceId = Number(id);
  const q = useGetInventoryItemQuery(balanceId, { skip: !Number.isFinite(balanceId) });
  const [adjustOpen, setAdjustOpen] = useState(false);

  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.error) return <ErrorState message={errorMessage(q.error, 'This inventory record could not be loaded.')} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <>
      <PageHeader
        title={`${d.sku.skuCode} @ ${d.location.locationCode}`}
        description={`${d.sku.name} · ${d.location.name}`}
        crumbs={[{ label: 'Inventory', to: '/inventory' }, { label: `${d.sku.skuCode} @ ${d.location.locationCode}` }]}
        actions={
          <>
            <Link to={`/products/${d.sku.id}`}><Button variant="secondary">View SKU</Button></Link>
            <Button onClick={() => setAdjustOpen(true)}><SlidersHorizontal className="h-4 w-4" /> Adjust</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="On hand" value={d.onHand} />
        <Stat label="Allocated" value={d.allocated} />
        <Stat label="Available" value={d.available} tone={d.available < 0 ? 'danger' : undefined} />
        <Stat label="Incoming" value={d.incoming} />
        <Stat label="ATP" value={d.atp} tone={d.atp < 0 ? 'danger' : undefined} />
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</p>
          <div className="mt-2"><StockBadge value={d.status} /></div>
          <p className="mt-2 text-[11px] text-muted-foreground">Safety stock {fmtNum(d.sku.safetyStockQty)}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="ATP projection · next 30 days" description="On-hand plus eligible inbound, minus committed demand by ship date. Dips below zero mark a projected shortage." />
          <CardBody>
            <div className="h-72" role="img" aria-label="Projected available-to-promise over the next 30 days">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.atpProjection.map((p: any) => ({ ...p, label: fmtShortDate(p.date) }))} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--danger))" strokeDasharray="4 4" />
                  <Area type="stepAfter" dataKey="atp" name="ATP" stroke="hsl(217 85% 55%)" fill="hsl(217 85% 55%)" fillOpacity={0.12} strokeWidth={2} />
                  <Line type="stepAfter" dataKey="supply" name="Cumulative inbound" stroke="hsl(158 64% 40%)" strokeWidth={1.5} dot={false} />
                  <Line type="stepAfter" dataKey="demand" name="Cumulative demand" stroke="hsl(355 72% 55%)" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Incoming receipts" description="Eligible for ATP until received or canceled" />
          <CardBody className="space-y-2">
            {d.incomingReceipts.length === 0 && <p className="text-sm text-muted-foreground">Nothing inbound for this location.</p>}
            {d.incomingReceipts.map((r: any) => (
              <Link key={r.id} to={`/supply/receipts/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-accent">
                <span className="font-medium">{r.receiptNumber}</span>
                <span className="flex items-center gap-2"><ReceiptBadge value={r.status} /><span className="tabular text-xs">{fmtDate(r.expectedArrivalTime.slice(0, 10))} · {fmtNum(r.quantity)}</span></span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Allocations from this location" description="Which order lines are holding this stock" />
          {d.allocations.length === 0 ? <EmptyState title="Nothing allocated" description="No active order line is reserving stock here." /> : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Source</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2">Available</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.allocations.map((a: any) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 font-medium">{a.orderNumber}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.customer}</td>
                    <td className="px-4 py-2"><span className="text-xs">{a.source === 'ON_HAND' ? 'On hand' : a.receiptNumber}</span></td>
                    <td className="tabular px-4 py-2 text-right">{fmtNum(a.quantity)}</td>
                    <td className="tabular px-4 py-2 text-xs">{fmtDate(a.availableDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="Movement history" description="Append-only ledger: every change to on-hand, with who made it and why" />
          <DataTable<any>
            caption="Inventory movements"
            rowKey={(m) => m.id}
            columns={[
              { accessorKey: 'createdAt', header: 'When', cell: ({ getValue }) => <span className="tabular text-xs text-muted-foreground">{fmtDateTime(getValue<string>())}</span> },
              { accessorKey: 'movementType', header: 'Type', cell: ({ getValue }) => <span className="text-xs">{humanize(getValue<string>())}</span> },
              { accessorKey: 'quantityDelta', header: 'Change', cell: ({ getValue }) => { const v = getValue<number>(); return <span className={`tabular font-medium ${v < 0 ? 'text-danger' : 'text-success'}`}>{v > 0 ? '+' : ''}{fmtNum(v)}</span>; } },
              { accessorKey: 'newOnHand', header: 'On hand', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
              { accessorKey: 'reason', header: 'Reason', cell: ({ row }) => <span className="block max-w-[260px] truncate text-xs" title={row.original.reason}>{row.original.reason}</span> },
              { accessorKey: 'user', header: 'By', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string | null>() ?? 'system'}</span> },
            ] as Array<ColumnDef<any, any>>}
            data={d.movements}
            empty={{ title: 'No movements yet' }}
          />
        </Card>
      </div>

      <AdjustmentDialog open={adjustOpen} onClose={() => setAdjustOpen(false)} defaults={{ skuId: d.sku.id, locationId: d.location.id }} />
      <p className="mt-6 text-xs text-muted-foreground">Last updated {fmtDateTime(d.lastUpdated)}.</p>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{fmtNum(value)}</p>
    </div>
  );
}
