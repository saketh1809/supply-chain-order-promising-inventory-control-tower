import { useEffect, useMemo, useState } from 'react';
import { Download, ScrollText } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { errorMessage, useGetUsersQuery, useListAuditQuery } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { Card } from '../../components/ui/card';
import { DataTable } from '../../components/ui/data-table';
import { Input, Select } from '../../components/ui/input';
import { Pagination } from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { useUrlFilters } from '../../lib/url-state';
import { fmtDateTime, humanize } from '../../lib/utils';

const DEFAULTS = { userId: '', entityType: '', action: '', from: '', to: '', page: '1' };
const ENTITY_TYPES = ['Order', 'OrderLine', 'Sku', 'Location', 'InventoryAdjustment', 'InboundReceipt', 'Exception', 'Shipment', 'AIInteraction', 'Customer', 'Settings'];

interface AuditRow {
  id: string;
  eventId: string;
  user: { id: number; name: string; role: string } | null;
  entityType: string;
  entityId: string;
  action: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  timestamp: string;
}

export function AuditPage() {
  const [filters, setFilters] = useUrlFilters(DEFAULTS);
  const [actionDraft, setActionDraft] = useState(filters.action);
  useEffect(() => setActionDraft(filters.action), [filters.action]);
  useEffect(() => {
    const t = window.setTimeout(() => actionDraft !== filters.action && setFilters({ action: actionDraft, page: '1' }, true), 300);
    return () => window.clearTimeout(t);
  }, [actionDraft, filters.action, setFilters]);
  const q = useListAuditQuery({
    userId: filters.userId ? Number(filters.userId) : undefined,
    entityType: filters.entityType || undefined,
    action: filters.action || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    page: Number(filters.page) || 1,
    pageSize: 25,
  });
  const users = useGetUsersQuery();

  const columns = useMemo<ColumnDef<AuditRow, any>[]>(() => [
    { accessorKey: 'timestamp', header: 'Timestamp', cell: ({ getValue }) => <span className="tabular whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(getValue<string>())}</span> },
    { accessorKey: 'user', header: 'User', cell: ({ getValue }) => { const u = getValue<AuditRow['user']>(); return <span className="text-sm">{u ? u.name : 'System'}{u && <span className="block text-[11px] capitalize text-muted-foreground">{u.role.toLowerCase()}</span>}</span>; } },
    { accessorKey: 'entityType', header: 'Entity', cell: ({ row }) => <span className="text-xs"><span className="font-medium">{row.original.entityType}</span> <span className="font-mono text-muted-foreground">#{row.original.entityId}</span></span> },
    { accessorKey: 'action', header: 'Action', cell: ({ getValue }) => <span className="text-xs font-medium">{humanize(getValue<string>())}</span> },
    { id: 'change', header: 'Previous → new', enableSorting: false, cell: ({ row }) => <span className="block max-w-[360px] truncate font-mono text-[11px] text-muted-foreground" title={JSON.stringify({ previous: row.original.previousValue, next: row.original.newValue })}>{summarize(row.original.previousValue, row.original.newValue)}</span> },
    { accessorKey: 'reason', header: 'Reason', cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-xs" title={getValue<string | null>() ?? ''}>{getValue<string | null>() ?? '—'}</span> },
  ], []);

  const exportCsv = () => {
    const rows = q.data?.items ?? [];
    const header = ['timestamp', 'user', 'entityType', 'entityId', 'action', 'reason', 'previous', 'new'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header.join(','), ...rows.map((r: AuditRow) => [r.timestamp, r.user?.name ?? 'System', r.entityType, r.entityId, r.action, r.reason, JSON.stringify(r.previousValue), JSON.stringify(r.newValue)].map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-page.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Activity & audit logs" description="An immutable record of every inventory adjustment, receipt, order change, allocation change, planner action, promise override and AI decision. Records cannot be edited or deleted." actions={<Button variant="secondary" onClick={exportCsv} disabled={!q.data?.items.length}><Download className="h-4 w-4" /> Export page (CSV)</Button>} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Select aria-label="Filter by user" className="w-48" value={filters.userId} onChange={(e) => setFilters({ userId: e.target.value, page: '1' })}><option value="">All users</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Select aria-label="Filter by entity type" className="w-48" value={filters.entityType} onChange={(e) => setFilters({ entityType: e.target.value, page: '1' })}><option value="">All entity types</option>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          <Input aria-label="Filter by action" className="w-56" placeholder="Action contains… e.g. RECEIPT" value={actionDraft} onChange={(e) => setActionDraft(e.target.value)} />
          <Input aria-label="From date" type="date" className="w-40" value={filters.from} onChange={(e) => setFilters({ from: e.target.value, page: '1' })} />
          <Input aria-label="To date" type="date" className="w-40" value={filters.to} onChange={(e) => setFilters({ to: e.target.value, page: '1' })} />
        </div>
        <DataTable<AuditRow> caption="Audit records" columns={columns} data={(q.data?.items ?? []) as AuditRow[]} loading={q.isLoading || q.isFetching} error={q.error ? errorMessage(q.error) : null} onRetry={() => q.refetch()} rowKey={(r) => r.id} empty={{ title: 'No audit records match', description: 'Try widening the date range or clearing a filter.', action: <ScrollText className="h-5 w-5 text-muted-foreground" /> }} />
        <Pagination meta={q.data?.meta} onPage={(p) => setFilters({ page: String(p) })} />
      </Card>
    </>
  );
}

function summarize(prev: unknown, next: unknown): string {
  if (!prev && !next) return '—';
  const p = (prev ?? {}) as Record<string, unknown>;
  const n = (next ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(p), ...Object.keys(n)])].filter((k) => JSON.stringify(p[k]) !== JSON.stringify(n[k])).slice(0, 3);
  if (keys.length === 0) return JSON.stringify(next ?? prev).slice(0, 120);
  return keys.map((k) => `${k}: ${short(p[k])} → ${short(n[k])}`).join(' · ');
}
const short = (v: unknown) => (v === undefined || v === null ? '∅' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v));
