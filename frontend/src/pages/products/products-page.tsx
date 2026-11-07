import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Package, Plus, Search, Trash2 } from 'lucide-react';
import { errorMessage, useDeleteSkuMutation, useListSkusQuery } from '../../app/api';
import { useAppDispatch } from '../../app/hooks';
import { PageHeader } from '../../components/common/page-header';
import { StockBadge } from '../../components/common/status';
import { Card } from '../../components/ui/card';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { SkuFormDialog } from '../../components/master/master-forms';
import { pushToast } from '../../features/ui/uiSlice';
import { useUrlFilters } from '../../lib/url-state';
import { fmtNum } from '../../lib/utils';
import type { SkuSummary } from '../../lib/dto';

const DEFAULTS = { search: '', sort: 'skuCode', dir: 'asc', page: '1' };

export function ProductsPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const [draft, setDraft] = useState(filters.search);
  const [form, setForm] = useState<{ sku?: SkuSummary } | null>(null);
  const [toDelete, setToDelete] = useState<SkuSummary | null>(null);
  const [removeSku, rState] = useDeleteSkuMutation();
  useEffect(() => setDraft(filters.search), [filters.search]);
  useEffect(() => {
    const t = window.setTimeout(() => draft !== filters.search && setFilters({ search: draft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [draft, filters.search, setFilters]);
  const q = useListSkusQuery({ search: filters.search || undefined, sort: filters.sort as 'skuCode', dir: filters.dir as 'asc' | 'desc', page: Number(filters.page) || 1, pageSize: 20 });

  const columns = useMemo<ColumnDef<SkuSummary, any>[]>(() => [
    { accessorKey: 'skuCode', header: 'SKU', cell: ({ getValue }) => <span className="font-semibold">{getValue<string>()}</span> },
    { accessorKey: 'name', header: 'Product' },
    { accessorKey: 'unitOfMeasure', header: 'UoM', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string | null>() ?? '—'}</span> },
    { accessorKey: 'leadTimeDays', header: 'Lead time', cell: ({ getValue }) => <span className="tabular text-xs">{getValue<number | null>() ?? '—'}{getValue<number | null>() !== null ? ' d' : ''}</span> },
    { id: 'onHand', header: 'On hand', cell: ({ row }) => <span className="tabular">{fmtNum(row.original.stock?.onHand ?? 0)}</span> },
    { id: 'atp', header: 'ATP', cell: ({ row }) => { const st = row.original.stock; const low = st && st.atp <= row.original.safetyStockQty; return <span className={`tabular font-semibold ${st && st.atp < 0 ? 'text-danger' : low ? 'text-warning' : ''}`}>{fmtNum(st?.atp ?? 0)}</span>; } },
    { id: 'health', header: 'Health', enableSorting: false, cell: ({ row }) => { const st = row.original.stock; const status = !st ? 'OUT_OF_STOCK' : st.atp < 0 ? 'SHORTAGE' : st.onHand === 0 && st.inbound > 0 ? 'INCOMING_ONLY' : st.onHand === 0 ? 'OUT_OF_STOCK' : st.atp <= row.original.safetyStockQty ? 'LOW_STOCK' : 'HEALTHY'; return <StockBadge value={status} />; } },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => setForm({ sku: row.original })}>Edit</Button>
        <Button size="icon" variant="ghost" aria-label={`Delete ${row.original.skuCode}`} onClick={() => setToDelete(row.original)}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-danger" /></Button>
      </div>
    ) },
  ], []);

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await removeSku(toDelete.id).unwrap();
      dispatch(pushToast({ tone: 'success', title: `${toDelete.skuCode} deleted` }));
      setToDelete(null);
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Cannot delete this SKU', description: errorMessage(e) }));
      setToDelete(null);
    }
  };

  return (
    <>
      <PageHeader title="Products (SKUs)" description="The catalog of stock-keeping units. A SKU is deletable only when no stock, receipt, order or allocation references it." actions={<Button onClick={() => setForm({})}><Plus className="h-4 w-4" /> New SKU</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input className="pl-9" aria-label="Search SKUs" placeholder="Search SKU code or name…" value={draft} onChange={(e) => setDraft(e.target.value)} /></div>
          <Select aria-label="Sort SKUs" className="w-56" value={`${filters.sort}:${filters.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); setFilters({ sort, dir, page: '1' }); }}>
            <option value="skuCode:asc">Sort: SKU A–Z</option>
            <option value="name:asc">Sort: product A–Z</option>
            <option value="leadTime:asc">Sort: lead time (short first)</option>
            <option value="leadTime:desc">Sort: lead time (long first)</option>
            <option value="available:asc">Sort: ATP (low first)</option>
            <option value="available:desc">Sort: ATP (high first)</option>
          </Select>
        </div>
        <DataTable<SkuSummary> caption="SKUs" columns={columns} data={q.data?.items ?? []} loading={q.isLoading || q.isFetching} error={q.error ? errorMessage(q.error) : null} onRetry={() => q.refetch()} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/products/${s.id}`)} empty={{ title: 'No SKUs match', description: 'Create a SKU before you receive stock.', action: <Button size="sm" onClick={() => setForm({})}><Package className="h-3.5 w-3.5" /> New SKU</Button> }} />
        <Pagination meta={q.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      </Card>
      <SkuFormDialog open={!!form} onClose={() => setForm(null)} sku={form?.sku} />
      <Dialog open={!!toDelete} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.skuCode}?`} description="Deletion is refused when the SKU has any history (stock movements, receipts, orders or allocations). In that case, keep the SKU for audit purposes."
        footer={<><Button variant="secondary" onClick={() => setToDelete(null)}>Keep SKU</Button><Button variant="danger" onClick={onDelete} loading={rState.isLoading}>Delete if unused</Button></>}>
        <p className="text-sm text-muted-foreground">The system checks references before deleting. Nothing is removed if any exist.</p>
      </Dialog>
    </>
  );
}
