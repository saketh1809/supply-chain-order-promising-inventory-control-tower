import { AlertTriangle, Boxes, ClipboardList, LayoutDashboard, MapPin, Package, PanelLeftClose, PanelLeftOpen, ScrollText, Settings, Sparkles, Truck, Warehouse } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { toggleSidebar } from '../../features/ui/uiSlice';
import { useListExceptionsQuery } from '../../app/api';
import { cn } from '../../lib/utils';
import { WorkspaceSwitcher } from './workspace-switcher';
import { UserMenu } from './user-menu';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/orders', label: 'Orders', icon: ClipboardList },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/supply', label: 'Supply & Receipts', icon: Truck },
  { to: '/locations', label: 'Locations', icon: Warehouse },
  { to: '/products', label: 'Products (SKUs)', icon: Package },
  { to: '/exceptions', label: 'Exceptions Queue', icon: AlertTriangle, badge: true },
  { to: '/ai', label: 'AI Assistant', icon: Sparkles },
  { to: '/audit', label: 'Activity & Audit Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar() {
  const collapsed = useAppSelector((s) => s.ui.sidebarCollapsed);
  const dispatch = useAppDispatch();
  const { data: openExceptions } = useListExceptionsQuery({ status: 'OPEN', pageSize: 1 });
  const exceptionCount = openExceptions?.meta.total ?? 0;

  return (
    <aside className={cn('sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-64')} aria-label="Primary">
      <div className={cn('flex items-center gap-2 px-4 py-4', collapsed && 'justify-center px-2')}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
          <MapPin className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Control Tower</p>
            <p className="truncate text-[11px] text-muted-foreground">Order promising & inventory</p>
          </div>
        )}
      </div>

      <div className={cn('px-3', collapsed && 'px-2')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="Main navigation">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                collapsed && 'justify-center px-0',
                isActive && 'bg-accent text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-info" aria-hidden />}
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {'badge' in item && item.badge && exceptionCount > 0 && (
                  <span
                    className={cn(
                      'tabular ml-auto rounded-full bg-danger/10 px-1.5 text-[11px] font-semibold text-danger',
                      collapsed && 'absolute right-1 top-1 ml-0 h-4 min-w-4 px-1 text-[10px] leading-4',
                    )}
                    aria-label={`${exceptionCount} open exceptions`}
                  >
                    {exceptionCount > 99 ? '99+' : exceptionCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-border p-2">
        <UserMenu collapsed={collapsed} />
        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground', collapsed && 'justify-center px-0')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}
