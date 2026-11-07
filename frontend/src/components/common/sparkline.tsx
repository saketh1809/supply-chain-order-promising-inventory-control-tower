import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';

/** Minimal trend line for KPI cards. Null points are gaps (no history), never zeros. */
export function Sparkline({ values, tone = 'info', label }: { values: Array<number | null>; tone?: 'info' | 'success' | 'danger' | 'warning'; label: string }) {
  const data = values.map((v, i) => ({ i, v }));
  const hasData = values.some((v) => v !== null);
  if (!hasData) return <div className="h-10 text-[11px] text-muted-foreground">No history yet</div>;
  const color = { info: 'hsl(var(--info))', success: 'hsl(var(--success))', danger: 'hsl(var(--danger))', warning: 'hsl(var(--warning))' }[tone];
  return (
    <div className="h-10 w-full" role="img" aria-label={`${label}: 14-day trend`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <defs>
            <linearGradient id={`g-${tone}-${label.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => v.toLocaleString('en-US')} labelFormatter={() => label} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#g-${tone}-${label.replace(/\s/g, '')})`} connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
