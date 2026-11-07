import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { ArrowRight, Eye } from 'lucide-react';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useAdjustInventoryMutation, useListLocationsQuery, useListSkusQuery, usePreviewAdjustmentMutation } from '../../app/api';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, Input, Select, Textarea } from '../ui/input';
import { pushToast } from '../../features/ui/uiSlice';
import { adjustmentSchema, type AdjustmentValues } from '../../lib/schemas';
import { fmtNum } from '../../lib/utils';

export interface AdjustmentDefaults {
  skuId?: number;
  locationId?: number;
}

/** Inventory adjustment workflow: select SKU and warehouse, enter quantity and reason, preview, confirm. */
export function AdjustmentDialog({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: AdjustmentDefaults }) {
  const dispatch = useAppDispatch();
  const skus = useListSkusQuery({ pageSize: 200, sort: 'skuCode' });
  const locations = useListLocationsQuery({ pageSize: 200, status: 'active' });
  const [preview, previewState] = usePreviewAdjustmentMutation();
  const [adjust, adjustState] = useAdjustInventoryMutation();
  const [result, setResult] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const form = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { skuId: '', locationId: '', mode: 'INCREASE', quantity: 1, reason: '' },
  });

  useEffect(() => {
    if (open) {
      form.reset({ skuId: defaults?.skuId ? String(defaults.skuId) : '', locationId: defaults?.locationId ? String(defaults.locationId) : '', mode: 'INCREASE', quantity: 1, reason: '' });
      setPreviewData(null);
    }
  }, [open, defaults?.skuId, defaults?.locationId, form]);

  const toPayload = (v: AdjustmentValues) => ({
    skuId: Number(v.skuId),
    locationId: Number(v.locationId),
    quantityDelta: v.mode === 'INCREASE' ? v.quantity : -v.quantity,
    reason: v.reason,
  });

  const onPreview = form.handleSubmit(async (v) => {
    try {
      setPreviewData(await preview(toPayload(v)).unwrap());
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Preview failed', description: errorMessage(e) }));
    }
  });

  const onConfirm = async () => {
    const v = form.getValues();
    try {
      const res = await adjust(toPayload(v)).unwrap();
      setResult(res);
      dispatch(pushToast({ tone: 'success', title: `${res.adjustmentNumber} posted`, description: `On-hand ${fmtNum(res.previousOnHand)} → ${fmtNum(res.newOnHand)}. ATP recalculated for ${res.recalculation.affectedOrders} order(s).` }));
      onClose();
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Adjustment not posted', description: errorMessage(e) }));
    }
  };

  // Any edit invalidates the preview, so the confirmation always matches what was previewed.
  const invalidate = () => setPreviewData(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Adjust inventory"
      description="Every adjustment is recorded in the append-only ledger with your reason. Preview the result before confirming."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={onPreview} loading={previewState.isLoading}><Eye className="h-4 w-4" /> Preview</Button>
          <Button onClick={onConfirm} loading={adjustState.isLoading} disabled={!previewData || !previewData.valid}>Confirm adjustment</Button>
        </>
      }
    >
      {result ? (
        <p className="text-sm">Posted {result.adjustmentNumber}.</p>
      ) : (
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="SKU" error={form.formState.errors.skuId?.message} htmlFor="adj-sku">
              <Select id="adj-sku" {...form.register('skuId', { onChange: invalidate })}>
                <option value="">Select a SKU…</option>
                {skus.data?.items.map((s) => <option key={s.id} value={s.id}>{s.skuCode} · {s.name}</option>)}
              </Select>
            </Field>
            <Field label="Warehouse" error={form.formState.errors.locationId?.message} htmlFor="adj-loc">
              <Select id="adj-loc" {...form.register('locationId', { onChange: invalidate })}>
                <option value="">Select a warehouse…</option>
                {locations.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}
              </Select>
            </Field>
            <Field label="Direction" htmlFor="adj-mode">
              <Select id="adj-mode" {...form.register('mode', { onChange: invalidate })}>
                <option value="INCREASE">Increase on-hand</option>
                <option value="DECREASE">Decrease on-hand</option>
              </Select>
            </Field>
            <Field label="Quantity (units)" error={form.formState.errors.quantity?.message} htmlFor="adj-qty">
              <Input id="adj-qty" type="number" min={1} {...form.register('quantity', { onChange: invalidate })} />
            </Field>
          </div>
          <Field label="Reason (required)" error={form.formState.errors.reason?.message} htmlFor="adj-reason" hint="Example: Cycle count variance, damaged in receiving, found during audit.">
            <Textarea id="adj-reason" {...form.register('reason', { onChange: invalidate })} />
          </Field>

          {previewData && (
            <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4" aria-live="polite">
              <p className="text-sm font-semibold">Preview</p>
              {!previewData.valid && <p role="alert" className="text-sm text-danger">This change would make on-hand negative. Reduce the quantity.</p>}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <PreviewCell label="On-hand" from={previewData.previousOnHand} to={previewData.newOnHand} />
                <PreviewCell label="Available" from={previewData.availableBefore} to={previewData.availableAfter} />
                <PreviewCell label="ATP" from={previewData.atpBefore} to={previewData.atpAfter} />
                <div>
                  <p className="text-[11px] text-muted-foreground">Order lines affected</p>
                  <p className="tabular mt-0.5 font-semibold">{previewData.changedLines.length}</p>
                </div>
              </div>
              {previewData.changedLines.length > 0 && (
                <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                  {previewData.changedLines.slice(0, 12).map((l: any) => (
                    <li key={l.lineId} className="flex items-center justify-between gap-2">
                      <span>Line #{l.lineId}</span>
                      <span className="tabular">backorder {l.backorderedBefore} → {l.backorderedAfter}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}

function PreviewCell({ label, from, to }: { label: string; from: number; to: number }) {
  const up = to > from;
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 flex items-center gap-1.5 font-semibold">
        <span className="text-muted-foreground">{fmtNum(from)}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className={up ? 'text-success' : to < from ? 'text-danger' : ''}>{fmtNum(to)}</span>
      </p>
    </div>
  );
}
