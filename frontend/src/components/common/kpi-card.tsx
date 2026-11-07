import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card } from '../ui/card';
import { Sparkline } from './sparkline';
import { cn, fmtNum } from '../../lib/utils';
import type { ReactNode } from 'react';

interface KpiCardProps {
  label: string;
  icon: ReactNode;
  current: number | null;
  previous: number | null;
  unit: 'count' | 'units' | 'pct';
  comparisonLabel?: string;
  /** Whether an increase is good (up), bad (down) or neither (neutral). */
  goodWhen?: 'up' | 'down' | 'neutral';
  trend?: Array<number | null>;
  trendTone?: 'info' | 'success' | 'danger' | 'warning';
  href: string;
  footnote?: string;
  loading?: boolean;
}

export function KpiCard({ label, icon, current, previous, unit, comparisonLabel = 'vs 7 days ago', goodWhen = 'neutral', trend = [], trendTone = 'info', href, footnote, loading }: KpiCardProps) {
  const navigate = useNavigate();
  const delta = current !== null && previous !== null ? current - previous : null;
  const fmt = (n: number | null) => (n === null ? '—' : unit === 'pct' ? `${n.toFixed(1)}%` : fmtNum(n));
  const improving = delta === null || goodWhen === 'neutral' || delta === 0 ? null : goodWhen === 'up' ? delta > 0 : delta < 0;
  const DeltaIcon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
      <Card
        role="link"
        tabIndex={0}
        aria-label={`${label}: ${fmt(current)}. Open details`}
        onClick={() => navigate(href)}
        onKeyDown={(e) => e.key === 'Enter' && navigate(href)}
        className="group cursor-pointer p-5 transition-shadow hover:shadow-pop focus-visible:shadow-pop"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            {loading ? (
              <div className="mt-2 h-8 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <p className="tabular mt-1.5 text-3xl font-semibold tracking-tight">{fmt(current)}</p>
            )}
          </div>
          <div className="rounded-xl bg-muted p-2 text-muted-foreground transition-colors group-hover:text-foreground">{icon}</div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          {delta === null ? (
            <span className="text-muted-foreground">{footnote ?? 'No comparison available'}</span>
          ) : (
            <span className={cn('tabular inline-flex items-center gap-1 font-medium', improving === true && 'text-success', improving === false && 'text-danger', improving === null && 'text-muted-foreground')}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta > 0 ? '+' : ''}
              {unit === 'pct' ? `${delta.toFixed(1)} pts` : fmtNum(delta)}
              <span className="font-normal text-muted-foreground">{comparisonLabel}</span>
            </span>
          )}
        </div>
        {trend.length > 0 && (
          <div className="mt-2 -mx-1">
            <Sparkline values={trend} tone={trendTone} label={label} />
          </div>
        )}
      </Card>
    </motion.div>
  );
}
