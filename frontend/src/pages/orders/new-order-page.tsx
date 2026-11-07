import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, Trash2, Eye, Save, CheckCheck, AlertTriangle, Info } from 'lucide-react';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useCreateOrderMutation, useListCustomersQuery, useListLocationsQuery, useListSkusQuery, usePreviewOrderMutation } from '../../app/api';
import { PageHeader } from '../../components/common/page-header';
import { AllocationBadge, StockBadge } from '../../components/common/status';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Field, Input, Select } from '../../components/ui/input';
import { pushToast } from '../../features/ui/uiSlice';
import { newOrderSchema, type NewOrderValues } from '../../lib/schemas';
import { fmtDate, fmtNum, todayYmd } from '../../lib/utils';

const EMPTY_LINE = { skuId: '', quantity: 1, preferredLocationId: '' };

export function NewOrderPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const skus = useListSkusQuery({ pageSize: 200, sort: 'skuCode' });
  const locations = useListLocationsQuery({ pageSize: 200, status: 'active' });
  const customers = useListCustomersQuery();
  const [runPreview, previewState] = usePreviewOrderMutation();
  const [createOrder, createState] = useCreateOrderMutation();

  const form = useForm<NewOrderValues>({
    resolver: zodResolver(newOrderSchema),
    defaultValues: { orderNumber: '', customerName: '', priority: 'MED', requestedShipDate: '', preferredLocationId: '', lines: [{ ...EMPTY_LINE }] },
    mode: 'onTouched',
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const skuOptions = skus.data?.items ?? [];
  const locationOptions = locations.data?.items ?? [];
  const skuById = useMemo(() => new Map(skuOptions.map((s) => [String(s.id), s])), [skuOptions]);

  const buildPayload = (v: NewOrderValues, confirm: boolean) => ({
    orderNumber: v.orderNumber,
    customerName: v.customerName,
    priority: v.priority,
    requestedShipDate: v.requestedShipDate || null,
    preferredLocationId: v.preferredLocationId ? Number(v.preferredLocationId) : null,
    confirm,
    lines: v.lines.map((l) => ({ skuId: Number(l.skuId), quantity: Number(l.quantity), preferredLocationId: l.preferredLocationId ? Number(l.preferredLocationId) : null })),
  });

  const onPreview = async () => {
    setPreviewError(null);
    const values = form.getValues();
    const valid = await form.trigger(['customerName', 'priority', 'requestedShipDate', 'lines']);
    if (!valid) return;
    try {
      const res = await runPreview({
        customerName: values.customerName,
        priority: values.priority,
        requestedShipDate: values.requestedShipDate || null,
        preferredLocationId: values.preferredLocationId ? Number(values.preferredLocationId) : null,
        lines: values.lines.map((l) => ({ skuId: Number(l.skuId), quantity: Number(l.quantity), preferredLocationId: l.preferredLocationId ? Number(l.preferredLocationId) : null })),
      }).unwrap();
      setPreview(res);
    } catch (e) {
      setPreviewError(errorMessage(e, 'The preview could not be calculated.'));
      setPreview(null);
    }
  };

  const submit = (confirm: boolean) =>
    form.handleSubmit(async (values) => {
      try {
        const created = await createOrder(buildPayload(values, confirm)).unwrap();
        dispatch(
          pushToast({
            tone: 'success',
            title: confirm ? `Order ${created.orderNumber} confirmed` : `Draft ${created.orderNumber} saved`,
            description: confirm ? 'Demand is reserved and promise dates were calculated.' : 'Confirm when ready to reserve inventory.',
          }),
        );
        navigate(`/orders/${created.id}`);
      } catch (e) {
        form.setError('orderNumber', { message: errorMessage(e) });
        dispatch(pushToast({ tone: 'error', title: 'Order not created', description: errorMessage(e) }));
      }
    })();

  return (
    <>
      <PageHeader
        title="New order"
        description="Enter the customer demand, preview what can be promised from current stock and inbound supply, then save a draft or confirm to reserve inventory."
        crumbs={[{ label: 'Orders', to: '/orders' }, { label: 'New order' }]}
      />

      <form className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Order header" description="Identify the order and the customer" />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Order number" error={form.formState.errors.orderNumber?.message} htmlFor="orderNumber" hint="Unique. Example: A104">
                <Input id="orderNumber" aria-invalid={!!form.formState.errors.orderNumber} {...form.register('orderNumber')} />
              </Field>
              <Field label="Customer" error={form.formState.errors.customerName?.message} htmlFor="customerName" hint="Existing customers are matched by name">
                <Input id="customerName" list="customer-options" aria-invalid={!!form.formState.errors.customerName} {...form.register('customerName')} />
                <datalist id="customer-options">
                  {customers.data?.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </Field>
              <Field label="Priority" error={form.formState.errors.priority?.message} htmlFor="priority">
                <Select id="priority" {...form.register('priority')}>
                  <option value="HIGH">High (allocated first)</option>
                  <option value="MED">Medium</option>
                  <option value="LOW">Low</option>
                </Select>
              </Field>
              <Field label="Requested ship date" error={form.formState.errors.requestedShipDate?.message} htmlFor="requestedShipDate" hint="Optional. Used to flag promises that come too late.">
                <Input id="requestedShipDate" type="date" min={todayYmd()} {...form.register('requestedShipDate')} />
              </Field>
              <Field label="Preferred fulfillment location" hint="Optional. Overrides the customer default. Line-level preferences win.">
                <Select aria-label="Preferred fulfillment location" {...form.register('preferredLocationId')}>
                  <option value="">No preference (fastest location)</option>
                  {locationOptions.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}
                </Select>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Order lines"
              description="One line per SKU. Each line can prefer a specific warehouse."
              actions={
                <Button type="button" variant="secondary" size="sm" onClick={() => append({ ...EMPTY_LINE })}>
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {form.formState.errors.lines?.root?.message && <p role="alert" className="text-xs text-danger">{form.formState.errors.lines.root.message}</p>}
              {fields.map((f, i) => {
                const lineErr = form.formState.errors.lines?.[i];
                const sku = skuById.get(form.watch(`lines.${i}.skuId`));
                return (
                  <div key={f.id} className="grid grid-cols-1 items-start gap-3 rounded-xl border border-border p-3 md:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1.1fr)_auto]">
                    <Field label="SKU" error={lineErr?.skuId?.message} htmlFor={`sku-${i}`}>
                      <Controller
                        control={form.control}
                        name={`lines.${i}.skuId`}
                        render={({ field }) => (
                          <Select id={`sku-${i}`} {...field}>
                            <option value="">Select a SKU…</option>
                            {skuOptions.map((s) => <option key={s.id} value={s.id}>{s.skuCode} · {s.name}</option>)}
                          </Select>
                        )}
                      />
                      {sku && <p className="mt-1 text-[11px] text-muted-foreground">Lead time {sku.leadTimeDays ?? '—'} days · safety stock {sku.safetyStockQty}</p>}
                    </Field>
                    <Field label="Quantity" error={lineErr?.quantity?.message} htmlFor={`qty-${i}`}>
                      <Input id={`qty-${i}`} type="number" min={1} inputMode="numeric" {...form.register(`lines.${i}.quantity`)} />
                    </Field>
                    <Field label="Warehouse preference" htmlFor={`pref-${i}`}>
                      <Select id={`pref-${i}`} {...form.register(`lines.${i}.preferredLocationId`)}>
                        <option value="">Any (fastest)</option>
                        {locationOptions.map((l: { id: number; locationCode: string }) => <option key={l.id} value={l.id}>{l.locationCode}</option>)}
                      </Select>
                    </Field>
                    <div className="pt-6">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => fields.length > 1 && remove(i)} disabled={fields.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onPreview} loading={previewState.isLoading}>
              <Eye className="h-4 w-4" /> Preview fulfillment
            </Button>
            <Button type="button" variant="secondary" onClick={() => submit(false)} loading={createState.isLoading && !createState.originalArgs?.confirm}>
              <Save className="h-4 w-4" /> Save as draft
            </Button>
            <Button type="button" onClick={() => submit(true)} loading={createState.isLoading && !!createState.originalArgs?.confirm}>
              <CheckCheck className="h-4 w-4" /> Create & confirm
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-20">
            <CardHeader
              title="Expected fulfillment"
              description="Calculated by the allocation engine against current stock and eligible inbound receipts. Nothing is saved until you confirm."
            />
            <CardBody className="space-y-5">
              {!preview && !previewError && (
                <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p>Click <span className="font-medium text-foreground">Preview fulfillment</span> to see allocated and backordered quantities, promise dates, and the warehouses that would ship.</p>
                </div>
              )}
              {previewError && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p>{previewError}</p>
                </div>
              )}
              {preview && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Promised ship</p>
                      <p className="mt-1 text-sm font-semibold">{preview.orderPromisedShipDate ? fmtDate(preview.orderPromisedShipDate) : 'Not committed'}</p>
                    </div>
                    <div className="rounded-xl border border-border p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Backordered</p>
                      <p className={`tabular mt-1 text-sm font-semibold ${preview.totalBackorderedQty ? 'text-danger' : 'text-success'}`}>{fmtNum(preview.totalBackorderedQty)} units</p>
                    </div>
                  </div>
                  {preview.riskNote && (
                    <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{preview.riskNote}</p>
                  )}
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2 text-right">Requested</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Short</th><th className="px-3 py-2">Ships from</th><th className="px-3 py-2">Promise</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {preview.lines.map((l: any, i: number) => (
                          <tr key={i}>
                            <td className="px-3 py-2"><span className="font-medium">{l.skuCode}</span><div><AllocationBadge value={l.allocationStatus} /></div></td>
                            <td className="tabular px-3 py-2 text-right">{fmtNum(l.requestedQty)}</td>
                            <td className="tabular px-3 py-2 text-right">{fmtNum(l.allocatedQty)}</td>
                            <td className={`tabular px-3 py-2 text-right ${l.backorderedQty ? 'font-semibold text-danger' : ''}`}>{fmtNum(l.backorderedQty)}</td>
                            <td className="px-3 py-2">{l.fulfillmentLocation ?? '—'}</td>
                            <td className="tabular px-3 py-2">{fmtDate(l.promisedShipDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.impactedOtherOrders > 0 && (
                    <p className="flex items-start gap-2 rounded-lg bg-info/10 p-3 text-xs text-info">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Confirming this order would change the promise of {preview.impactedOtherOrders} other order line(s), because priority and creation time decide who gets scarce units.
                    </p>
                  )}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available inventory for these SKUs</p>
                    <ul className="space-y-1.5 text-xs">
                      {preview.stock.map((s: any) => (
                        <li key={s.balanceId} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                          <span className="min-w-0 truncate"><span className="font-medium">{s.skuCode}</span> @ {s.locationCode}</span>
                          <span className="flex items-center gap-2"><span className="tabular">{fmtNum(s.available)} avail · {fmtNum(s.incoming)} inbound</span><StockBadge value={s.status} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Priority rule: HIGH before MED before LOW; ties go to the earlier creation time, then the order number. <Link to="/orders" className="text-info hover:underline">Back to orders</Link>
              </p>
            </CardBody>
          </Card>
        </div>
      </form>
    </>
  );
}
