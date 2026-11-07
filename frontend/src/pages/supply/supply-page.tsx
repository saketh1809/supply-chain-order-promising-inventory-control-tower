import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useListInventoryQuery, useListReceiptsQuery, useListLocationsQuery, useMarkReceiptInTransitMutation, useReceiveReceiptMutation } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { ReceiptBadge, StockBadge } from '../../components/common/status';
import { Card } from '../../components/ui/card';
import { Tabs } from '../../components/ui/tabs';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { AdjustmentDialog } from '../../components/inventory/adjustment-dialog';
import { ReceiptFormDialog, CancelReceiptDialog } from '../../components/supply/receipt-dialogs';
import { pushToast } from '../../features/ui/uiSlice';
import { useUrlFilters } from '../../lib/url-state';
import { fmtDate, fmtNum, humanize } from '../../lib/utils';
import type { InventoryRow, ReceiptRow } from '../../lib/dto';
import { Plus, PackagePlus, Search } from 'lucide-react';

const RDEFAULTS = { search: '', status: '', locationId: '', from: '', to: '', sort: 'expected', page: '1' };

export function SupplyPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') === 'receipts' ? 'receipts' : 'onhand') as 'onhand' | 'receipts';
  const setTab = (t: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', t); return n; }, { replace: true });
  return (
    <>
      <PageHeader title="Supply & receipts" description="On-hand inventory you can adjust, and inbound receipts that feed future ATP." />
      <div className="mb-6"><Tabs value={tab} onChange={setTab} items={[{ value: 'onhand', label: 'On-hand inventory' }, { value: 'receipts', label: 'Inbound receipts' }]} /></div>
      {tab === 'onhand' ? <OnHandTab /> : <ReceiptsTab />}
    </>
  );
}

function OnHandTab() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters({ search: '', locationId: '', page: '1' });
  const [draft, setDraft] = useState(filters.search);
  const [adjust, setAdjust] = useState<{ skuId: number; locationId: number } | null>(null);
  useEffect(() => setDraft(filters.search), [filters.search]);
  useEffect(() => {
    const t = window.setTimeout(() => draft !== filters.search && setFilters({ search: draft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [draft, filters.search, setFilters]);
  const q = useListInventoryQuery({ search: filters.search || undefined, locationId: filters.locationId ? Number(filters.locationId) : undefined, page: Number(filters.page) || 1, pageSize: 25 });
  const locations = useListLocationsQuery({ pageSize: 200 });
  const columns = useMemo<ColumnDef<InventoryRow, any>[]>(() => [
    { accessorKey: 'skuCode', header: 'SKU', cell: ({ row }) => <div><p className="font-medium">{row.original.skuCode}</p><p className="max-w-[200px] truncate text-xs text-muted-foreground">{row.original.productName}</p></div> },
    { accessorKey: 'locationCode', header: 'Location' },
    { accessorKey: 'onHand', header: 'On hand (editable)', cell: ({ getValue }) => <span className="tabular font-semibold">{fmtNum(getValue<number>())}</span> },
    { accessorKey: 'allocated', header: 'Allocated', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
    { accessorKey: 'available', header: 'Available', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StockBadge value={getValue<string>()} /> },
    { id: 'adjust', header: '', enableSorting: false, cell: ({ row }) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => setAdjust({ skuId: row.original.skuId, locationId: row.original.locationId })}>Adjust</Button>
        <Link to={`/inventory/${row.original.balanceId}`} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs hover:bg-accent">History</Link>
      </div>
    ) },
  ], []);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Search on-hand inventory" placeholder="Search SKU…" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
        <Select aria-label="Filter on-hand by location" className="w-52" value={filters.locationId} onChange={(e) => setFilters({ locationId: e.target.value, page: '1' })}><option value="">All locations</option>{locations.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}</Select>
        <Button onClick={() => setAdjust({ skuId: 0, locationId: 0 })}><Plus className="h-4 w-4" /> Adjustment</Button>
      </div>
      <DataTable<InventoryRow> caption="On-hand inventory" columns={columns} data={q.data?.items ?? []} loading={q.isLoading || q.isFetching} error={q.error ? errorMessage(q.error) : null} onRetry={() => q.refetch()} rowKey={(r) => r.balanceId} onRowClick={(r) => navigate(`/inventory/${r.balanceId}`)} empty={{ title: 'No on-hand stock recorded', description: 'Record an opening count with an adjustment to start.' }} />
      <Pagination meta={q.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      <AdjustmentDialog open={!!adjust} onClose={() => setAdjust(null)} defaults={adjust && adjust.skuId ? { skuId: adjust.skuId, locationId: adjust.locationId } : undefined} />
    </Card>
  );
}

function ReceiptsTab() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [filters, setFilters] = useUrlFilters(RDEFAULTS);
  const [draft, setDraft] = useState(filters.search);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState<ReceiptRow | null>(null);
  const [inTransit] = useMarkReceiptInTransitMutation();
  const [receive] = useReceiveReceiptMutation();
  useEffect(() => setDraft(filters.search), [filters.search]);
  useEffect(() => {
    const t = window.setTimeout(() => draft !== filters.search && setFilters({ search: draft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [draft, filters.search, setFilters]);
  const sortMap: Record<string, string> = { expected: 'expected', status: 'status', receiptNumber: 'receiptNumber', quantity: 'quantity' };
  const q = useListReceiptsQuery({ search: filters.search || undefined, status: filters.status || undefined, locationId: filters.locationId ? Number(filters.locationId) : undefined, from: filters.from || undefined, to: filters.to || undefined, sort: sortMap[filters.sort] as any, page: Number(filters.page) || 1, pageSize: 20 });
  const locations = useListLocationsQuery({ pageSize: 200 });

  const onReceive = async (r: ReceiptRow) => {
    try {
      const res = await receive({ id: r.id }).unwrap();
      if (res.idempotent) dispatch(pushToast({ tone: 'info', title: `${r.receiptNumber} was already received`, description: 'No inventory was added a second time.' }));
      else dispatch(pushToast({ tone: 'success', title: `${r.receiptNumber} received`, description: `On hand ${fmtNum(res.inventory.previousOnHand)} → ${fmtNum(res.inventory.newOnHand)}. Allocations recalculated.` }));
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Could not receive', description: errorMessage(e) }));
    }
  };

  const columns = useMemo<ColumnDef<ReceiptRow, any>[]>(() => [
    { accessorKey: 'receiptNumber', header: 'Receipt', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
    { accessorKey: 'skuCode', header: 'SKU', cell: ({ row }) => <div><p className="font-medium">{row.original.skuCode}</p><p className="max-w-[180px] truncate text-xs text-muted-foreground">{row.original.productName}</p></div> },
    { accessorKey: 'locationCode', header: 'Destination' },
    { accessorKey: 'quantity', header: 'Quantity', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
    { accessorKey: 'expectedArrivalTime', header: 'Expected', cell: ({ row }) => <div className="tabular text-xs">{fmtDate(row.original.expectedArrivalTime.slice(0, 10))}{row.original.delayDays > 0 && <span className="ml-1.5 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">+{row.original.delayDays}d</span>}</div> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <ReceiptBadge value={getValue<string>()} /> },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => {
      const r = row.original;
      const open = r.status === 'PLANNED' || r.status === 'IN_TRANSIT';
      return (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {r.status === 'PLANNED' && <Button size="sm" variant="ghost" onClick={async () => { try { await inTransit(r.id).unwrap(); dispatch(pushToast({ tone: 'info', title: `${r.receiptNumber} in transit` })); } catch (e) { dispatch(pushToast({ tone: 'error', title: 'Not updated', description: errorMessage(e) })); } }}>In transit</Button>}
          {open && <Button size="sm" variant="success" onClick={() => onReceive(r)}>Receive</Button>}
          {open && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setCancelFor(r)}>Cancel</Button>}
          <Link to={`/supply/receipts/${r.id}`} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs hover:bg-accent">Open</Link>
        </div>
      );
    } },
  ], [dispatch, inTransit, receive]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Search receipts" placeholder="Search receipt or SKU…" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
        <Select aria-label="Filter receipts by status" className="w-40" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })}><option value="">All statuses</option>{['PLANNED', 'IN_TRANSIT', 'RECEIVED', 'CANCELED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Select aria-label="Filter receipts by destination" className="w-48" value={filters.locationId} onChange={(e) => setFilters({ locationId: e.target.value, page: '1' })}><option value="">All destinations</option>{locations.data?.items.map((l: { id: number; locationCode: string }) => <option key={l.id} value={l.id}>{l.locationCode}</option>)}</Select>
        <Input aria-label="Expected from" type="date" className="w-40" value={filters.from} onChange={(e) => setFilters({ from: e.target.value, page: '1' })} />
        <Input aria-label="Expected to" type="date" className="w-40" value={filters.to} onChange={(e) => setFilters({ to: e.target.value, page: '1' })} />
        <Select aria-label="Sort receipts" className="w-44" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value, page: '1' })}><option value="expected">Sort: expected date</option><option value="status">Sort: status</option><option value="receiptNumber">Sort: receipt #</option><option value="quantity">Sort: quantity</option></Select>
        <Button onClick={() => setCreateOpen(true)}><PackagePlus className="h-4 w-4" /> New receipt</Button>
      </div>
      <DataTable<ReceiptRow> caption="Inbound receipts" columns={columns} data={q.data?.items ?? []} loading={q.isLoading || q.isFetching} error={q.error ? errorMessage(q.error) : null} onRetry={() => q.refetch()} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/supply/receipts/${r.id}`)} empty={{ title: 'No receipts match', description: 'Create a receipt when a purchase order is placed with a supplier.' }} />
      <Pagination meta={q.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      <ReceiptFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {cancelFor && <CancelReceiptDialog open onClose={() => setCancelFor(null)} receipt={{ id: cancelFor.id, receiptNumber: cancelFor.receiptNumber }} />}
    </Card>
  );
}
