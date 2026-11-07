import { LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useGetUsersQuery } from '../../app/api';
import { setActingUser, pushToast } from '../../features/ui/uiSlice';
import { cn } from '../../lib/utils';

/** Acting-user switcher. The selection is sent as x-user-id, so every audit record names the person. */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const dispatch = useAppDispatch();
  const actingId = useAppSelector((s) => s.ui.actingUserId);
  const { data: users = [] } = useGetUsersQuery();
  const [open, setOpen] = useState(false);
  const me = users.find((u) => u.id === actingId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-accent', collapsed && 'justify-center px-0')}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {(me?.name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-semibold">{me?.name ?? 'Select user'}</span>
            <span className="block truncate text-[11px] capitalize text-muted-foreground">{(me?.role ?? '').toLowerCase()}</span>
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-xl border border-border bg-card p-1.5 shadow-pop">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Acting as</p>
          {users.map((u) => (
            <button
              key={u.id}
              role="menuitemradio"
              aria-checked={u.id === actingId}
              type="button"
              onClick={() => {
                dispatch(setActingUser(u.id));
                dispatch(pushToast({ tone: 'info', title: `Acting as ${u.name}`, description: 'Actions are now attributed to this user in the audit log.' }));
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
            >
              <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{u.name}</span>
                <span className="block truncate text-[11px] capitalize text-muted-foreground">{u.role.toLowerCase()}</span>
              </span>
              {u.id === actingId && <span className="text-[11px] text-success">Active</span>}
            </button>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <p className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <LogOut className="h-3 w-3" aria-hidden /> Demo identity (no sign-in in this build)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
