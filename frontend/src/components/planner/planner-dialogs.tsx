import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useExpediteReceiptMutation, useOverridePromiseMutation, usePreviewExpediteMutation, usePreviewReassignMutation, useReassignLocationMutation, useSplitShipmentMutation } from '../../app/api';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, Input, Textarea } from '../ui/input';
import { pushToast } from '../../features/ui/uiSlice';
import { expediteSchema, overrideSchema, reasonSchema } from '../../lib/schemas';
import { fmtDate, fmtNum } from '../../lib/utils';
import { ArrowRight } from 'lucide-react';
import type { MovementSummary } from '../../lib/dto';

/** A. Expedite receipt: move an arrival earlier, preview the impact on dependent orders, then confirm. */
export function ExpediteDialog({ open, onClose, receipt }: { open: boolean; onClose: () => void; receipt: { id: number; receiptNumber: string; expectedArrivalTime: string } }) {
  const dispatch = useAppDispatch();
  const [preview, setPreview] = useState<{ receipt: any; impact: MovementSummary[] } | null>(null);
  const [runPreview, pState] = usePreviewExpediteMutation();
  const [expedite, eState] = useExpediteReceiptMutation();
  const currentDate = receipt.expectedArrivalTime.slice(0, 10);
  const form = useForm({ resolver: zodResolver(expediteSchema), defaultValues: { receiptId: receipt.id, newExpectedArrival: '', reason: '' } });

  useEffect(() => {
    if (open) {
      form.reset({ receiptId: receipt.id, newExpectedArrival: '', reason: '' });
      setPreview(null);
    }
  }, [open, receipt.id, form]);

  const onPreview = form.handleSubmit(async (v) => {
    try {
      setPreview(await runPreview(v).unwrap());
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Preview failed', description: errorMessage(e) }));
    }
  });

  const onConfirm = form.handleSubmit(async (v) => {
    try {
      const res = await expedite(v).unwrap();
      dispatch(pushToast({ tone: 'success', title: `${receipt.receiptNumber} expedited to ${fmtDate(res.newArrival)}`, description: `Allocations recalculated for ${res.recalculation.affectedOrders} order(s).` }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Expedite not applied', description: errorMessage(e) }));
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Expedite ${receipt.receiptNumber}`}
      description={`Currently expected ${fmtDate(currentDate)}. An expedite can only move the arrival earlier. The preview shows what changes before anything is saved.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={onPreview} loading={pState.isLoading}>Preview impact</Button>
          <Button onClick={onConfirm} loading={eState.isLoading} disabled={!preview}>Confirm expedite</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="New expected arrival" error={form.formState.errors.newExpectedArrival?.message} htmlFor="exp-date">
            <Input id="exp-date" type="date" max={currentDate} {...form.register('newExpectedArrival', { onChange: () => setPreview(null) })} />
          </Field>
          <Field label="Reason (required)" error={form.formState.errors.reason?.message} htmlFor="exp-reason">
            <Input id="exp-reason" placeholder="e.g. Customer escalation" {...form.register('reason')} />
          </Field>
        </div>
        {preview && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Impact on dependent order lines</p>
            {preview.impact.length === 0 ? (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">No order promise changes. The receipt does not limit any current allocation.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/60 uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Promise</th><th className="px-3 py-2 text-right">Backorder</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {preview.impact.map((m) => (
                      <tr key={m.lineId}>
                        <td className="px-3 py-2 font-medium">{m.orderNumber}</td>
                        <td className="px-3 py-2">{m.sku}</td>
                        <td className="tabular px-3 py-2"><span className="text-muted-foreground">{fmtDate(m.promiseBefore)}</span> <ArrowRight className="inline h-3 w-3" /> <span className="font-semibold text-success">{fmtDate(m.promiseAfter)}</span></td>
                        <td className="tabular px-3 py-2 text-right">{fmtNum(m.backorderedBefore)} → {fmtNum(m.backorderedAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** B. Reassign fulfillment location: compare every warehouse before choosing one. */
export function ReassignDialog({ open, onClose, orderLineId, skuCode }: { open: boolean; onClose: () => void; orderLineId: number; skuCode: string }) {
  const dispatch = useAppDispatch();
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [preview, pState] = usePreviewReassignMutation();
  const [reassign, rState] = useReassignLocationMutation();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setReason('');
      setReasonError(null);
      preview({ orderLineId }).unwrap().then((res) => {
        setData(res);
        setSelected(res.recommendedLocationId ?? null);
      }).catch((e) => dispatch(pushToast({ tone: 'error', title: 'Options unavailable', description: errorMessage(e) })));
    }
  }, [open, orderLineId, preview, dispatch]);

  const onConfirm = async () => {
    const parsed = reasonSchema.safeParse({ reason });
    if (!parsed.success) return setReasonError(parsed.error.issues[0].message);
    try {
      const res = await reassign({ orderLineId, locationId: selected, reason: parsed.data.reason }).unwrap();
      dispatch(pushToast({ tone: 'success', title: `${skuCode} now ships from ${res.after.fulfillmentLocation ?? 'the chosen location'}`, description: `Promise ${fmtDate(res.after.effectivePromisedDate)}. Audit entry recorded.` }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Reassignment not applied', description: errorMessage(e) }));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Reassign fulfillment · ${skuCode}`} description="Each warehouse is evaluated with the same allocation engine. Pick the one that best fits the customer."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onConfirm} loading={rState.isLoading} disabled={!data}>Confirm reassignment</Button></>}>
      {pState.isLoading && !data && <p className="text-sm text-muted-foreground">Comparing warehouses…</p>}
      {data && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60 uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2"> </th><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Inbound</th><th className="px-3 py-2 text-right">Would allocate</th><th className="px-3 py-2 text-right">Backorder</th><th className="px-3 py-2">Earliest ship</th><th className="px-3 py-2">Promise</th></tr></thead>
              <tbody className="divide-y divide-border">
                {data.options.map((o: any) => (
                  <tr key={o.locationId} className={selected === o.locationId ? 'bg-info/5' : ''}>
                    <td className="px-3 py-2"><input type="radio" name="loc" aria-label={`Use ${o.locationCode}`} checked={selected === o.locationId} onChange={() => setSelected(o.locationId)} /></td>
                    <td className="px-3 py-2"><span className="font-medium">{o.locationCode}</span>{o.isCurrent && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">current</span>}{o.locationId === data.recommendedLocationId && <span className="ml-2 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">best</span>}</td>
                    <td className="tabular px-3 py-2 text-right">{fmtNum(o.onHand)}</td>
                    <td className="tabular px-3 py-2 text-right">{fmtNum(o.incoming)}</td>
                    <td className="tabular px-3 py-2 text-right">{fmtNum(o.allocatedQty)}</td>
                    <td className={`tabular px-3 py-2 text-right ${o.backorderedQty ? 'font-semibold text-danger' : ''}`}>{fmtNum(o.backorderedQty)}</td>
                    <td className="tabular px-3 py-2">{fmtDate(o.earliestShipDate)}</td>
                    <td className="tabular px-3 py-2">{fmtDate(o.promisedShipDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="loc" checked={selected === null} onChange={() => setSelected(null)} aria-label="Let the engine choose" /> Let the engine choose the fastest location (clear the preference)</label>
          <Field label="Reason (required)" error={reasonError ?? undefined} htmlFor="reassign-reason">
            <Input id="reassign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer prefers the west coast warehouse" />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/** C. Manual promise override: explicit date, mandatory justification, calculated date preserved. */
export function OverrideDialog({ open, onClose, line }: { open: boolean; onClose: () => void; line: { id: number; skuCode?: string; calculatedPromisedDate: string | null; manualPromisedDate: string | null } }) {
  const dispatch = useAppDispatch();
  const [override, state] = useOverridePromiseMutation();
  const form = useForm({ resolver: zodResolver(overrideSchema), defaultValues: { promisedDate: line.manualPromisedDate ?? '', justification: '' } });
  useEffect(() => {
    if (open) form.reset({ promisedDate: line.manualPromisedDate ?? '', justification: '' });
  }, [open, line.manualPromisedDate, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await override({ orderLineId: line.id, promisedDate: v.promisedDate, justification: v.justification }).unwrap();
      dispatch(pushToast({ tone: 'success', title: 'Manual promise recorded', description: 'The calculated promise is kept alongside it and the override is flagged in the audit log.' }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Override not saved', description: errorMessage(e) }));
    }
  });

  const clear = async () => {
    try {
      await override({ orderLineId: line.id, promisedDate: null, justification: 'Override removed; returning to calculated promise' }).unwrap();
      dispatch(pushToast({ tone: 'info', title: 'Override removed', description: 'The promise follows the calculation again.' }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Could not remove override', description: errorMessage(e) }));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Override promised date" description="A manual override is clearly marked everywhere it appears. The calculated date is preserved for comparison."
      footer={<>
        {line.manualPromisedDate && <Button variant="ghost" onClick={clear} className="mr-auto">Remove override</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={onSubmit} loading={state.isLoading}>Save override</Button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-lg bg-muted p-3 text-sm">Calculated promise: <span className="tabular font-medium">{fmtDate(line.calculatedPromisedDate)}</span></div>
        <Field label="Manual promised ship date" error={form.formState.errors.promisedDate?.message} htmlFor="override-date">
          <Input id="override-date" type="date" {...form.register('promisedDate')} />
        </Field>
        <Field label="Justification (required)" error={form.formState.errors.justification?.message} htmlFor="override-just" hint="At least 10 characters. Example: Customer accepted a later date by phone.">
          <Textarea id="override-just" {...form.register('justification')} />
        </Field>
      </div>
    </Dialog>
  );
}

/** D. Split shipment: ship part of a line now; the remainder stays allocated or backordered. */
export function SplitShipmentDialog({ open, onClose, orderId, lines }: { open: boolean; onClose: () => void; orderId: number; lines: Array<{ id: number; skuCode: string; openQty: number; allocatedQty: number }> }) {
  const dispatch = useAppDispatch();
  const [split, state] = useSplitShipmentMutation();
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setQty({});
      setReason('');
      setError(null);
    }
  }, [open]);
  const payload = lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ orderLineId: l.id, quantity: Number(qty[l.id]) }));

  const onConfirm = async () => {
    const parsed = reasonSchema.safeParse({ reason });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (payload.length === 0) return setError('Enter a quantity to ship for at least one line.');
    try {
      const res = await split({ orderId, lines: payload, reason: parsed.data.reason }).unwrap();
      dispatch(pushToast({ tone: 'success', title: `Shipment ${res.shipment.shipmentNumber} created`, description: `Order is now ${res.orderStatus.toLowerCase()}. Remaining units stay allocated or backordered.` }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Split shipment" description="Ship only the units that are physically on hand for each line. Anything else stays allocated (inbound) or backordered."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onConfirm} loading={state.isLoading}>Ship selected units</Button></>}>
      <div className="space-y-4">
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3">
              <span className="text-sm"><span className="font-medium">{l.skuCode}</span> <span className="text-xs text-muted-foreground">· {l.openQty} open · {l.allocatedQty} allocated</span></span>
              <Input aria-label={`Quantity to ship for ${l.skuCode}`} type="number" min={0} max={l.openQty} value={qty[l.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
        <Field label="Reason (required)" htmlFor="split-reason">
          <Input id="split-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer wants partial shipment ASAP" />
        </Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <p className="text-xs text-muted-foreground">Shipping from on-hand stock decrements inventory once through the ledger and creates an immutable shipment record.</p>
      </div>
    </Dialog>
  );
}
