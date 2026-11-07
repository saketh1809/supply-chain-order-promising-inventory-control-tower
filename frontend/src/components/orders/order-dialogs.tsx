import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw, Save, Send, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useCancelOrderMutation, useCustomerCommunicationDraftMutation, useListLocationsQuery, useListSkusQuery, useRecordCommunicationMutation, useShipOrderMutation, useUpdateOrderMutation } from '../../app/api';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, Input, Select, Textarea } from '../ui/input';
import { pushToast } from '../../features/ui/uiSlice';
import { communicationSchema, reasonSchema } from '../../lib/schemas';
import { fmtDate, fmtNum, todayYmd } from '../../lib/utils';
import type { OrderDetail } from '../../lib/dto';

const editSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter the customer name'),
  priority: z.enum(['HIGH', 'MED', 'LOW']),
  requestedShipDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use YYYY-MM-DD'),
  preferredLocationId: z.string(),
  lines: z.array(z.object({ id: z.number(), quantity: z.coerce.number().int().min(1, 'At least 1 unit'), shipped: z.number(), preferredLocationId: z.string(), remove: z.boolean() })),
  newLines: z.array(z.object({ skuId: z.string().min(1, 'Choose a SKU'), quantity: z.coerce.number().int().min(1, 'At least 1 unit'), preferredLocationId: z.string() })),
  reason: z.string().trim().max(500),
});
type EditValues = z.infer<typeof editSchema>;

/** Edit a non-final order: header fields, quantities, warehouse preferences, add or remove lines. */
export function EditOrderDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: OrderDetail }) {
  const dispatch = useAppDispatch();
  const [update, state] = useUpdateOrderMutation();
  const skus = useListSkusQuery({ pageSize: 200, sort: 'skuCode' });
  const locations = useListLocationsQuery({ pageSize: 200, status: 'active' });
  const defaults = useMemo<EditValues>(
    () => ({
      customerName: order.customer.name,
      priority: order.priority,
      requestedShipDate: order.requestedShipDate ?? '',
      preferredLocationId: order.preferredLocation ? String(order.preferredLocation.id) : '',
      lines: order.lines.map((l) => ({ id: l.id, quantity: l.requestedQty, shipped: l.shippedQty, preferredLocationId: l.preferredLocation ? String(l.preferredLocation.id) : '', remove: false })),
      newLines: [],
      reason: '',
    }),
    [order],
  );
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema), defaultValues: defaults });
  const newLines = useFieldArray({ control: form.control, name: 'newLines' });
  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const original = new Map(order.lines.map((l) => [l.id, l]));
    const updateLines = v.lines
      .filter((l) => !l.remove)
      .filter((l) => {
        const o = original.get(l.id)!;
        return l.quantity !== o.requestedQty || (l.preferredLocationId ? Number(l.preferredLocationId) : null) !== (o.preferredLocation?.id ?? null);
      })
      .map((l) => ({ lineId: l.id, quantity: l.quantity, preferredLocationId: l.preferredLocationId ? Number(l.preferredLocationId) : null }));
    const removeLineIds = v.lines.filter((l) => l.remove).map((l) => l.id);
    const addLines = v.newLines.map((l) => ({ skuId: Number(l.skuId), quantity: Number(l.quantity), preferredLocationId: l.preferredLocationId ? Number(l.preferredLocationId) : null }));
    try {
      await update({
        id: order.id,
        version: order.version,
        priority: v.priority,
        requestedShipDate: v.requestedShipDate || null,
        customerName: v.customerName,
        preferredLocationId: v.preferredLocationId ? Number(v.preferredLocationId) : null,
        updateLines,
        removeLineIds,
        addLines,
        reason: v.reason.trim() || undefined,
      }).unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Order updated', description: 'Allocations were recalculated without duplicating demand.' }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Order not updated', description: errorMessage(e) }));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} size="xl" title={`Edit ${order.orderNumber}`} description="Changes are versioned. If someone else changed the order in the meantime, reload and try again."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={state.isLoading}><Save className="h-4 w-4" /> Save changes</Button></>}>
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" error={form.formState.errors.customerName?.message} htmlFor="e-cust"><Input id="e-cust" {...form.register('customerName')} /></Field>
          <Field label="Priority" htmlFor="e-prio"><Select id="e-prio" {...form.register('priority')}><option value="HIGH">High</option><option value="MED">Medium</option><option value="LOW">Low</option></Select></Field>
          <Field label="Requested ship date" error={form.formState.errors.requestedShipDate?.message} htmlFor="e-req"><Input id="e-req" type="date" min={todayYmd()} {...form.register('requestedShipDate')} /></Field>
          <Field label="Order preferred warehouse" htmlFor="e-pref"><Select id="e-pref" {...form.register('preferredLocationId')}><option value="">No preference</option>{locations.data?.items.map((l: { id: number; locationCode: string }) => <option key={l.id} value={l.id}>{l.locationCode}</option>)}</Select></Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Existing lines</p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Quantity</th><th className="px-3 py-2">Shipped</th><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2">Remove</th></tr></thead>
              <tbody className="divide-y divide-border">
                {order.lines.map((l, i) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-medium">{l.sku.skuCode}</td>
                    <td className="px-3 py-2 w-32"><Input aria-label={`Quantity ${l.sku.skuCode}`} type="number" min={Math.max(1, l.shippedQty)} {...form.register(`lines.${i}.quantity`)} /></td>
                    <td className="tabular px-3 py-2 text-muted-foreground">{fmtNum(l.shippedQty)}</td>
                    <td className="px-3 py-2 w-44"><Select aria-label={`Warehouse ${l.sku.skuCode}`} {...form.register(`lines.${i}.preferredLocationId`)}><option value="">Fastest</option>{locations.data?.items.map((loc: { id: number; locationCode: string }) => <option key={loc.id} value={loc.id}>{loc.locationCode}</option>)}</Select></td>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Remove ${l.sku.skuCode}`} disabled={l.shippedQty > 0} {...form.register(`lines.${i}.remove`)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Lines with shipments cannot be removed or reduced below the shipped quantity.</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Add lines</p><Button type="button" size="sm" variant="secondary" onClick={() => newLines.append({ skuId: '', quantity: 1, preferredLocationId: '' })}><Plus className="h-3.5 w-3.5" /> Add</Button></div>
          {newLines.fields.map((f, i) => (
            <div key={f.id} className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.5fr)_100px_minmax(0,1fr)_auto]">
              <Select aria-label={`New line ${i + 1} SKU`} {...form.register(`newLines.${i}.skuId`)}><option value="">Select SKU…</option>{skus.data?.items.map((s) => <option key={s.id} value={s.id}>{s.skuCode} · {s.name}</option>)}</Select>
              <Input aria-label={`New line ${i + 1} quantity`} type="number" min={1} {...form.register(`newLines.${i}.quantity`)} />
              <Select aria-label={`New line ${i + 1} warehouse`} {...form.register(`newLines.${i}.preferredLocationId`)}><option value="">Fastest</option>{locations.data?.items.map((loc: { id: number; locationCode: string }) => <option key={loc.id} value={loc.id}>{loc.locationCode}</option>)}</Select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove new line ${i + 1}`} onClick={() => newLines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        <Field label="Reason for the change (recommended)" htmlFor="e-reason" hint="Stored in the audit log with the before and after values.">
          <Input id="e-reason" {...form.register('reason')} placeholder="e.g. Customer increased the quantity" />
        </Field>
      </form>
    </Dialog>
  );
}

const shipSchema = z.object({
  quantities: z.record(z.coerce.number().int().min(0)),
  reason: z.string().trim().max(500),
});

/** Ships quantities from on-hand allocated stock. The rest of the order stays allocated or backordered. */
export function ShipDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: OrderDetail }) {
  const dispatch = useAppDispatch();
  const [ship, state] = useShipOrderMutation();
  const [error, setError] = useState<string | null>(null);
  const openLines = order.lines.filter((l) => l.openQty > 0);
  const form = useForm<{ quantities: Record<string, number>; reason: string }>({ resolver: zodResolver(shipSchema) as any, defaultValues: { quantities: {}, reason: '' } });

  useEffect(() => {
    if (open) {
      form.reset({ quantities: {}, reason: '' });
      setError(null);
    }
  }, [open, form]);

  const onConfirm = form.handleSubmit(async (v) => {
    const lines = openLines.filter((l) => Number(v.quantities[l.id]) > 0).map((l) => ({ orderLineId: l.id, quantity: Number(v.quantities[l.id]) }));
    if (lines.length === 0) return setError('Enter a quantity for at least one line.');
    if (v.reason.trim() && reasonSchema.safeParse({ reason: v.reason }).success === false) return setError('Reason must be at least 3 characters.');
    try {
      const res = await ship({ id: order.id, lines, reason: v.reason.trim() || undefined, isSplit: lines.length < openLines.length || lines.some((x) => x.quantity < (openLines.find((o) => o.id === x.orderLineId)?.openQty ?? 0)) }).unwrap();
      dispatch(pushToast({ tone: 'success', title: `Shipment ${res.shipment.shipmentNumber} posted`, description: `Order is now ${res.orderStatus.toLowerCase()}. Inventory was decremented once.` }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} title={`Ship ${order.orderNumber}`} description="Only units on hand and allocated to the line can ship today. Inbound-only units ship when their receipt arrives."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" onClick={onConfirm} loading={state.isLoading}><Send className="h-4 w-4" /> Post shipment</Button></>}>
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-2">
          {openLines.length === 0 && <p className="text-sm text-muted-foreground">No open quantity remains on this order.</p>}
          {openLines.map((l) => (
            <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-3">
              <span className="text-sm"><span className="font-medium">{l.sku.skuCode}</span> <span className="text-xs text-muted-foreground">· {l.openQty} open · {l.allocatedQty} allocated</span></span>
              <Input aria-label={`Ship quantity ${l.sku.skuCode}`} type="number" min={0} max={l.openQty} {...form.register(`quantities.${l.id}` as const)} />
            </div>
          ))}
        </div>
        <Field label="Reason (optional)" htmlFor="ship-reason"><Input id="ship-reason" {...form.register('reason')} placeholder="e.g. First tranche ready at CA" /></Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}

const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Enter a cancellation reason').max(500) });

/** Cancels an order and releases its allocations back into ATP. */
export function CancelOrderDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: OrderDetail }) {
  const dispatch = useAppDispatch();
  const [cancel, state] = useCancelOrderMutation();
  const form = useForm<{ reason: string }>({ resolver: zodResolver(cancelSchema), defaultValues: { reason: '' } });
  useEffect(() => { if (open) form.reset({ reason: '' }); }, [open, form]);
  const onConfirm = form.handleSubmit(async (v) => {
    try {
      const res = await cancel({ id: order.id, reason: v.reason, version: order.version }).unwrap();
      dispatch(pushToast({ tone: 'success', title: `${order.orderNumber} canceled`, description: `${fmtNum(res.releasedUnits)} units released back into ATP and other orders were recalculated.` }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Order not canceled', description: errorMessage(e) }));
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Cancel ${order.orderNumber}?`} description="Allocations are released immediately and freed supply is offered to other backordered orders."
      footer={<><Button variant="secondary" onClick={onClose}>Keep order</Button><Button variant="danger" onClick={onConfirm} loading={state.isLoading}>Cancel order</Button></>}>
      <Field label="Cancellation reason (required)" error={form.formState.errors.reason?.message} htmlFor="cancel-reason"><Textarea id="cancel-reason" {...form.register('reason')} /></Field>
    </Dialog>
  );
}

/** AI customer update: draft → edit → regenerate → copy → save as a sent-message record. Never sends email. */
export function CustomerUpdateDialog({ open, onClose, orderId, orderNumber }: { open: boolean; onClose: () => void; orderId: number; orderNumber: string }) {
  const dispatch = useAppDispatch();
  const [generate, gState] = useCustomerCommunicationDraftMutation();
  const [record, rState] = useRecordCommunicationMutation();
  const [draft, setDraft] = useState<any>(null);
  const form = useForm({ resolver: zodResolver(communicationSchema), defaultValues: { subject: '', body: '' } });

  const run = async () => {
    try {
      const res = await generate({ orderId, tone: 'formal' }).unwrap();
      setDraft(res);
      form.reset({ subject: res.output.subject, body: res.output.body });
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Draft not generated', description: errorMessage(e) }));
    }
  };
  useEffect(() => {
    if (open) {
      setDraft(null);
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    const v = form.getValues();
    try {
      await navigator.clipboard.writeText(`Subject: ${v.subject}\n\n${v.body}`);
      dispatch(pushToast({ tone: 'success', title: 'Copied to clipboard' }));
    } catch {
      dispatch(pushToast({ tone: 'warning', title: 'Clipboard unavailable', description: 'Select the text and copy it manually.' }));
    }
  };

  const save = form.handleSubmit(async (v) => {
    try {
      await record({ id: orderId, subject: v.subject, body: v.body, aiInteractionId: draft?.id }).unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Recorded as sent', description: 'The message is stored on the order. Email delivery is outside this build.' }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Not recorded', description: errorMessage(e) }));
    }
  });

  const facts = draft?.output?.facts;
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Customer update · ${orderNumber}`} description="AI drafts an update from the live plan. It is advisory: review, edit, then record it as sent."
      footer={<>
        <Button variant="ghost" onClick={run} loading={gState.isLoading} className="mr-auto"><RefreshCw className="h-4 w-4" /> Regenerate</Button>
        <Button variant="secondary" onClick={copy} disabled={!draft}><Copy className="h-4 w-4" /> Copy</Button>
        <Button onClick={save} loading={rState.isLoading} disabled={!draft}><Send className="h-4 w-4" /> Save as sent</Button>
      </>}>
      {gState.isLoading && !draft && <p className="text-sm text-muted-foreground">Drafting from the current plan…</p>}
      {draft && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info">AI draft · {draft.provider}:{draft.model}</span>
            <span>Interaction #{draft.id}</span>
          </div>
          {facts && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-border p-2"><p className="text-muted-foreground">Ships now</p><p className="tabular font-semibold">{fmtNum(facts.totals.shippableNow)} units</p></div>
              <div className="rounded-lg border border-border p-2"><p className="text-muted-foreground">Backordered</p><p className="tabular font-semibold">{fmtNum(facts.totals.backordered)} units</p></div>
              <div className="rounded-lg border border-border p-2"><p className="text-muted-foreground">Planned completion</p><p className="font-semibold">{fmtDate(facts.promisedShipDate)}</p></div>
              <div className="rounded-lg border border-border p-2"><p className="text-muted-foreground">Next update by</p><p className="font-semibold">{fmtDate(facts.nextUpdateBy)}</p></div>
            </div>
          )}
          <Field label="Subject" error={form.formState.errors.subject?.message} htmlFor="cu-subject"><Input id="cu-subject" {...form.register('subject')} /></Field>
          <Field label="Message" error={form.formState.errors.body?.message} htmlFor="cu-body" hint="Edit freely. Saved text is kept exactly as shown.">
            <Textarea id="cu-body" rows={12} className="min-h-[260px] font-mono text-[13px] leading-relaxed" {...form.register('body')} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
