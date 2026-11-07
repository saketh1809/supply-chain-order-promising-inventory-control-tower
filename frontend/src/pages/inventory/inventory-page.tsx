import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Boxes, Plus, Search } from 'lucide-react';
import { errorMessage, useListInventoryQuery, useListLocationsQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { StockBadge } from '../../components/common/status';
import { Card } from '../../components/ui/card';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { AdjustmentDialog } from '../../components/inventory/adjustment-dialog';
import { useUrlFilters } from '../../lib/url-state';
import { fmtDate, fmtNum, humanize } from '../../lib/utils';
import type { InventoryRow } from '../../lib/dto';

const DEFAULTS = { search: '', locationId: '', status: '', sort: 'skuCode', dir: 'asc', page: '1' };

export function InventoryPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const [draft, setDraft] = useState(filters.search);
  const [adjustOpen, setAdjustOpen] = useState(false);
  useEffect(() => setDraft(filters.search), [filters.search, setDraft]);
  useEffect(() => {
    const t = window.setTimeout(() => draft !== filters.search && setFilters({ search: draft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [draft, filters.search, setFilters]);

  const query = useMemo(
    () => ({
      search: filters.search || undefined,
      locationId: filters.locationId ? Number(filters.locationId) : undefined,
      status: filters.status || undefined,
      sort: filters.sort,
      dir: filters.dir,
      page: Number(filters.page) || 1,
      pageSize: 25,
    }),
    [filters],
  );
  const inv = useListInventoryQuery(query);
  const locations = useListLocationsQuery({ pageSize: 200 });
  const summary = inv.data?.summary;

  const columns = useMemo<ColumnDef<InventoryRow, any>[]>(
    () => [
      { accessorKey: 'skuCode', header: 'SKU', cell: ({ row }) => <div><p className="font-medium">{row.original.skuCode}</p><p className="max-w-[180px] truncate text-xs text-muted-foreground">{row.original.productName}</p></div> },
      { accessorKey: 'locationCode', header: 'Location', cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: 'onHand', header: 'On hand', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
      { accessorKey: 'allocated', header: 'Allocated', cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
      { accessorKey: 'available', header: 'Available', cell: ({ getValue }) => <span className={`tabular ${getValue<number>() < 0 ? 'text-danger' : ''}`}>{fmtNum(getValue<number>())}</span> },
      { accessorKey: 'incoming', header: 'Incoming', cell: ({ row }) => <span className="tabular">{fmtNum(row.original.incoming)}{row.original.nextArrival && <span className="block text-[11px] text-muted-foreground">next {fmtDate(row.original.nextArrival)}</span>}</span> },
      { accessorKey: 'atp', header: 'ATP', cell: ({ getValue }) => <span className={`tabular font-semibold ${getValue<number>() < 0 ? 'text-danger' : ''}`}>{fmtNum(getValue<number>())}</span> },
      { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StockBadge value={getValue<string>()} /> },
      { accessorKey: 'lastUpdated', header: 'Last updated', cell: ({ getValue }) => <span className="tabular text-xs text-muted-foreground">{fmtDate(getValue<string>().slice(0, 10))}</span> },
      {
        id: 'view',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Link to={`/inventory/${row.original.balanceId}`} className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-accent">Details</Link>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="On-hand stock per SKU and warehouse, with what is allocated, what is incoming, and the resulting available-to-promise (ATP)."
        actions={<Button onClick={() => setAdjustOpen(true)}><Plus className="h-4 w-4" /> Adjust inventory</Button>}
      />

      <section aria-label="Inventory totals" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['On hand', summary?.onHand],
          ['Allocated', summary?.allocated],
          ['Available', summary?.available],
          ['Incoming', summary?.incoming],
          ['Low or short rows', summary?.lowOrShort],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="tabular mt-1 text-xl font-semibold">{inv.isLoading ? '…' : fmtNum(value as number | undefined)}</p>
          </div>
        ))}
      </section>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder="Search SKU or product…" aria-label="Search inventory" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <Select aria-label="Filter by location" className="w-52" value={filters.locationId} onChange={(e) => setFilters({ locationId: e.target.value, page: '1' })}>
            <option value="">All locations</option>
            {locations.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}
          </Select>
          <Select aria-label="Filter by stock status" className="w-48" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })}>
            <option value="">Any stock status</option>
            {['HEALTHY', 'LOW_STOCK', 'SHORTAGE', 'INCOMING_ONLY', 'OUT_OF_STOCK'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select aria-label="Sort inventory" className="w-56" value={`${filters.sort}:${filters.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); setFilters({ sort, dir, page: '1' }); }}>
            <option value="skuCode:asc">Sort: SKU A–Z</option>
            <option value="onHand:desc">Sort: On hand (high → low)</option>
            <option value="onHand:asc">Sort: On hand (low → high)</option>
            <option value="available:asc">Sort: Available (low → high)</option>
            <option value="atp:asc">Sort: ATP (low → high)</option>
          </Select>
        </div>
        <DataTable<InventoryRow>
          caption="Inventory by SKU and location"
          columns={columns}
          data={inv.data?.items ?? []}
          loading={inv.isLoading || inv.isFetching}
          error={inv.error ? errorMessage(inv.error) : null}
          onRetry={() => inv.refetch()}
          rowKey={(r) => r.balanceId}
          onRowClick={(r) => navigate(`/inventory/${r.balanceId}`)}
          empty={{
            title: 'No inventory records match',
            description: 'Adjust inventory to record a stock count, or receive an inbound receipt.',
            action: <Button size="sm" onClick={() => setAdjustOpen(true)}><Boxes className="h-3.5 w-3.5" /> Adjust inventory</Button>,
          }}
        />
        <Pagination meta={inv.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      </Card>

      <AdjustmentDialog open={adjustOpen} onClose={() => setAdjustOpen(false)} />
    </>
  );
}
