import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { errorMessage, useGetLocationQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { StockBadge, PriorityBadge, ReceiptBadge, AllocationBadge } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { LocationFormDialog } from '../../components/master/master-forms';
import { fmtDate, fmtNum } from '../../lib/utils';

export function LocationDetailPage() {
  const { id } = useParams();
  const locId = Number(id);
  const q = useGetLocationQuery(locId, { skip: !Number.isFinite(locId) });
  const [edit, setEdit] = useState(false);
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <ErrorState message={errorMessage(q.error, 'Location not found.')} onRetry={() => q.refetch()} />;
  const d = q.data;
  const s = d.summary;
  return (
    <>
      <PageHeader title={`${d.location.locationCode} · ${d.location.name}`} crumbs={[{ label: 'Locations', to: '/locations' }, { label: d.location.locationCode }]} description={`Timezone ${d.location.timezone ?? 'not set'} · ${d.location.isActive ? 'active' : 'inactive'}`} actions={<Button variant="secondary" onClick={() => setEdit(true)}>Edit location</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[['SKUs stocked', s.skuCount], ['On hand', s.onHandTotal], ['Available', s.availableTotal], ['Incoming', s.incomingTotal], ['Low-stock SKUs', s.lowStockSkuCount], ['Active orders', s.activeOrderCount]].map(([l, v]) => (
          <div key={String(l)} className="rounded-2xl border border-border bg-card p-4 shadow-card"><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{l}</p><p className={`tabular mt-1 text-xl font-semibold ${l === 'Low-stock SKUs' && (v as number) > 0 ? 'text-warning' : ''}`}>{fmtNum(v as number)}</p></div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Inventory by SKU" description="On hand, available and ATP at this warehouse" />
          {d.inventory.length === 0 ? <EmptyState title="No stock here" description="Adjust inventory or receive a receipt to add stock." /> : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">SKU</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2 text-right">Available</th><th className="px-4 py-2 text-right">ATP</th><th className="px-4 py-2">Health</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.inventory.map((r: any) => (
                  <tr key={r.sku.id} className="hover:bg-accent/50"><td className="px-4 py-2"><Link className="font-medium hover:text-info hover:underline" to={`/products/${r.sku.id}`}>{r.sku.skuCode}</Link></td><td className="tabular px-4 py-2 text-right">{fmtNum(r.onHand)}</td><td className="tabular px-4 py-2 text-right">{fmtNum(r.available)}</td><td className={`tabular px-4 py-2 text-right font-semibold ${r.atp < 0 ? 'text-danger' : ''}`}>{fmtNum(r.atp)}</td><td className="px-4 py-2">{r.atp <= r.sku.safetyStockQty ? <StockBadge value={r.atp < 0 ? 'SHORTAGE' : 'LOW_STOCK'} /> : <StockBadge value="HEALTHY" />}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <CardHeader title="Incoming receipts" description="Planned and in-transit arrivals" />
          <CardBody className="space-y-2">
            {d.incomingReceipts.length === 0 && <p className="text-sm text-muted-foreground">Nothing inbound.</p>}
            {d.incomingReceipts.map((r: any) => (
              <Link key={r.id} to={`/supply/receipts/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-accent"><span><span className="font-medium">{r.receiptNumber}</span> <span className="text-xs text-muted-foreground">· {r.sku}</span></span><span className="flex items-center gap-2"><ReceiptBadge value={r.status} /><span className="tabular text-xs">{fmtDate(r.expectedArrivalTime.slice(0, 10))} · {fmtNum(r.quantity)}</span></span></Link>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Active orders assigned" description="Orders that preferred this warehouse or are being fulfilled from it" />
        {d.activeOrders.length === 0 ? <CardBody><EmptyState title="No active orders" description="No confirmed order is using this location." /></CardBody> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">SKU</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2">Assignment</th><th className="px-4 py-2 text-right">Open</th><th className="px-4 py-2 text-right">Backorder</th><th className="px-4 py-2">Promised</th><th className="px-4 py-2">Allocation</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.activeOrders.map((o: any) => (
                  <tr key={o.lineId} className="hover:bg-accent/50"><td className="px-4 py-2"><Link to={`/orders/${o.orderId}`} className="font-medium hover:text-info hover:underline">{o.orderNumber}</Link></td><td className="px-4 py-2">{o.sku}</td><td className="px-4 py-2"><PriorityBadge value={o.priority} /></td><td className="px-4 py-2 text-xs">{o.assignment === 'FULFILLING' ? 'Fulfilling' : 'Preferred'}</td><td className="tabular px-4 py-2 text-right">{fmtNum(o.openQty)}</td><td className={`tabular px-4 py-2 text-right ${o.backorderedQty ? 'font-semibold text-danger' : ''}`}>{fmtNum(o.backorderedQty)}</td><td className="tabular px-4 py-2">{fmtDate(o.promisedShipDate)}</td><td className="px-4 py-2"><AllocationBadge value={o.allocatedQty > 0 && o.backorderedQty === 0 ? 'FULLY_ALLOCATED' : o.allocatedQty > 0 ? 'PARTIALLY_ALLOCATED' : 'BACKORDERED'} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <LocationFormDialog open={edit} onClose={() => setEdit(false)} location={d.location} />
    </>
  );
}
