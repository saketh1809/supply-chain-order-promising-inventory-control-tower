import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { Building2, Save, Users, Plug, RefreshCcw, ExternalLink } from 'lucide-react';
import { errorMessage, useGetSettingsQuery, useGetUsersQuery, useListCustomersQuery, useListLocationsQuery, useRecalculateMutation, useSetCustomerPreferredLocationMutation, useUpdateSettingsMutation } from '../../app/api';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { setActingUser, pushToast } from '../../features/ui/uiSlice';
import { PageHeader } from '../../components/common/page-header';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/states';
import { settingsSchema, type SettingsValues } from '../../lib/schemas';
import { fmtNum, humanize } from '../../lib/utils';

export function SettingsPage() {
  const dispatch = useAppDispatch();
  const actingId = useAppSelector((s) => s.ui.actingUserId);
  const settings = useGetSettingsQuery();
  const users = useGetUsersQuery();
  const [update, uState] = useUpdateSettingsMutation();
  const [recalc, rState] = useRecalculateMutation();
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: { companyName: '', timezone: 'UTC', defaultSafetyStock: 10 } });

  useEffect(() => {
    if (settings.data) form.reset({ companyName: settings.data.companyName, timezone: settings.data.timezone, defaultSafetyStock: settings.data.defaultSafetyStock });
  }, [settings.data, form]);

  const onSave = form.handleSubmit(async (v) => {
    try {
      await update(v).unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Workspace settings saved', description: 'The change is recorded in the audit log.' }));
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Not saved', description: errorMessage(e) }));
    }
  });

  const onRecalc = async () => {
    try {
      const res = await recalc().unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Allocations recalculated', description: `${res.skuCount} SKU(s) checked · ${res.changedLines} line(s) changed · ${res.exceptionsCreated} exception(s) raised · ${res.exceptionsResolved} resolved.` }));
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Recalculation failed', description: errorMessage(e) }));
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Workspace details, planning defaults, users and integration information." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Workspace</span>} description="Company name and planning defaults used across the control tower." />
          <CardBody>
            {settings.isLoading ? <Skeleton className="h-40 w-full" /> : (
              <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
                <Field label="Company name" error={form.formState.errors.companyName?.message} htmlFor="s-name"><Input id="s-name" {...form.register('companyName')} /></Field>
                <Field label="Planning timezone" error={form.formState.errors.timezone?.message} htmlFor="s-tz" hint="Business dates are calendar days; this is shown for reference."><Input id="s-tz" {...form.register('timezone')} /></Field>
                <Field label="Default safety stock (units)" error={form.formState.errors.defaultSafetyStock?.message} hint="Applied to new SKUs unless set individually." htmlFor="s-safety"><Input id="s-safety" type="number" min={0} {...form.register('defaultSafetyStock')} /></Field>
                <div className="flex items-end justify-end sm:col-span-2"><Button onClick={onSave} loading={uState.isLoading}><Save className="h-4 w-4" /> Save settings</Button></div>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><RefreshCcw className="h-4 w-4" /> Allocation engine</span>} description="Recompute every SKU from persisted records. Safe to repeat: unchanged data produces no changes." />
          <CardBody className="space-y-3">
            <p className="text-sm text-muted-foreground">Normally recalculation runs automatically on every change. Use this after a data correction or to verify the plan.</p>
            <Button variant="secondary" onClick={onRecalc} loading={rState.isLoading} className="w-full">Recalculate all allocations</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Users className="h-4 w-4" /> Users</span>} description="Choose who you act as. Every change is attributed to the selected user." />
          <CardBody className="space-y-2">
            {users.isLoading ? <Skeleton className="h-32 w-full" /> : users.data?.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{u.name}</p><p className="truncate text-xs text-muted-foreground">{u.email}</p></div>
                <div className="flex items-center gap-2"><Badge tone="neutral">{humanize(u.role)}</Badge>{u.id === actingId ? <Badge tone="success">Acting</Badge> : <Button size="sm" variant="secondary" onClick={() => dispatch(setActingUser(u.id))}>Act as</Button>}</div>
              </div>
            ))}
          </CardBody>
        </Card>

        <CustomerPreferencesCard />

        <Card className="xl:col-span-2">
          <CardHeader title={<span className="flex items-center gap-2"><Plug className="h-4 w-4" /> Integration & API</span>} description="The REST API is versioned under /api/v1 and documented with OpenAPI." />
          <CardBody className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-border p-4"><p className="font-medium">Interactive API docs</p><p className="mt-1 text-xs text-muted-foreground">Swagger UI with every endpoint, schema and response code.</p><a href="/api/docs" target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-info hover:underline">Open Swagger <ExternalLink className="h-3 w-3" /></a></div>
            <div className="rounded-xl border border-border p-4"><p className="font-medium">Acting identity</p><p className="mt-1 text-xs text-muted-foreground">Requests send <code className="font-mono">x-user-id</code>. This is a demo identity, not sign-in.</p><p className="tabular mt-2 text-xs">User #{fmtNum(actingId)}</p></div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data safety" description="What protects the record" />
          <CardBody className="space-y-2 text-xs text-muted-foreground">
            <p>• Audit log and inventory ledger are append-only (enforced by database triggers).</p>
            <p>• Negative inventory is rejected by a database CHECK constraint.</p>
            <p>• Each receipt can be received exactly once (unique ledger reference key).</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/** Customer-level preferred fulfillment warehouse (used when an order and its lines have no preference). */
function CustomerPreferencesCard() {
  const dispatch = useAppDispatch();
  const customers = useListCustomersQuery();
  const locations = useListLocationsQuery({ pageSize: 200, status: 'active' });
  const [save] = useSetCustomerPreferredLocationMutation();
  const [draft, setDraft] = useState<Record<number, string>>({});
  const onSave = async (id: number, current: string) => {
    try {
      const value = draft[id] ?? current;
      await save({ id, locationId: value ? Number(value) : null }).unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Customer preference saved', description: 'Open orders for this customer were recalculated.' }));
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Not saved', description: errorMessage(e) }));
    }
  };
  return (
    <Card className="xl:col-span-3">
      <CardHeader title="Customer fulfillment preferences" description="Preferred warehouse per customer. Order-level and line-level preferences override it." />
      <CardBody className="p-0">
        {customers.isLoading ? <div className="p-5"><Skeleton className="h-32 w-full" /></div> : (customers.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No customers yet. They are created automatically when an order names them.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-2">Customer</th><th className="px-5 py-2 text-right">Orders</th><th className="px-5 py-2">Preferred warehouse</th><th className="px-5 py-2" /></tr></thead>
              <tbody className="divide-y divide-border">
                {customers.data?.map((c) => {
                  const current = c.preferredLocation ? String(c.preferredLocation.id) : '';
                  return (
                    <tr key={c.id}>
                      <td className="px-5 py-2.5 font-medium">{c.name}</td>
                      <td className="tabular px-5 py-2.5 text-right">{fmtNum(c.orderCount)}</td>
                      <td className="px-5 py-2.5">
                        <Select aria-label={`Preferred warehouse for ${c.name}`} className="w-56" value={draft[c.id] ?? current} onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}>
                          <option value="">No preference</option>
                          {locations.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}
                        </Select>
                      </td>
                      <td className="px-5 py-2.5 text-right"><Button size="sm" variant="secondary" disabled={(draft[c.id] ?? current) === current} onClick={() => onSave(c.id, current)}>Save</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
