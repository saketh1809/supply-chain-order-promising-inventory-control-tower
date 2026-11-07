import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, Edit3, Lock, MessageSquare, PackageCheck, Pencil, Route, Scissors, Ban, Clock, Gauge, CalendarClock, AlertTriangle } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useConfirmOrderMutation, useGetOrderCommunicationsQuery, useGetOrderQuery, useGetOrderTimelineQuery, useListLocationsQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { AllocationBadge, OrderStatusBadge, PriorityBadge, RiskBadge, SeverityBadge, ReceiptBadge, ExceptionTypeLabel } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { DataTable } from '../../components/ui/data-table';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { Select } from '../../components/ui/input';
import { Tabs } from '../../components/ui/tabs';
import { OrderTimeline } from '../../components/orders/timeline';
import { EditOrderDialog, CancelOrderDialog, ShipDialog, CustomerUpdateDialog } from '../../components/orders/order-dialogs';
import { ExpediteDialog, OverrideDialog, ReassignDialog, SplitShipmentDialog } from '../../components/planner/planner-dialogs';
import { pushToast } from '../../features/ui/uiSlice';
import { fmtDate, fmtDateTime, fmtNum, humanize } from '../../lib/utils';
import type { OrderDetail, OrderLineDetail } from '../../lib/dto';

type Dlg = null | 'edit' | 'cancel' | 'ship' | 'split' | 'customer' | { kind: 'reassign'; line: OrderLineDetail } | { kind: 'override'; line: OrderLineDetail } | { kind: 'expedite'; receipt: { id: number; receiptNumber: string; expectedArrivalTime: string } };

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const dispatch = useAppDispatch();
  const order = useGetOrderQuery(orderId, { skip: !Number.isFinite(orderId) });
  const [timelineSku, setTimelineSku] = useState<string>('');
  const [timelineLoc, setTimelineLoc] = useState<string>('');
  const [timelineView, setTimelineView] = useState<'timeline' | 'explain'>('timeline');
  const locFilter = useListLocationsQuery({ pageSize: 200 });
  const timeline = useGetOrderTimelineQuery({ id: orderId, skuId: timelineSku ? Number(timelineSku) : undefined, locationId: timelineLoc ? Number(timelineLoc) : undefined }, { skip: !Number.isFinite(orderId) });
  const comms = useGetOrderCommunicationsQuery(orderId, { skip: !Number.isFinite(orderId) });
  const [confirmOrder, confirmState] = useConfirmOrderMutation();
  const [dialog, setDialog] = useState<Dlg>(null);

  if (order.isLoading) return <DetailSkeleton />;
  if (order.error) return <ErrorState message={errorMessage(order.error, 'This order could not be loaded.')} onRetry={() => order.refetch()} />;
  const o = order.data as OrderDetail;
  if (!o) return null;

  const s = o.summary;
  const openLines = o.lines.filter((l) => l.openQty > 0);
  const canAct = o.status === 'CONFIRMED' || o.status === 'FULFILLING';
  const lineColumns: ColumnDef<OrderLineDetail, any>[] = [
    { accessorKey: 'sku.skuCode', header: 'SKU', cell: ({ row }) => <div><p className="font-medium">{row.original.sku.skuCode}</p><p className="max-w-[200px] truncate text-xs text-muted-foreground">{row.original.sku.name}</p></div> },
    { accessorKey: 'requestedQty', header: 'Requested', cell: ({ row }) => <span className="tabular">{fmtNum(row.original.requestedQty)}{row.original.shippedQty > 0 && <span className="block text-[11px] text-muted-foreground">{fmtNum(row.original.shippedQty)} shipped</span>}</span> },
    { accessorKey: 'allocatedQty', header: 'Allocated', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
    { accessorKey: 'backorderedQty', header: 'Backordered', cell: ({ getValue }) => <span className={`tabular ${getValue<number>() > 0 ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>{fmtNum(getValue<number>())}</span> },
    { id: 'fulfillment', header: 'Fulfillment location', cell: ({ row }) => (
      <div className="text-xs"><span className="font-medium">{row.original.fulfillmentLocation?.locationCode ?? '—'}</span>{row.original.preferredLocation && <span className="block text-muted-foreground">Preferred {row.original.preferredLocation.locationCode}</span>}</div>
    ) },
    { id: 'promise', header: 'Promised ship', cell: ({ row }) => (
      <div className="text-xs">
        <span className="tabular font-medium">{fmtDate(row.original.effectivePromisedDate)}</span>
        {row.original.manualPromisedDate && <span className="mt-0.5 block rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning" title={row.original.manualPromiseReason ?? ''}>Manual override</span>}
        {row.original.manualPromisedDate && row.original.calculatedPromisedDate !== row.original.manualPromisedDate && <span className="block text-muted-foreground">Calc. {fmtDate(row.original.calculatedPromisedDate)}</span>}
      </div>
    ) },
    { accessorKey: 'allocationStatus', header: 'Allocation', cell: ({ getValue }) => <AllocationBadge value={getValue<string>()} /> },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        {row.original.openQty > 0 && canAct && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'reassign', line: row.original })} aria-label={`Reassign ${row.original.sku.skuCode}`}><Route className="h-3.5 w-3.5" />Reassign</Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'override', line: row.original })} aria-label={`Override promise for ${row.original.sku.skuCode}`}><Pencil className="h-3.5 w-3.5" />Promise</Button>
          </>
        )}
      </div>
    ) },
  ];

  const explanation = (timeline.data?.promiseExplanations ?? []) as Array<{ lineId: number; lineNumber: number; sku: string; promised: string | null; explanation: string }>;

  return (
    <>
      <PageHeader
        title={o.orderNumber}
        crumbs={[{ label: 'Orders', to: '/orders' }, { label: o.orderNumber }]}
        description={<span className="inline-flex flex-wrap items-center gap-2"><span>{o.customer.name}</span><span>·</span><span>Created {fmtDateTime(o.createdAt)}</span>{o.confirmedAt && <><span>·</span><span>Confirmed {fmtDateTime(o.confirmedAt)}</span></>}</span>}
        actions={
          <>
            {o.status === 'DRAFT' && (
              <Button onClick={async () => { try { await confirmOrder({ id: o.id, version: o.version }).unwrap(); dispatch(pushToast({ tone: 'success', title: `${o.orderNumber} confirmed`, description: 'Demand reserved; promises calculated.' })); } catch (e) { dispatch(pushToast({ tone: 'error', title: 'Not confirmed', description: errorMessage(e) })); } }} loading={confirmState.isLoading}>
                <CheckCheck className="h-4 w-4" /> Confirm order
              </Button>
            )}
            {o.isEditable && <Button variant="secondary" onClick={() => setDialog('edit')}><Edit3 className="h-4 w-4" /> Edit</Button>}
            {canAct && <Button variant="secondary" onClick={() => setDialog('ship')} disabled={openLines.length === 0}><PackageCheck className="h-4 w-4" /> Ship</Button>}
            {canAct && <Button variant="secondary" onClick={() => setDialog('split')} disabled={openLines.length === 0}><Scissors className="h-4 w-4" /> Split shipment</Button>}
            <Button variant="secondary" onClick={() => setDialog('customer')} disabled={o.status === 'DRAFT'}><MessageSquare className="h-4 w-4" /> Generate customer update</Button>
            {(o.status === 'DRAFT' || canAct) && <Button variant="danger" onClick={() => setDialog('cancel')}><Ban className="h-4 w-4" /> Cancel</Button>}
          </>
        }
      />

      <section aria-label="Order header" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <HeaderStat label="Status"><OrderStatusBadge value={o.status} /></HeaderStat>
        <HeaderStat label="Priority"><PriorityBadge value={o.priority} /></HeaderStat>
        <HeaderStat label="Risk"><RiskBadge value={o.riskLevel} /></HeaderStat>
        <HeaderStat label="Requested ship" icon={<CalendarClock className="h-3.5 w-3.5" />}><span className="tabular text-sm font-semibold">{fmtDate(o.requestedShipDate)}</span></HeaderStat>
        <HeaderStat label="Promised ship" icon={<Clock className="h-3.5 w-3.5" />}><span className={`tabular text-sm font-semibold ${s.daysLate > 0 ? 'text-danger' : ''}`}>{fmtDate(o.promisedShipDate)}</span>{s.daysLate > 0 && <span className="block text-[11px] text-danger">{s.daysLate} day(s) late</span>}</HeaderStat>
        <HeaderStat label="Allocation"><AllocationBadge value={o.allocationStatus} /></HeaderStat>
      </section>

      {o.status === 'DRAFT' && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 text-info" aria-hidden />
          <p>This is a draft. Inventory is <span className="font-medium">not reserved</span> yet. Confirm the order to allocate stock and calculate promise dates.</p>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Order lines" description="Allocation, backorders and promised dates per line. Planner actions are available per line." />
        <DataTable<OrderLineDetail> caption="Order lines" columns={lineColumns} data={o.lines} rowKey={(l) => l.id} minWidth={980} empty={{ title: 'No open lines', description: 'Every line has been shipped or removed.' }} />
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">

          <Card>
            <CardHeader title="Supply dependency" description="Which inbound receipts this order is relying on, and how late they are" />
            <CardBody>
              {o.supplyDependencies.length === 0 ? (
                <EmptyState icon={CheckCheck} title="No inbound dependency" description={o.allocationStatus === 'BACKORDERED' ? 'Nothing is allocated yet, so there is nothing to depend on.' : 'Every allocated unit is on hand.'} />
              ) : (
                <ul className="divide-y divide-border">
                  {o.supplyDependencies.map((d) => (
                    <li key={d.receiptId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link to={`/supply/receipts/${d.receiptId}`} className="font-medium hover:text-info hover:underline">{d.receiptNumber}</Link>
                        <p className="text-xs text-muted-foreground">{d.sku} · {fmtNum(d.quantity)} units to {d.location} · supports line {d.lines.join(', ')}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ReceiptBadge value={d.status} />
                        {d.delayDays > 0 && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">Delayed +{d.delayDays}d (was {fmtDate(d.originalExpectedArrival)})</span>}
                        <span className="tabular text-xs">Arrives {fmtDate(d.expectedArrival)}</span>
                        {d.status !== 'RECEIVED' && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'expedite', receipt: { id: d.receiptId, receiptNumber: d.receiptNumber, expectedArrivalTime: d.expectedArrival } })}><Gauge className="h-3.5 w-3.5" />Expedite</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Supply-demand timeline"
              description="Chronological events with their impact on ATP. Filter by SKU and warehouse."
              actions={<Tabs value={timelineView} onChange={setTimelineView} items={[{ value: 'timeline', label: 'Timeline' }, { value: 'explain', label: 'Why this promise?' }]} />}
            />
            <CardBody className="space-y-4">
              {timelineView === 'timeline' ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Select aria-label="Filter timeline by SKU" className="w-56" value={timelineSku} onChange={(e) => setTimelineSku(e.target.value)}>
                      <option value="">All SKUs</option>
                      {o.lines.map((l) => <option key={l.sku.id} value={l.sku.id}>{l.sku.skuCode}</option>)}
                    </Select>
                    <Select aria-label="Filter timeline by location" className="w-56" value={timelineLoc} onChange={(e) => setTimelineLoc(e.target.value)}>
                      <option value="">All warehouses</option>
                      {locFilter.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}
                    </Select>
                  </div>
                  {timeline.isLoading ? <Skeleton className="h-64 w-full" /> : timeline.error ? <ErrorState message={errorMessage(timeline.error)} /> : <OrderTimeline events={timeline.data?.events ?? []} />}
                </>
              ) : (
                <ul className="space-y-3">
                  {explanation.map((x) => (
                    <li key={x.lineId} className="rounded-xl border border-border p-4">
                      <p className="text-sm font-medium">Line {x.lineNumber} · {x.sku} · promise {fmtDate(x.promised)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{x.explanation}</p>
                    </li>
                  ))}
                  {explanation.length === 0 && <p className="text-sm text-muted-foreground">No lines to explain.</p>}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Fulfillment summary" description="What can ship, when, and what is still missing" />
            <CardBody className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Kv k="Fully allocated lines" v={fmtNum(s.fullyAllocatedLines)} />
                <Kv k="Partially allocated" v={fmtNum(s.partiallyAllocatedLines)} warn={s.partiallyAllocatedLines > 0} />
                <Kv k="Backordered lines" v={fmtNum(s.backorderedLines)} warn={s.backorderedLines > 0} />
                <Kv k="Backordered units" v={fmtNum(s.backorderedUnits)} warn={s.backorderedUnits > 0} />
                <Kv k="Units requested" v={fmtNum(s.totalRequested)} />
                <Kv k="Units shipped" v={fmtNum(s.totalShipped)} />
                <Kv k="Earliest possible shipment" v={fmtDate(s.earliestPossibleShipment)} />
                <Kv k="Expected completion" v={fmtDate(s.expectedCompletionDate)} />
              </dl>
              {openLines.some((l) => l.backorderedQty > 0) && (
                <p className="flex items-start gap-2 rounded-lg bg-danger/5 p-3 text-xs text-danger"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Backordered units have no committed supply. Their date is a lead-time estimate (or none, if the SKU has no lead time).</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Shipments" description={o.shipments.length ? 'Each shipment is immutable and tracked separately' : 'No shipments yet'} />
            <CardBody className="space-y-3">
              {o.shipments.length === 0 && <p className="text-sm text-muted-foreground">Nothing has shipped yet.</p>}
              {o.shipments.map((sh) => (
                <div key={sh.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex items-center justify-between"><span className="font-medium">{sh.shipmentNumber}</span><span className="tabular text-xs text-muted-foreground">{fmtDateTime(sh.shippedAt)}</span></div>
                  <p className="mt-0.5 text-xs text-muted-foreground">From {sh.location}{sh.isSplit ? ' · split shipment' : ''}{sh.reason ? ` · “${sh.reason}”` : ''}</p>
                  <ul className="mt-2 space-y-1 text-xs">{sh.lines.map((l, i) => <li key={i} className="flex justify-between"><span>{l.sku}</span><span className="tabular">{fmtNum(l.quantity)} · {l.onTime ? <span className="text-success">on time</span> : <span className="text-danger">late</span>}</span></li>)}</ul>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Open exceptions" description="Issues that need a planner decision" actions={<Link to="/exceptions" className="text-xs text-info hover:underline">Queue</Link>} />
            <CardBody className="space-y-2">
              {o.openExceptions.length === 0 && <p className="text-sm text-muted-foreground">No open exceptions.</p>}
              {o.openExceptions.map((e) => (
                <Link key={e.id} to={`/exceptions?open=${e.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-accent">
                  <span className="flex flex-col"><ExceptionTypeLabel value={e.type} /><span className="text-[11px] text-muted-foreground">{e.exceptionNumber} · {fmtNum(e.affectedQty)} units</span></span>
                  <SeverityBadge value={e.severity} />
                </Link>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer communications" description={`${comms.data?.length ?? 0} recorded`} />
            <CardBody className="space-y-2">
              {comms.data?.length === 0 && <p className="text-sm text-muted-foreground">No updates have been recorded yet.</p>}
              {comms.data?.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.subject}</span>{c.aiGenerated && <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info">AI-drafted</span>}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Sent {fmtDateTime(c.sentAt)} · {c.createdBy ?? 'system'}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* dialogs */}
      <EditOrderDialog open={dialog === 'edit'} onClose={() => setDialog(null)} order={o} />
      <CancelOrderDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} order={o} />
      <ShipDialog open={dialog === 'ship'} onClose={() => setDialog(null)} order={o} />
      <SplitShipmentDialog open={dialog === 'split'} onClose={() => setDialog(null)} orderId={o.id} lines={openLines.map((l) => ({ id: l.id, skuCode: l.sku.skuCode, openQty: l.openQty, allocatedQty: l.allocatedQty }))} />
      <CustomerUpdateDialog open={dialog === 'customer'} onClose={() => setDialog(null)} orderId={o.id} orderNumber={o.orderNumber} />
      {typeof dialog === 'object' && dialog?.kind === 'reassign' && <ReassignDialog open onClose={() => setDialog(null)} orderLineId={dialog.line.id} skuCode={dialog.line.sku.skuCode} />}
      {typeof dialog === 'object' && dialog?.kind === 'override' && <OverrideDialog open onClose={() => setDialog(null)} line={{ id: dialog.line.id, skuCode: dialog.line.sku.skuCode, calculatedPromisedDate: dialog.line.calculatedPromisedDate, manualPromisedDate: dialog.line.manualPromisedDate }} />}
      {typeof dialog === 'object' && dialog?.kind === 'expedite' && <ExpediteDialog open onClose={() => setDialog(null)} receipt={dialog.receipt} />}
    </>
  );
}

function HeaderStat({ label, children, icon }: { label: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{icon}{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Kv({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <dt className="text-[11px] text-muted-foreground">{k}</dt>
      <dd className={`tabular mt-0.5 font-semibold ${warn ? 'text-danger' : ''}`}>{v}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export { humanize };
