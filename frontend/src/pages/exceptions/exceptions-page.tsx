import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CheckCircle2, Search, Sparkles, X, Route, Pencil, Scissors, Gauge, ClipboardList, History, ShieldAlert } from 'lucide-react';
import { errorMessage, useExceptionSummaryMutation, useGetExceptionQuery, useListExceptionsQuery, useResolveExceptionMutation } from '../../app/api';
import { useAppDispatch } from '../../app/hooks';
import { PageHeader } from '../../components/common/page-header';
import { PriorityBadge, SeverityBadge, ExceptionTypeLabel } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select, Textarea } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { Tabs } from '../../components/ui/tabs';
import { ErrorState, Skeleton } from '../../components/ui/states';
import { ExpediteDialog, OverrideDialog, ReassignDialog, SplitShipmentDialog } from '../../components/planner/planner-dialogs';
import { pushToast } from '../../features/ui/uiSlice';
import { useUrlFilters } from '../../lib/url-state';
import { fmtDate, fmtDateTime, fmtNum, humanize } from '../../lib/utils';
import type { ExceptionRow } from '../../lib/dto';

const DEFAULTS = { search: '', severity: '', type: '', priority: '', status: 'OPEN', sort: 'risk', open: '', page: '1' };
const TYPES = ['PROMISE_DATE_AT_RISK', 'BACKORDER', 'DELAYED_INBOUND', 'CANCELED_INBOUND_DEPENDENCY', 'HIGH_PRIORITY_INSUFFICIENT_STOCK'];

export function ExceptionsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const [draft, setDraft] = useState(filters.search);
  useEffect(() => setDraft(filters.search), [filters.search]);
  useEffect(() => {
    const t = window.setTimeout(() => draft !== filters.search && setFilters({ search: draft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [draft, filters.search, setFilters]);
  const q = useListExceptionsQuery({
    search: filters.search || undefined,
    severity: (filters.severity || undefined) as 'CRITICAL',
    type: (filters.type || undefined) as 'BACKORDER',
    priority: (filters.priority || undefined) as 'HIGH',
    status: filters.status as 'OPEN',
    sort: filters.sort as 'risk',
    page: Number(filters.page) || 1,
    pageSize: 20,
  });
  const openId = Number(filters.open) || null;

  const columns = useMemo<ColumnDef<ExceptionRow, any>[]>(() => [
    { accessorKey: 'exceptionNumber', header: 'Exception ID', cell: ({ getValue }) => <span className="whitespace-nowrap font-mono text-xs">{getValue<string>()}</span> },
    { accessorKey: 'order.orderNumber', header: 'Order', cell: ({ row }) => <span className="whitespace-nowrap font-medium">{row.original.order.orderNumber}</span> },
    { accessorKey: 'customer', header: 'Customer', cell: ({ getValue }) => <span className="block max-w-[150px] truncate text-xs" title={getValue<string>()}>{getValue<string>()}</span> },
    { accessorKey: 'sku.skuCode', header: 'SKU', cell: ({ getValue }) => <span className="whitespace-nowrap text-sm">{getValue<string>()}</span> },
    { accessorKey: 'priority', header: 'Priority', cell: ({ getValue }) => <PriorityBadge value={getValue<string>()} /> },
    { accessorKey: 'type', header: 'Exception type', cell: ({ getValue }) => <span className="block max-w-[150px] text-sm leading-snug"><ExceptionTypeLabel value={getValue<string>()} /></span> },
    { accessorKey: 'affectedQty', header: 'Units', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
    { accessorKey: 'currentPromisedDate', header: 'Promised', cell: ({ row }) => <span className={`tabular text-xs ${row.original.currentPromisedDate && row.original.requestedShipDate && row.original.currentPromisedDate > row.original.requestedShipDate ? 'font-semibold text-danger' : ''}`}>{fmtDate(row.original.currentPromisedDate)}</span> },
    { accessorKey: 'requestedShipDate', header: 'Requested', cell: ({ getValue }) => <span className="tabular text-xs text-muted-foreground">{fmtDate(getValue<string | null>())}</span> },
    { accessorKey: 'severity', header: 'Severity', cell: ({ getValue }) => <SeverityBadge value={getValue<string>()} /> },
    { accessorKey: 'recommendedAction', header: 'Recommended action', enableSorting: false, cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-xs text-muted-foreground" title={getValue<string>()}>{getValue<string>()}</span> },
    { accessorKey: 'createdAt', header: 'Created', cell: ({ getValue }) => <span className="tabular text-xs text-muted-foreground">{fmtDate(getValue<string>().slice(0, 10))}</span> },
  ], []);

  return (
    <>
      <PageHeader title="Exceptions queue" description="Fulfillment risks the system detected. Sorted by risk by default. Each item links to its order and offers the planner actions that resolve it." />
      <div className="mb-4"><Tabs value={filters.status as 'OPEN'} onChange={(v) => setFilters({ status: v, page: '1' })} items={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }]} /></div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Search exceptions" placeholder="Search order, customer, SKU or ID…" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
          <Select aria-label="Filter by severity" className="w-40" value={filters.severity} onChange={(e) => setFilters({ severity: e.target.value, page: '1' })}><option value="">All severities</option>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Select aria-label="Filter by exception type" className="w-56" value={filters.type} onChange={(e) => setFilters({ type: e.target.value, page: '1' })}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
          <Select aria-label="Filter by priority" className="w-36" value={filters.priority} onChange={(e) => setFilters({ priority: e.target.value, page: '1' })}><option value="">All priorities</option><option value="HIGH">High</option><option value="MED">Medium</option><option value="LOW">Low</option></Select>
          <Select aria-label="Sort exceptions" className="w-44" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value, page: '1' })}><option value="risk">Sort: risk</option><option value="created">Sort: newest</option><option value="promised">Sort: promised date</option><option value="qty">Sort: units</option></Select>
        </div>
        <DataTable<ExceptionRow>
          caption="Exceptions"
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isLoading || q.isFetching}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => q.refetch()}
          rowKey={(e) => e.id}
          minWidth={1240}
          onRowClick={(e) => setFilters({ open: String(e.id) }, true)}
          rowClassName={(e) => (openId === e.id ? 'bg-info/5' : undefined)}
          empty={{ title: filters.status === 'OPEN' ? 'No open exceptions' : 'No resolved exceptions', description: filters.status === 'OPEN' ? 'Every order is on plan. Exceptions appear here when promises slip or stock runs short.' : 'Resolved items are kept here for reference.', action: <Button size="sm" variant="secondary" onClick={() => navigate('/orders')}>Go to orders</Button> }}
        />
        <Pagination meta={q.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      </Card>

      <AnimatePresence>
        {openId && <ExceptionDrawer key={openId} id={openId} onClose={() => setFilters({ open: '' }, true)} />}
      </AnimatePresence>
    </>
  );
}

function ExceptionDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const q = useGetExceptionQuery(id);
  const [summarize, sState] = useExceptionSummaryMutation();
  const [resolve, rState] = useResolveExceptionMutation();
  const [summary, setSummary] = useState<any>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | 'expedite' | 'reassign' | 'override' | 'split'>(null);
  const e = q.data;

  const onSummary = async () => {
    try {
      setSummary((await summarize({ exceptionId: id }).unwrap()).output);
    } catch (err) {
      dispatch(pushToast({ tone: 'error', title: 'Summary unavailable', description: errorMessage(err) }));
    }
  };
  const onResolve = async () => {
    if (note.trim().length < 3) return setNoteError('Describe what you did (at least 3 characters).');
    try {
      await resolve({ id, note: note.trim() }).unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Exception resolved', description: 'Recorded in the exception history. It will reappear only if the condition returns.' }));
      onClose();
    } catch (err) {
      dispatch(pushToast({ tone: 'error', title: 'Not resolved', description: errorMessage(err) }));
    }
  };

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-slate-950/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Exception details"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-pop"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{e?.exceptionNumber ?? '…'}</p>
            <h2 className="mt-0.5 truncate text-base font-semibold">{e ? humanize(e.type) : 'Loading…'}</h2>
            {e && <div className="mt-1.5 flex flex-wrap items-center gap-2"><SeverityBadge value={e.severity} /><PriorityBadge value={e.priority} /><span className="text-xs text-muted-foreground">{e.status === 'OPEN' ? 'Open' : `Resolved ${fmtDateTime(e.resolvedAt)}`}</span></div>}
          </div>
          <button type="button" aria-label="Close details" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {q.isLoading && <Skeleton className="h-64 w-full" />}
          {q.error && <ErrorState message={errorMessage(q.error)} />}
          {e && (
            <>
              <div className="rounded-xl bg-muted/50 p-4 text-sm">
                <p className="font-medium">Recommended action</p>
                <p className="mt-1 text-muted-foreground">{e.recommendedAction}</p>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field k="Order" v={<Link to={`/orders/${e.order.id}`} className="font-medium text-info hover:underline">{e.order.orderNumber}</Link>} />
                <Field k="Customer" v={e.customer} />
                <Field k="SKU" v={e.sku.skuCode} />
                <Field k="Units affected" v={fmtNum(e.affectedQty)} />
                <Field k="Promised" v={fmtDate(e.currentPromisedDate)} warn={!!e.currentPromisedDate && !!e.requestedShipDate && e.currentPromisedDate > e.requestedShipDate} />
                <Field k="Requested" v={fmtDate(e.requestedShipDate)} />
                {e.receipt && <Field k="Receipt" v={<Link to={`/supply/receipts/${e.receipt.id}`} className="text-info hover:underline">{e.receipt.receiptNumber} ({humanize(e.receipt.status)})</Link>} />}
                <Field k="Opened" v={fmtDateTime(e.createdAt)} />
              </dl>

              <section aria-label="Planner actions">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planner actions</p>
                <div className="grid grid-cols-2 gap-2">
                  {e.receipt && e.receipt.status !== 'RECEIVED' && e.receipt.status !== 'CANCELED' && (
                    <Button variant="secondary" size="sm" onClick={() => setDlg('expedite')} disabled={e.status !== 'OPEN'}><Gauge className="h-3.5 w-3.5" /> Expedite receipt</Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setDlg('reassign')} disabled={e.status !== 'OPEN' || !e.orderLineId}><Route className="h-3.5 w-3.5" /> Reassign location</Button>
                  <Button variant="secondary" size="sm" onClick={() => setDlg('override')} disabled={e.status !== 'OPEN' || !e.orderLineId}><Pencil className="h-3.5 w-3.5" /> Override promise</Button>
                  <Button variant="secondary" size="sm" onClick={() => setDlg('split')} disabled={e.status !== 'OPEN'}><Scissors className="h-3.5 w-3.5" /> Split shipment</Button>
                  <Link to={`/orders/${e.order.id}`} className="col-span-2"><Button variant="ghost" size="sm" className="w-full"><ClipboardList className="h-3.5 w-3.5" /> Open order</Button></Link>
                </div>
              </section>

              <Card className="border-info/30">
                <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-info" /> AI explanation</span>} description="Advisory only. Nothing is applied automatically." actions={<Button size="sm" variant="secondary" onClick={onSummary} loading={sState.isLoading}>{summary ? 'Regenerate' : 'Explain'}</Button>} />
                <CardBody className="space-y-3 text-sm">
                  {!summary && !sState.isLoading && <p className="text-muted-foreground">Generate a structured explanation: what happened, the current plan, next best actions and their likely impact on the promise.</p>}
                  {summary && (
                    <>
                      <Block title="What happened" text={summary.whatHappened} />
                      <Block title="Current plan" text={summary.currentPlan} />
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next best actions</p>
                        <ol className="mt-1.5 list-decimal space-y-1.5 pl-5">
                          {summary.nextBestActions.map((a: any, i: number) => <li key={i}><span className="font-medium">{a.action}</span><span className="block text-xs text-muted-foreground">Impact: {a.impact}</span></li>)}
                        </ol>
                      </div>
                      <Block title="Impact" text={summary.impact} />
                    </>
                  )}
                </CardBody>
              </Card>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current allocations for this line</p>
                {e.currentAllocations.length === 0 ? <p className="text-sm text-muted-foreground">No units are currently allocated.</p> : (
                  <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                    {e.currentAllocations.map((a, i) => <li key={i} className="flex items-center justify-between px-3 py-2"><span>{a.source === 'ON_HAND' ? `On hand @ ${a.location}` : `${a.receiptNumber} @ ${a.location}`}</span><span className="tabular">{fmtNum(a.quantity)} · {fmtDate(a.availableDate)}</span></li>)}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><History className="h-3.5 w-3.5" /> Exception history</p>
                <ol className="space-y-2 border-l border-border pl-4">
                  {e.history.map((h) => (
                    <li key={h.id} className="relative text-xs">
                      <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-info" aria-hidden />
                      <p className="font-medium">{humanize(h.action)}</p>
                      <p className="text-muted-foreground">{fmtDateTime(h.timestamp)} · {h.user?.name ?? 'system'}{h.reason ? ` · ${h.reason}` : ''}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {e.status === 'OPEN' ? (
                <div className="rounded-xl border border-border p-4">
                  <label htmlFor="resolve-note" className="text-sm font-semibold">Resolve this exception</label>
                  <p className="mb-2 text-xs text-muted-foreground">Describe the action taken or why it is acceptable. Resolution is recorded in the audit log.</p>
                  <Textarea id="resolve-note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. Customer accepted a split shipment on 3 Nov" />
                  {noteError && <p role="alert" className="mt-1 text-xs text-danger">{noteError}</p>}
                  <div className="mt-3 flex justify-end"><Button size="sm" variant="success" onClick={onResolve} loading={rState.isLoading}><CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved</Button></div>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-xs text-success"><CheckCircle2 className="h-4 w-4" /> Resolved{e.resolutionNote ? `: ${e.resolutionNote}` : ''}</p>
              )}
              {e.type === 'CANCELED_INBOUND_DEPENDENCY' && <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" /> This exception is event-driven and is only closed by a planner.</p>}
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" /> Affected units: {fmtNum(e.affectedQty)}</p>
            </>
          )}
        </div>
      </motion.aside>

      {e && dlg === 'expedite' && e.receipt && <ExpediteDialog open onClose={() => setDlg(null)} receipt={{ id: e.receipt.id, receiptNumber: e.receipt.receiptNumber, expectedArrivalTime: e.receipt.expectedArrival ?? new Date().toISOString() }} />}
      {e && dlg === 'reassign' && e.orderLineId && <ReassignDialog open onClose={() => setDlg(null)} orderLineId={e.orderLineId} skuCode={e.sku.skuCode} />}
      {e && dlg === 'override' && e.orderLineId && <OverrideDialog open onClose={() => setDlg(null)} line={{ id: e.orderLineId, skuCode: e.sku.skuCode, calculatedPromisedDate: e.currentPromisedDate, manualPromisedDate: null }} />}
      {e && dlg === 'split' && <SplitShipmentDialog open onClose={() => setDlg(null)} orderId={e.order.id} lines={e.orderLineId ? [{ id: e.orderLineId, skuCode: e.sku.skuCode, openQty: e.affectedQty, allocatedQty: 0 }] : []} />}
    </>
  );
}

function Field({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <dt className="text-[11px] text-muted-foreground">{k}</dt>
      <dd className={`mt-0.5 text-sm font-medium ${warn ? 'text-danger' : ''}`}>{v}</dd>
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-1 leading-relaxed">{text}</p>
    </div>
  );
}
