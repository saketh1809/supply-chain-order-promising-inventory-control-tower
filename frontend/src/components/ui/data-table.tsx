import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EmptyState, ErrorState, TableSkeleton } from './states';

interface DataTableProps<T> {
  columns: Array<ColumnDef<T, any>>;
  data: T[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: string; action?: ReactNode };
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string | number;
  initialSort?: SortingState;
  caption?: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Minimum table width in px; the wrapper scrolls horizontally below it. */
  minWidth?: number;
}

/** Table built on TanStack Table with sortable headers, loading skeletons and empty/error states. */
export function DataTable<T>({ columns, data, loading, error, onRetry, empty, onRowClick, rowKey, initialSort = [], caption, className, rowClassName, minWidth = 640 }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className={cn('overflow-x-auto', className)}>
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading && data.length === 0 ? (
        <TableSkeleton cols={Math.min(columns.length, 6)} />
      ) : (
        <table className="w-full border-collapse text-left" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-[1] bg-muted/60 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                      {sortable ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-foreground">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={empty?.title ?? 'Nothing here yet'} description={empty?.description} action={empty?.action} />
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={String(rowKey(row.original))}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row.original) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn('border-b border-border/70 transition-colors last:border-0', onRowClick && 'cursor-pointer hover:bg-accent/60 focus-visible:bg-accent/60', rowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="table-cell-base">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
