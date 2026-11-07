import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { CalendarClock, CheckCheck, Gauge, Truck, XCircle, PackageCheck, PencilLine } from 'lucide-react';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useGetReceiptQuery, useMarkReceiptInTransitMutation, useReceiveReceiptMutation } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { ReceiptBadge, PriorityBadge } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { ErrorState, Skeleton, EmptyState } from '../../components/ui/states';
import { ExpediteDialog } from '../../components/planner/planner-dialogs';
import { ChangeArrivalDialog, CancelReceiptDialog } from '../../components/supply/receipt-dialogs';
import { pushToast } from '../../features/ui/uiSlice';
import { fmtDate, fmtDateTime, fmtNum, humanize } from '../../lib/utils';

export function ReceiptDetailPage() {
  const { id } = useParams();
  const receiptId = Number(id);
  const dispatch = useAppDispatch();
  const q = useGetReceiptQuery(receiptId, { skip: !Number.isFinite(receiptId) });
  const [inTransit] = useMarkReceiptInTransitMutation();
  const [receive, rState] = useReceiveReceiptMutation();
  const [dlg, setDlg] = useState<null | 'arrival' | 'expedite' | 'cancel'>(null);

  if (q.isLoading) return <Skeleton className="h-80 w-full" />;
  if (q.error) return <ErrorState message={errorMessage(q.error, 'Receipt not found.')} onRetry={() => q.refetch()} />;
  const r = q.data;
  const open = r.status === 'PLANNED' || r.status === 'IN_TRANSIT';

  const onReceive = async () => {
    try {
      const res = await receive({ id: r.id }).unwrap();
      if (res.idempotent) dispatch(pushToast({ tone: 'info', title: 'Already received', description: 'This receipt was booked earlier. Inventory was not increased again.' }));
      else dispatch(pushToast({ tone: 'success', title: `${r.receiptNumber} received`, description: `On hand ${fmtNum(res.inventory.previousOnHand)} → ${fmtNum(res.inventory.newOnHand)}. Future supply removed from ATP.` }));
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Could not receive', description: errorMessage(e) }));
    }
  };

  return (
    <>
      <PageHeader
        title={r.receiptNumber}
        crumbs={[{ label: 'Supply & receipts', to: '/supply?tab=receipts' }, { label: r.receiptNumber }]}
        description={<span className="inline-flex flex-wrap items-center gap-2"><span>{r.sku.skuCode} · {r.sku.name}</span><span>→</span><span>{r.location.locationCode} ({r.location.name})</span></span>}
        actions={
          open ? (
            <>
              {r.status === 'PLANNED' && <Button variant="secondary" onClick={async () => { try { await inTransit(r.id).unwrap(); dispatch(pushToast({ tone: 'info', title: 'Marked in transit' })); } catch (e) { dispatch(pushToast({ tone: 'error', title: 'Not updated', description: errorMessage(e) })); } }}><Truck className="h-4 w-4" /> Mark in transit</Button>}
              <Button variant="secondary" onClick={() => setDlg('arrival')}><CalendarClock className="h-4 w-4" /> Change arrival</Button>
              <Button variant="secondary" onClick={() => setDlg('expedite')}><Gauge className="h-4 w-4" /> Expedite</Button>
              <Button variant="success" onClick={onReceive} loading={rState.isLoading}><PackageCheck className="h-4 w-4" /> Receive</Button>
              <Button variant="danger" onClick={() => setDlg('cancel')}><XCircle className="h-4 w-4" /> Cancel</Button>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Fact label="Status"><ReceiptBadge value={r.status} /></Fact>
        <Fact label="Quantity"><span className="tabular text-lg font-semibold">{fmtNum(r.quantity)}</span></Fact>
        <Fact label="Expected arrival"><span className="tabular font-semibold">{fmtDate(r.expectedArrivalTime.slice(0, 10))}</span>{r.delayDays > 0 && <span className="block text-[11px] text-warning">Delayed +{r.delayDays} day(s) from {fmtDate(r.originalExpectedArrivalTime.slice(0, 10))}</span>}</Fact>
        <Fact label="Destination"><span className="font-semibold">{r.location.locationCode}</span></Fact>
        <Fact label={r.status === 'RECEIVED' ? 'Received' : r.status === 'CANCELED' ? 'Canceled' : 'In ATP'}>
          <span className="text-sm">{r.status === 'RECEIVED' ? fmtDateTime(r.receivedAt) : r.status === 'CANCELED' ? fmtDateTime(r.canceledAt) : open ? 'Until received or canceled' : '—'}</span>
        </Fact>
      </div>

      {r.status === 'CANCELED' && <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">Canceled: {r.cancelReason}</div>}
      {r.status === 'RECEIVED' && <div className="mt-4 flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-success"><CheckCheck className="h-4 w-4" /> Received into on-hand inventory. Receiving is booked exactly once; repeated requests change nothing.</div>}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Dependent order allocations" description="Order lines relying on this receipt right now" />
          <CardBody className="p-0">
            {r.dependentAllocations.length === 0 ? (
              <EmptyState title={open ? 'No order depends on this receipt' : 'No active dependency'} description={open ? 'Units are either free in ATP or allocated to other supply.' : 'Dependencies are released once a receipt is received or canceled.'} />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Order</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2 text-right">Units</th><th className="px-4 py-2">Available</th><th className="px-4 py-2">Promised</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {r.dependentAllocations.map((a: any) => (
                    <tr key={a.allocationId}>
                      <td className="px-4 py-2"><Link to={`/orders/${a.orderId}`} className="font-medium hover:text-info hover:underline">{a.orderNumber}</Link></td>
                      <td className="px-4 py-2 text-muted-foreground">{a.customer}</td>
                      <td className="px-4 py-2"><PriorityBadge value={a.priority} /></td>
                      <td className="tabular px-4 py-2 text-right">{fmtNum(a.quantity)}</td>
                      <td className="tabular px-4 py-2 text-xs">{fmtDate(a.availableDate)}</td>
                      <td className="tabular px-4 py-2 text-xs">{fmtDate(a.promisedShipDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Inventory effect" description="Ledger rows created by this receipt" />
          <CardBody className="space-y-2">
            {r.ledger.length === 0 && <p className="text-sm text-muted-foreground">No inventory has been booked for this receipt yet.</p>}
            {r.ledger.map((l: any) => (
              <div key={l.adjustmentNumber} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
                <span className="font-mono text-xs">{l.adjustmentNumber}</span>
                <span className="tabular text-success">+{fmtNum(l.quantityDelta)} → {fmtNum(l.newOnHand)}</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">Idempotency: the ledger key is unique per receipt, so this effect can only exist once.</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Audit history" description="Every creation, edit, delay, status change and recalculation for this receipt" />
        <CardBody>
          {r.history.length === 0 ? <p className="text-sm text-muted-foreground">No audit entries.</p> : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {r.history.map((h: any) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-info ring-4 ring-card" aria-hidden />
                  <p className="flex items-center gap-2 text-sm font-medium"><PencilLine className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{humanize(h.action)}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(h.timestamp)} · {h.user?.name ?? 'system'}{h.reason ? ` · “${h.reason}”` : ''}</p>
                  {h.previousValue && h.newValue && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{summarizeChange(h.previousValue, h.newValue)}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {open && <ExpediteDialog open={dlg === 'expedite'} onClose={() => setDlg(null)} receipt={{ id: r.id, receiptNumber: r.receiptNumber, expectedArrivalTime: r.expectedArrivalTime }} />}
      {open && dlg === 'arrival' && <ChangeArrivalDialog open onClose={() => setDlg(null)} receipt={{ id: r.id, receiptNumber: r.receiptNumber, expectedArrivalTime: r.expectedArrivalTime, version: r.version }} />}
      {open && dlg === 'cancel' && <CancelReceiptDialog open onClose={() => setDlg(null)} receipt={{ id: r.id, receiptNumber: r.receiptNumber }} />}
    </>
  );
}

function summarizeChange(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const keys = Object.keys({ ...prev, ...next }).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k])).slice(0, 4);
  return keys.map((k) => `${k}: ${String(prev[k] ?? '—')} → ${String(next[k] ?? '—')}`).join(' · ') || 'no field changes';
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
