import { cn } from '../../lib/utils';

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; count?: number }> }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-border bg-muted p-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === it.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
