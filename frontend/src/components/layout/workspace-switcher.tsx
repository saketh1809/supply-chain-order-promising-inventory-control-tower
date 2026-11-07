import { Building2, ChevronsUpDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetSettingsQuery } from '../../app/api';
import { cn } from '../../lib/utils';

/** Workspace (company) selector. Shows the active workspace; editing its details lives in Settings. */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { data } = useGetSettingsQuery();
  return (
    <Link
      to="/settings"
      className={cn('flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left hover:bg-accent', collapsed && 'justify-center px-0')}
      aria-label={`Workspace: ${data?.companyName ?? 'loading'}. Open settings`}
    >
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{data?.companyName ?? 'Loading…'}</span>
            <span className="block truncate text-[11px] text-muted-foreground">Workspace · {data?.timezone ?? 'UTC'}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </>
      )}
    </Link>
  );
}
