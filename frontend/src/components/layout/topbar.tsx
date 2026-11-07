import { Bell, CalendarDays, Moon, Sun, Monitor } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useGlobalSearchQuery, useListExceptionsQuery } from '../../app/api';
import { setTheme, type ThemeMode } from '../../features/ui/uiSlice';
import { Breadcrumbs, type Crumb } from './breadcrumbs';
import { cn, humanize } from '../../lib/utils';
import { Search } from 'lucide-react';

const SECTION_LABEL: Array<[RegExp, string]> = [
  [/^\/orders/, 'Orders'],
  [/^\/inventory/, 'Inventory'],
  [/^\/supply/, 'Supply & Receipts'],
  [/^\/locations/, 'Locations'],
  [/^\/products/, 'Products'],
  [/^\/exceptions/, 'Exceptions Queue'],
  [/^\/ai/, 'AI Assistant'],
  [/^\/audit/, 'Activity & Audit Logs'],
  [/^\/settings/, 'Settings'],
];

export function sectionCrumbs(pathname: string): Crumb[] {
  const match = SECTION_LABEL.find(([re]) => re.test(pathname));
  const crumbs: Crumb[] = [{ label: 'Control Tower', to: '/' }];
  if (match) crumbs.push({ label: match[1] });
  else crumbs.push({ label: 'Overview' });
  return crumbs;
}

export function Topbar() {
  const { pathname } = useLocation();
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
      <div className="hidden min-w-0 md:block">
        <Breadcrumbs items={sectionCrumbs(pathname)} />
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 md:gap-2">
        <GlobalSearch />
        <NotificationBell />
        <DateChip />
        <ThemeSwitcher />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const term = q.trim();
  const { data, isFetching } = useGlobalSearchQuery(term, { skip: term.length < 2 });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const groups = data
    ? [
        { title: 'Orders', items: data.orders },
        { title: 'SKUs', items: data.skus },
        { title: 'Receipts', items: data.receipts },
        { title: 'Locations', items: data.locations },
      ].filter((g) => g.items.length > 0)
    : [];

  return (
    <div ref={ref} className="relative w-44 sm:w-64 lg:w-80">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="global-search"
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search orders, SKUs, receipts…"
        aria-label="Global search"
        className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-12 text-sm placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground sm:block">⌘K</kbd>
      {open && term.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-96 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-pop" role="listbox" aria-label="Search results">
          {isFetching && <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>}
          {!isFetching && groups.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No matches for “{term}”.</p>}
          {groups.map((g) => (
            <div key={g.title} className="py-1">
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.title}</p>
              {g.items.map((it) => (
                <button
                  key={`${g.title}-${it.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setOpen(false);
                    setQ('');
                    navigate(it.href);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="truncate font-medium">{it.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{it.sublabel}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useListExceptionsQuery({ status: 'OPEN', pageSize: 5, sort: 'risk' });
  const count = data?.meta.total ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications: ${count} open exceptions`}
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-background" aria-hidden />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-border bg-card p-2 shadow-pop">
          <p className="px-2 pb-1 pt-1 text-xs font-semibold">Open exceptions</p>
          {(data?.items ?? []).length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No open exceptions. Nice work.</p>}
          {(data?.items ?? []).map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(`/exceptions?open=${e.id}`);
              }}
              className="flex w-full flex-col items-start rounded-lg px-2 py-2 text-left hover:bg-accent"
            >
              <span className="text-xs font-medium">{e.order.orderNumber} · {humanize(e.type)}</span>
              <span className="text-[11px] text-muted-foreground">{e.severity} · {e.affectedQty} units · {e.sku.skuCode}</span>
            </button>
          ))}
          <button type="button" onClick={() => { setOpen(false); navigate('/exceptions'); }} className="mt-1 w-full rounded-lg px-2 py-2 text-center text-xs font-medium text-info hover:bg-accent">
            View all exceptions
          </button>
        </div>
      )}
    </div>
  );
}

function DateChip() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground xl:inline-flex" title="Planning date (UTC)">
      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular">{today}</span>
    </span>
  );
}

const THEMES: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeSwitcher() {
  const theme = useAppSelector((s) => s.ui.theme);
  const dispatch = useAppDispatch();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex items-center rounded-lg border border-border bg-card p-0.5">
      {THEMES.map((t) => (
        <button
          key={t.value}
          role="radio"
          aria-checked={theme === t.value}
          aria-label={`${t.label} theme`}
          title={`${t.label} theme`}
          onClick={() => dispatch(setTheme(t.value))}
          className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground', theme === t.value && 'bg-accent text-foreground')}
        >
          <t.icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
