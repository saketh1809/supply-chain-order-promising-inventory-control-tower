import { ArrowDownRight, ArrowUpRight, Minus, Package, PackageCheck, Truck, AlertTriangle, XCircle, CalendarClock, FileText, Warehouse, Layers, Ban, ShieldCheck, Clock } from 'lucide-react';
import type { TimelineEvent } from '../../lib/dto';
import { fmtDateTime, fmtNum, humanize, cn } from '../../lib/utils';

const ICON: Record<string, { icon: typeof Package; tone: string }> = {
  ORDER_CREATED: { icon: FileText, tone: 'text-muted-foreground bg-muted' },
  ORDER_CONFIRMED: { icon: ShieldCheck, tone: 'text-info bg-info/10' },
  CUSTOMER_DEMAND: { icon: Package, tone: 'text-foreground bg-muted' },
  OPENING_INVENTORY: { icon: Warehouse, tone: 'text-muted-foreground bg-muted' },
  RECEIPT_EXPECTED: { icon: Truck, tone: 'text-info bg-info/10' },
  RECEIPT_DELAYED: { icon: CalendarClock, tone: 'text-warning bg-warning/10' },
  RECEIPT_EXPEDITED: { icon: Clock, tone: 'text-success bg-success/10' },
  RECEIPT_RECEIVED: { icon: PackageCheck, tone: 'text-success bg-success/10' },
  RECEIPT_CANCELED: { icon: XCircle, tone: 'text-danger bg-danger/10' },
  INVENTORY_ALLOCATED: { icon: Layers, tone: 'text-success bg-success/10' },
  PARTIAL_ALLOCATION: { icon: AlertTriangle, tone: 'text-warning bg-warning/10' },
  ALLOCATION_RELEASED: { icon: Layers, tone: 'text-muted-foreground bg-muted' },
  SHIPMENT: { icon: PackageCheck, tone: 'text-success bg-success/10' },
  PARTIAL_SHIPMENT: { icon: Truck, tone: 'text-info bg-info/10' },
  EXCEPTION_RAISED: { icon: AlertTriangle, tone: 'text-danger bg-danger/10' },
  PROMISE_OVERRIDE: { icon: ShieldCheck, tone: 'text-warning bg-warning/10' },
  ORDER_CANCELED: { icon: Ban, tone: 'text-muted-foreground bg-muted' },
};

/** Chronological supply-demand timeline with a plain-language ATP impact on every event. */
export function OrderTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No events match these filters.</p>;
  return (
    <ol className="relative space-y-1">
      <span className="absolute bottom-2 left-[17px] top-2 w-px bg-border" aria-hidden />
      {events.map((e, i) => {
        const meta = ICON[e.type] ?? { icon: Minus, tone: 'text-muted-foreground bg-muted' };
        const Icon = meta.icon;
        return (
          <li key={`${e.at}-${i}`} className="relative flex gap-3 rounded-lg py-2 pl-0 pr-2 hover:bg-accent/40">
            <span className={cn('relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-card', meta.tone)}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <p className="text-sm font-medium">{e.label}</p>
                <AtpImpact value={e.atpImpact} />
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="tabular">{fmtDateTime(e.at)}</span>
                {e.sku && <span>SKU {e.sku}</span>}
                {e.location && <span>@ {e.location}</span>}
                {e.quantity !== null && <span className="tabular">{fmtNum(e.quantity)} units</span>}
                {e.reference && <span className="font-mono text-[11px]">{e.reference}</span>}
                <span className="uppercase tracking-wide text-[10px] opacity-70">{humanize(e.source)}</span>
              </p>
              {e.note && <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AtpImpact({ value }: { value: number | null }) {
  if (value === null) return null;
  if (value === 0) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="No change to ATP"><Minus className="h-3 w-3" />ATP 0</span>;
  }
  const up = value > 0;
  return (
    <span className={cn('tabular inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold', up ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')} title={up ? 'Increases ATP' : 'Reduces ATP'}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      ATP {up ? '+' : ''}{value}
    </span>
  );
}
