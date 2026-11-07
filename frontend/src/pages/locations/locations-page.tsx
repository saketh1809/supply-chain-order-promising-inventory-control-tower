import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Search, Warehouse } from 'lucide-react';
import { errorMessage, useListLocationsQuery, useUpdateLocationMutation } from '../../app/api';
import { useAppDispatch } from '../../app/hooks';
import { PageHeader } from '../../components/common/page-header';
import { Card } from '../../components/ui/card';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { LocationFormDialog } from '../../components/master/master-forms';
import { pushToast } from '../../features/ui/uiSlice';
import { useUrlFilters } from '../../lib/url-state';
import { fmtNum } from '../../lib/utils';
import type { Location } from '../../lib/types';

const DEFAULTS = { search: '', status: 'all', sort: 'locationCode', page: '1' };

export function LocationsPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const [draft, setDraft] = useState(filters.search);
  const [editing, setEditing] = useState<Location | null | 'new'>(null);
  const [update] = useUpdateLocationMutation();
  useEffect(() => setDraft(filters.search), [filters.search]);
  useEffect(() => {
    const t = window.setTimeout(() => draft !== filters.search && setFilters({ search: draft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [draft, filters.search, setFilters]);
  const q = useListLocationsQuery({ search: filters.search || undefined, status: filters.status as 'all', sort: filters.sort as 'locationCode', page: Number(filters.page) || 1, pageSize: 20 });

  const columns = useMemo<ColumnDef<any, any>[]>(() => [
    { accessorKey: 'locationCode', header: 'Code', cell: ({ getValue }) => <span className="font-semibold">{getValue<string>()}</span> },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'timezone', header: 'Timezone', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string | null>() ?? '—'}</span> },
    { id: 'onHand', header: 'On hand', cell: ({ row }) => <span className="tabular">{fmtNum(row.original.stock.onHand)}</span> },
    { id: 'available', header: 'Available', cell: ({ row }) => <span className="tabular">{fmtNum(row.original.stock.available)}</span> },
    { id: 'incoming', header: 'Incoming', cell: ({ row }) => <span className="tabular">{fmtNum(row.original.stock.incoming)}</span> },
    { accessorKey: 'isActive', header: 'Status', cell: ({ row }) => <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}><Badge tone={row.original.isActive ? 'success' : 'neutral'}>{row.original.isActive ? 'Active' : 'Inactive'}</Badge><Button size="sm" variant="ghost" onClick={async () => { try { await update({ id: row.original.id, version: row.original.version, isActive: !row.original.isActive }).unwrap(); dispatch(pushToast({ tone: 'info', title: row.original.isActive ? 'Location deactivated' : 'Location activated', description: 'Inactive locations cannot receive new receipts or be selected as a preference.' })); } catch (e) { dispatch(pushToast({ tone: 'error', title: 'Not updated', description: errorMessage(e) })); } }}>{row.original.isActive ? 'Deactivate' : 'Activate'}</Button></div> },
    { id: 'edit', header: '', enableSorting: false, cell: ({ row }) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" onClick={() => setEditing(row.original)}>Edit</Button></div> },
  ], [dispatch, update]);

  return (
    <>
      <PageHeader title="Locations" description="Warehouses and distribution centers. Each is a stock holder, a fulfillment candidate and a receipt destination." actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New location</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Search locations" placeholder="Search code or name…" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
          <Select aria-label="Filter locations by status" className="w-40" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })}><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
          <Select aria-label="Sort locations" className="w-44" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value, page: '1' })}><option value="locationCode">Sort: code</option><option value="name">Sort: name</option><option value="available">Sort: available stock</option></Select>
        </div>
        <DataTable<any> caption="Locations" columns={columns} data={q.data?.items ?? []} loading={q.isLoading || q.isFetching} error={q.error ? errorMessage(q.error) : null} onRetry={() => q.refetch()} rowKey={(l) => l.id} onRowClick={(l) => navigate(`/locations/${l.id}`)} empty={{ title: 'No locations match', description: 'Create a warehouse to start receiving stock.', action: <Button size="sm" onClick={() => setEditing('new')}><Warehouse className="h-3.5 w-3.5" /> New location</Button> }} />
        <Pagination meta={q.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      </Card>
      <LocationFormDialog open={!!editing} onClose={() => setEditing(null)} location={editing && editing !== 'new' ? editing : undefined} />
    </>
  );
}
