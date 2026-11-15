import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { signOut } from '../../features/auth/auth-client';
import { ChangePasswordDialog } from '../auth/change-password-dialog';
import { cn } from '../../lib/utils';

/** Shows who is signed in. Actions are attributed to this user in the audit log. */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const dispatch = useAppDispatch();
  const me = useAppSelector((s) => s.auth.user);
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

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
            <span className="block truncate text-xs font-semibold">{me?.name ?? 'Signed out'}</span>
            <span className="block truncate text-[11px] capitalize text-muted-foreground">{(me?.role ?? '').toLowerCase()}</span>
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-xl border border-border bg-card p-1.5 shadow-pop">
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium">{me?.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{me?.email}</p>
          </div>
          <div className="border-t border-border pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden /> Change password
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut(dispatch);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
            >
              <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
