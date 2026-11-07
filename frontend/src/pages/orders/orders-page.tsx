import { ClipboardList, Filter, Plus, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useConfirmOrderMutation, useListLocationsQuery, useListOrdersQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { AllocationBadge, OrderStatusBadge, PriorityBadge, RiskBadge } from '../../components/common/status';
import { Card } from '../../components/ui/card';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { pushToast } from '../../features/ui/uiSlice';
import { useUrlFilters } from '../../lib/url-state';
import { fmtDate, fmtNum, humanize } from '../../lib/utils';
import type { OrderListItem } from '../../lib/dto';

const DEFAULTS = { search: '', status: '', priority: '', exceptionType: '', requestedFrom: '', requestedTo: '', promisedFrom: '', promisedTo: '', locationId: '', sort: 'risk', page: '1' };

const SORTS = [
  { value: 'risk', label: 'Highest risk' },
  { value: 'promised', label: 'Earliest promised date' },
  { value: 'oldest', label: 'Oldest order' },
  { value: 'priority', label: 'Highest priority' },
  { value: 'backorder', label: 'Largest backorder' },
  { value: 'requested', label: 'Requested date' },
] as const;

export function OrdersPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => setSearchDraft(filters.search), [filters.search]);
  // Debounce free-text search so each keystroke does not hit the server.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchDraft !== filters.search) setFilters({ search: searchDraft, page: '1' }, true);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft, filters.search, setFilters]);

  const query = useMemo(
    () => ({
      search: filters.search || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      exceptionType: filters.exceptionType || undefined,
      requestedFrom: filters.requestedFrom || undefined,
      requestedTo: filters.requestedTo || undefined,
      promisedFrom: filters.promisedFrom || undefined,
      promisedTo: filters.promisedTo || undefined,
      locationId: filters.locationId ? Number(filters.locationId) : undefined,
      sort: filters.sort,
      page: Number(filters.page) || 1,
      pageSize: 20,
    }),
    [filters],
  );
  const orders = useListOrdersQuery(query);
  const locations = useListLocationsQuery({ pageSize: 200 });
  const exceptionTypes = ['PROMISE_DATE_AT_RISK', 'BACKORDER', 'DELAYED_INBOUND', 'CANCELED_INBOUND_DEPENDENCY', 'HIGH_PRIORITY_INSUFFICIENT_STOCK'];
  const [confirmOrder] = useConfirmOrderMutation();
  const activeFilters = Object.entries(filters).filter(([k, v]) => v && k !== 'page' && k !== 'sort' && (DEFAULTS as Record<string, string>)[k] !== v).length;

  const columns = useMemo<ColumnDef<OrderListItem, any>[]>(
    () => [
      { accessorKey: 'orderNumber', header: 'Order', cell: ({ row }) => <span className="font-medium text-foreground">{row.original.orderNumber}</span> },
      { accessorKey: 'customer', header: 'Customer', cell: ({ getValue }) => <span className="block max-w-[180px] truncate">{getValue<string>()}</span> },
      { accessorKey: 'priority', header: 'Priority', cell: ({ getValue }) => <PriorityBadge value={getValue<string>()} /> },
      { accessorKey: 'createdAt', header: 'Created', cell: ({ getValue }) => <span className="tabular text-xs text-muted-foreground">{fmtDate(getValue<string>().slice(0, 10))}</span> },
      { accessorKey: 'requestedShipDate', header: 'Requested', cell: ({ getValue }) => <span className="tabular text-xs">{fmtDate(getValue<string | null>())}</span> },
      {
        accessorKey: 'promisedShipDate',
        header: 'Promised',
        cell: ({ row }) => (
          <span className={`tabular text-xs ${row.original.isLate ? 'font-semibold text-danger' : ''}`} title={row.original.isLate ? 'Promise is after the requested ship date' : undefined}>
            {fmtDate(row.original.promisedShipDate)}
          </span>
        ),
      },
      { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <OrderStatusBadge value={getValue<string>()} /> },
      { accessorKey: 'allocationStatus', header: 'Allocation', cell: ({ getValue }) => <AllocationBadge value={getValue<string>()} /> },
      { accessorKey: 'riskLevel', header: 'Risk', cell: ({ getValue }) => <RiskBadge value={getValue<string>()} /> },
      {
        accessorKey: 'backorderedQty',
        header: 'Backordered',
        cell: ({ getValue }) => <span className={`tabular text-xs ${getValue<number>() > 0 ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>{fmtNum(getValue<number>())}</span>,
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {row.original.status === 'DRAFT' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await confirmOrder({ id: row.original.id }).unwrap();
                    dispatch(pushToast({ tone: 'success', title: `${row.original.orderNumber} confirmed`, description: 'Demand is reserved and allocations were recalculated.' }));
                  } catch (e) {
                    dispatch(pushToast({ tone: 'error', title: 'Could not confirm order', description: errorMessage(e) }));
                  }
                }}
              >
                Confirm
              </Button>
            )}
            <Link to={`/orders/${row.original.id}`} className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-accent">
              Open
            </Link>
          </div>
        ),
      },
    ],
    [confirmOrder, dispatch],
  );

  const meta = orders.data?.meta;
  const errMsg = orders.error ? errorMessage(orders.error, 'Orders could not be loaded.') : null;

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every customer order with its promised ship date, allocation and risk. Filters and sorting run on the server so large order books stay fast."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              <Filter className="h-4 w-4" /> Filters{activeFilters > 0 && <span className="rounded-full bg-info px-1.5 text-[11px] text-white">{activeFilters}</span>}
            </Button>
            <Button onClick={() => navigate('/orders/new')}>
              <Plus className="h-4 w-4" /> New order
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search order number or customer…" aria-label="Search orders" className="pl-9" />
          </div>
          <Select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: '1' })} className="w-40">
            <option value="">All statuses</option>
            {['DRAFT', 'CONFIRMED', 'FULFILLING', 'SHIPPED', 'CANCELED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select aria-label="Priority" value={filters.priority} onChange={(e) => setFilters({ priority: e.target.value, page: '1' })} className="w-36">
            <option value="">All priorities</option>
            <option value="HIGH">High</option>
            <option value="MED">Medium</option>
            <option value="LOW">Low</option>
          </Select>
          <Select aria-label="Sort orders" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value, page: '1' })} className="w-52">
            {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
          </Select>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchDraft(''); setFilters({ ...DEFAULTS }); }}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>
        {showFilters && (
          <div className="grid grid-cols-1 gap-3 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-muted-foreground">Exception type
              <Select aria-label="Exception type" className="mt-1" value={filters.exceptionType} onChange={(e) => setFilters({ exceptionType: e.target.value, page: '1' })}>
                <option value="">Any</option>
                {exceptionTypes.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </Select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Fulfillment location
              <Select aria-label="Fulfillment location" className="mt-1" value={filters.locationId} onChange={(e) => setFilters({ locationId: e.target.value, page: '1' })}>
                <option value="">Any</option>
                {locations.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}
              </Select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Requested ship date
              <div className="mt-1 flex gap-2">
                <Input type="date" aria-label="Requested from" value={filters.requestedFrom} onChange={(e) => setFilters({ requestedFrom: e.target.value, page: '1' })} />
                <Input type="date" aria-label="Requested to" value={filters.requestedTo} onChange={(e) => setFilters({ requestedTo: e.target.value, page: '1' })} />
              </div>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Promised ship date
              <div className="mt-1 flex gap-2">
                <Input type="date" aria-label="Promised from" value={filters.promisedFrom} onChange={(e) => setFilters({ promisedFrom: e.target.value, page: '1' })} />
                <Input type="date" aria-label="Promised to" value={filters.promisedTo} onChange={(e) => setFilters({ promisedTo: e.target.value, page: '1' })} />
              </div>
            </label>
          </div>
        )}
      </Card>

      <Card>
        <DataTable<OrderListItem>
          caption="Orders"
          columns={columns}
          data={orders.data?.items ?? []}
          loading={orders.isLoading || orders.isFetching}
          error={errMsg}
          onRetry={() => orders.refetch()}
          rowKey={(o) => o.id}
          onRowClick={(o) => navigate(`/orders/${o.id}`)}
          rowClassName={(o) => (o.riskLevel === 'CRITICAL' ? 'bg-danger/[0.03]' : undefined)}
          empty={{
            title: activeFilters > 0 ? 'No orders match these filters' : 'No orders yet',
            description: activeFilters > 0 ? 'Try clearing a filter.' : 'Create the first order to see promising and allocation in action.',
            action: activeFilters > 0 ? <Button variant="secondary" size="sm" onClick={() => setFilters({ ...DEFAULTS, search: '' })}>Clear filters</Button> : <Link to="/orders/new"><Button size="sm">New order</Button></Link>,
          }}
        />
        <Pagination meta={meta} onPage={(p) => setFilters({ page: String(p) })} />
      </Card>

      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <ClipboardList className="h-3.5 w-3.5" aria-hidden />
        Default order is risk-first: critical orders, then backorders, then priority. Use the sort control to change it.
      </p>
    </>
  );
}
