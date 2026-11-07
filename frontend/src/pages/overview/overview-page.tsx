import { AlertTriangle, Boxes, ClipboardList, PackageX, Truck, Percent, Activity } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart, Pie, PieChart } from 'recharts';
import { Link } from 'react-router-dom';
import { useDashboardSummaryQuery, useInventoryHealthQuery, errorMessage } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { KpiCard } from '../../components/common/kpi-card';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { RiskBadge, SeverityBadge, PriorityBadge, ReceiptBadge } from '../../components/common/status';
import { fmtDate, fmtDateTime, fmtNum, fmtPct, humanize, fmtShortDate } from '../../lib/utils';
import { useState } from 'react';
import { motion } from 'framer-motion';

const CHART = { grid: 'hsl(var(--border))', axis: 'hsl(var(--muted-foreground))', on: 'hsl(158 64% 40%)', late: 'hsl(355 72% 55%)', available: 'hsl(158 64% 40%)', allocated: 'hsl(217 85% 55%)', backorder: 'hsl(355 72% 55%)' };

export function OverviewPage() {
  const [days] = useState(14);
  const summary = useDashboardSummaryQuery(days);
  const health = useInventoryHealthQuery();
  const d = summary.data;
  const err = summary.error ? errorMessage(summary.error) : null;

  return (
    <>
      <PageHeader
        title="Control tower"
        description={d ? `Live view of orders, inventory and supply as of ${fmtDate(d.asOf)}. Every figure is computed from database records.` : 'Loading live supply chain metrics…'}
        actions={
          <>
            <Link to="/orders/new">
              <Button size="md">New order</Button>
            </Link>
            <Button variant="secondary" onClick={() => summary.refetch()} loading={summary.isFetching}>
              Refresh
            </Button>
          </>
        }
      />

      {err && <ErrorState message={err} onRetry={() => summary.refetch()} />}

      {!err && (
        <>
          <section aria-label="Key performance indicators" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard label="Total active orders" icon={<ClipboardList className="h-4 w-4" />} loading={!d} current={d?.kpis.activeOrders.current ?? null} previous={d?.kpis.activeOrders.previous ?? null} unit="count" trend={d?.kpis.activeOrders.trend ?? []} href="/orders?status=CONFIRMED" trendTone="info" />
            <KpiCard label="Orders at risk" icon={<AlertTriangle className="h-4 w-4" />} loading={!d} current={d?.kpis.ordersAtRisk.current ?? null} previous={null} unit="count" goodWhen="down" href="/exceptions" trendTone="danger" footnote="Open exceptions, not yet historical" />
            <KpiCard label="Available inventory" icon={<Boxes className="h-4 w-4" />} loading={!d} current={d?.kpis.availableInventory.current ?? null} previous={null} unit="units" goodWhen="up" href="/inventory" trend={d?.kpis.availableInventory.trend ?? []} trendTone="success" footnote={`On-hand ${fmtNum(d?.kpis.availableInventory.onHandCurrent ?? null)} minus allocated`} />
            <KpiCard label="Backordered units" icon={<PackageX className="h-4 w-4" />} loading={!d} current={d?.kpis.backorderedUnits.current ?? null} previous={null} unit="units" goodWhen="down" href="/exceptions?type=BACKORDER" trendTone="danger" footnote="Units with no committed supply" />
            <KpiCard label="Incoming receipts" icon={<Truck className="h-4 w-4" />} loading={!d} current={d?.kpis.incomingReceipts.current ?? null} previous={d?.kpis.incomingReceipts.previous ?? null} unit="count" goodWhen="up" href="/supply?tab=receipts" trend={d?.kpis.incomingReceipts.trend ?? []} trendTone="info" footnote={d ? `${fmtNum(d.kpis.incomingReceipts.units ?? 0)} units expected` : undefined} />
            <KpiCard label="On-time promise rate" icon={<Percent className="h-4 w-4" />} loading={!d} current={d?.kpis.onTimePromiseRate.current ?? null} previous={d?.kpis.onTimePromiseRate.previous ?? null} unit="pct" goodWhen="up" comparisonLabel="vs prior 30 days" href="/orders?sort=promised" trend={d?.kpis.onTimePromiseRate.trend ?? []} trendTone="success" footnote={d?.kpis.onTimePromiseRate.promiseCompliance !== null && d?.kpis.onTimePromiseRate.promiseCompliance !== undefined ? `${d.kpis.onTimePromiseRate.promiseCompliance.toFixed(0)}% of active orders promised on time` : undefined} />
          </section>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="A · Order fulfillment" description="Units shipped on time versus late, last 14 days, and orders by status" />
              <CardBody className="space-y-6">
                {!d ? <Skeleton className="h-56 w-full" /> : (
                  <>
                    <div className="h-56" role="img" aria-label="Units shipped on time and late over 14 days">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={d.sections.orderFulfillment.series.map((p) => ({ ...p, label: fmtShortDate(p.date) }))} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} interval={1} />
                          <YAxis tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                          <Area type="monotone" dataKey="onTime" name="On time (units)" stroke={CHART.on} fill={CHART.on} fillOpacity={0.12} strokeWidth={2} />
                          <Area type="monotone" dataKey="late" name="Late (units)" stroke={CHART.late} fill={CHART.late} fillOpacity={0.12} strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
                      <div className="h-44" role="img" aria-label="Orders by status">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={d.sections.orderFulfillment.statusCounts.filter((s) => s.count > 0)} dataKey="count" nameKey="status" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
                              {d.sections.orderFulfillment.statusCounts.filter((s) => s.count > 0).map((s) => (
                                <Cell key={s.status} fill={STATUS_COLOR[s.status]} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} formatter={(v: number, n: string) => [v, humanize(n)]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="space-y-2 text-sm">
                        {d.sections.orderFulfillment.statusCounts.map((s) => (
                          <li key={s.status} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />{humanize(s.status)}</span>
                            <span className="tabular font-medium">{fmtNum(s.count)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Shipped on time, last 30 days: <span className="tabular font-medium text-foreground">{fmtPct(d.sections.orderFulfillment.onTimeLast30.rate === null ? null : d.sections.orderFulfillment.onTimeLast30.rate * 100)}</span> across {fmtNum(d.sections.orderFulfillment.onTimeLast30.total)} units
                    </p>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="B · Inventory health" description="Stock by location and SKUs that are running low" actions={<Link to="/inventory" className="text-xs font-medium text-info hover:underline">Open inventory</Link>} />
              <CardBody className="space-y-5">
                {!health.data ? <Skeleton className="h-56 w-full" /> : health.data.byLocation.length === 0 ? (
                  <EmptyState title="No stock recorded" description="Add an inventory adjustment or receive a receipt to see warehouse health." />
                ) : (
                  <div className="h-56" role="img" aria-label="Available, allocated and incoming units by location">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={health.data.byLocation} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                        <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="locationCode" tick={{ fontSize: 12, fill: CHART.axis }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="available" name="Available" stackId="a" fill={CHART.available} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="allocated" name="Allocated" stackId="a" fill={CHART.allocated} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="incoming" name="Incoming" fill="hsl(38 92% 55%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Low-stock SKUs</p>
                  {!health.data ? <Skeleton className="h-20 w-full" /> : health.data.lowStock.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Every SKU is above its safety stock.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {health.data.lowStock.slice(0, 6).map((s: { skuId: number; skuCode: string; productName: string; atp: number; safetyStock: number; status: string }) => (
                        <li key={s.skuId}>
                          <Link to={`/products/${s.skuId}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-accent/60">
                            <span className="min-w-0"><span className="block truncate font-medium">{s.skuCode}</span><span className="block truncate text-xs text-muted-foreground">{s.productName}</span></span>
                            <span className="tabular text-right text-xs"><span className={s.atp < 0 ? 'font-semibold text-danger' : 'text-warning font-semibold'}>ATP {fmtNum(s.atp)}</span><span className="block text-muted-foreground">Safety {fmtNum(s.safetyStock)}</span></span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="C · Incoming supply" description="Upcoming arrivals, delayed and canceled receipts" actions={<Link to="/supply?tab=receipts" className="text-xs font-medium text-info hover:underline">All receipts</Link>} />
              <CardBody className="space-y-5">
                {!d ? <Skeleton className="h-48 w-full" /> : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <Stat label="Open receipts" value={d.sections.incomingSupply.openReceipts} />
                      <Stat label="Delayed" value={d.sections.incomingSupply.delayed} tone={d.sections.incomingSupply.delayed ? 'warning' : undefined} />
                      <Stat label="Canceled (30d)" value={d.sections.incomingSupply.canceledLast30Days} tone={d.sections.incomingSupply.canceledLast30Days ? 'danger' : undefined} />
                    </div>
                    <div className="h-36" role="img" aria-label="Expected arrival units over the next 30 days">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={d.sections.incomingSupply.timeline.map((t) => ({ ...t, label: fmtShortDate(t.date) }))} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART.axis }} tickLine={false} axisLine={false} interval={4} />
                          <YAxis tick={{ fontSize: 10, fill: CHART.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} formatter={(v: number) => [`${v} units`, 'Expected']} />
                          <Bar dataKey="units" fill="hsl(217 85% 55%)" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {d.sections.incomingSupply.upcoming.length === 0 ? (
                      <EmptyState title="No open receipts" description="Create a receipt when a purchase order is placed." action={<Link to="/supply?tab=receipts"><Button variant="secondary" size="sm">Create receipt</Button></Link>} />
                    ) : (
                      <ul className="divide-y divide-border">
                        {d.sections.incomingSupply.upcoming.map((r) => (
                          <li key={r.id}>
                            <Link to={`/supply/receipts/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:text-info">
                              <span className="font-medium">{r.receiptNumber} <span className="font-normal text-muted-foreground">· {r.sku} → {r.location}</span></span>
                              <span className="flex items-center gap-2">
                                <ReceiptBadge value={r.status} />
                                {r.delayDays > 0 && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">+{r.delayDays}d</span>}
                                <span className="tabular text-xs text-muted-foreground">{fmtDate(r.expectedArrival)} · {fmtNum(r.quantity)}u</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="D · Fulfillment risk" description="Orders that need attention, promise-date failures and open exceptions" actions={<Link to="/exceptions" className="text-xs font-medium text-info hover:underline">Exceptions queue</Link>} />
              <CardBody className="space-y-5">
                {!d ? <Skeleton className="h-48 w-full" /> : (
                  <>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Orders at risk</p>
                      {d.sections.fulfillmentRisk.atRisk.length === 0 ? <p className="text-sm text-muted-foreground">No orders at risk.</p> : (
                        <ul className="divide-y divide-border rounded-xl border border-border">
                          {d.sections.fulfillmentRisk.atRisk.slice(0, 6).map((o) => (
                            <li key={o.id}>
                              <Link to={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-accent/60">
                                <span className="font-medium">{o.orderNumber} <span className="font-normal text-muted-foreground">· {o.customer}</span></span>
                                <span className="flex items-center gap-2"><PriorityBadge value={o.priority} /><RiskBadge value={o.riskLevel} />{o.backorderedQty > 0 && <span className="tabular text-xs text-danger">{o.backorderedQty} short</span>}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upcoming promise failures</p>
                        {d.sections.fulfillmentRisk.promiseFailures.length === 0 ? <p className="text-sm text-muted-foreground">Every promise meets its requested date.</p> : (
                          <ul className="space-y-2 text-sm">
                            {d.sections.fulfillmentRisk.promiseFailures.slice(0, 5).map((p) => (
                              <li key={p.orderNumber} className="flex items-center justify-between gap-2"><span className="truncate">{p.orderNumber}</span><span className="tabular text-xs text-danger">+{p.daysLate}d late</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">High priority needing attention</p>
                        {d.sections.fulfillmentRisk.highPriority.length === 0 ? <p className="text-sm text-muted-foreground">None right now.</p> : (
                          <ul className="space-y-2 text-sm">
                            {d.sections.fulfillmentRisk.highPriority.slice(0, 5).map((o) => (
                              <li key={o.id} className="flex items-center justify-between gap-2"><Link to={`/orders/${o.id}`} className="truncate hover:underline">{o.orderNumber}</Link><RiskBadge value={o.riskLevel} /></li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open exceptions · {d.sections.fulfillmentRisk.exceptions.open}</p>
                      <div className="flex flex-wrap gap-2">
                        {d.sections.fulfillmentRisk.exceptions.bySeverity.map((s) => (
                          <Link key={s.severity} to={`/exceptions?severity=${s.severity}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"><SeverityBadge value={s.severity} /><span className="tabular font-semibold">{s.count}</span></Link>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader title="E · Recent activity" description="Inventory adjustments, orders, receipt status changes, allocation changes and planner actions" actions={<Link to="/audit" className="text-xs font-medium text-info hover:underline">Full audit log</Link>} />
            <CardBody className="p-0">
              {!d ? <div className="p-5"><Skeleton className="h-40 w-full" /></div> : d.recentActivity.length === 0 ? (
                <EmptyState icon={Activity} title="No activity yet" description="Actions will appear here as planners work." />
              ) : (
                <motion.ul initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.02 } } }} className="divide-y divide-border">
                  {d.recentActivity.map((a) => (
                    <motion.li key={a.id} variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                      <span className="tabular w-32 shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.timestamp)}</span>
                      <span className="font-medium">{humanize(a.action)}</span>
                      <span className="text-muted-foreground">{humanize(a.entityType)} #{a.entityId}</span>
                      <span className="text-xs text-muted-foreground">by {a.user}</span>
                      {a.reason && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">“{a.reason}”</span>}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'hsl(215 16% 65%)',
  CONFIRMED: 'hsl(217 85% 55%)',
  FULFILLING: 'hsl(199 89% 48%)',
  SHIPPED: 'hsl(158 64% 40%)',
  CANCELED: 'hsl(215 14% 80%)',
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'danger' }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : ''}`}>{fmtNum(value)}</p>
    </div>
  );
}

