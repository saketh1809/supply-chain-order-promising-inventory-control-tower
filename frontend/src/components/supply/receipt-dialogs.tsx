import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useEffect, useState } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useCancelReceiptMutation, useCreateReceiptMutation, useListLocationsQuery, useListSkusQuery, useUpdateReceiptMutation } from '../../app/api';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, Input, Select, Textarea } from '../ui/input';
import { pushToast } from '../../features/ui/uiSlice';
import { receiptSchema, type ReceiptValues } from '../../lib/schemas';
import { reasonSchema } from '../../lib/schemas';
import { fmtDate } from '../../lib/utils';

export function ReceiptFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const skus = useListSkusQuery({ pageSize: 200, sort: 'skuCode' });
  const locations = useListLocationsQuery({ pageSize: 200, status: 'active' });
  const [create, state] = useCreateReceiptMutation();
  const form = useForm<ReceiptValues>({
    resolver: zodResolver(receiptSchema),
    defaultValues: { receiptNumber: '', skuId: '', locationId: '', quantity: 1, expectedArrivalTime: '', status: 'PLANNED' },
  });
  useEffect(() => {
    if (open) form.reset({ receiptNumber: '', skuId: '', locationId: '', quantity: 1, expectedArrivalTime: '', status: 'PLANNED' });
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await create({ receiptNumber: v.receiptNumber, skuId: Number(v.skuId), locationId: Number(v.locationId), quantity: Number(v.quantity), expectedArrivalTime: v.expectedArrivalTime, status: v.status }).unwrap();
      dispatch(pushToast({ tone: 'success', title: `Receipt ${res.receiptNumber} created`, description: `Eligible for ATP from ${fmtDate(res.expectedArrivalTime.slice(0, 10))}. ${res.recalculation.affectedOrders} order(s) recalculated.` }));
      onClose();
    } catch (e) {
      form.setError('receiptNumber', { message: errorMessage(e) });
      dispatch(pushToast({ tone: 'error', title: 'Receipt not created', description: errorMessage(e) }));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Create inbound receipt" description="A PLANNED or IN_TRANSIT receipt counts as future supply in ATP until it is received or canceled."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={state.isLoading}>Create receipt</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
        <Field label="Receipt / PO number" error={form.formState.errors.receiptNumber?.message} htmlFor="r-num" hint="Unique. Example: PO-22"><Input id="r-num" {...form.register('receiptNumber')} /></Field>
        <Field label="Status" htmlFor="r-status"><Select id="r-status" {...form.register('status')}><option value="PLANNED">Planned</option><option value="IN_TRANSIT">In transit</option></Select></Field>
        <Field label="SKU" error={form.formState.errors.skuId?.message} htmlFor="r-sku"><Select id="r-sku" {...form.register('skuId')}><option value="">Select a SKU…</option>{skus.data?.items.map((s) => <option key={s.id} value={s.id}>{s.skuCode} · {s.name}</option>)}</Select></Field>
        <Field label="Destination warehouse" error={form.formState.errors.locationId?.message} htmlFor="r-loc"><Select id="r-loc" {...form.register('locationId')}><option value="">Select…</option>{locations.data?.items.map((l: { id: number; locationCode: string; name: string }) => <option key={l.id} value={l.id}>{l.locationCode} · {l.name}</option>)}</Select></Field>
        <Field label="Quantity" error={form.formState.errors.quantity?.message} htmlFor="r-qty"><Input id="r-qty" type="number" min={1} {...form.register('quantity')} /></Field>
        <Field label="Expected arrival" error={form.formState.errors.expectedArrivalTime?.message} htmlFor="r-date"><Input id="r-date" type="date" {...form.register('expectedArrivalTime')} /></Field>
      </form>
    </Dialog>
  );
}

export function ChangeArrivalDialog({ open, onClose, receipt }: { open: boolean; onClose: () => void; receipt: { id: number; receiptNumber: string; expectedArrivalTime: string; version: number } }) {
  const dispatch = useAppDispatch();
  const [update, state] = useUpdateReceiptMutation();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDate(receipt.expectedArrivalTime.slice(0, 10));
      setReason('');
      setError(null);
    }
  }, [open, receipt.expectedArrivalTime]);

  const onConfirm = async () => {
    const parsed = reasonSchema.safeParse({ reason });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Choose a valid date');
    try {
      const res = await update({ id: receipt.id, expectedArrivalTime: date, reason: parsed.data.reason, version: receipt.version }).unwrap();
      dispatch(pushToast({ tone: res.delta.direction === 'LATER' ? 'warning' : 'success', title: `${receipt.receiptNumber} arrival ${res.delta.direction === 'LATER' ? 'delayed' : 'moved earlier'}`, description: `Promises recalculated for ${res.recalculation.affectedOrders} order(s).` }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Change expected arrival · ${receipt.receiptNumber}`} description="Moving the date later delays dependent orders; the change, reason and recalculated promises are all audited."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onConfirm} loading={state.isLoading}>Save arrival</Button></>}>
      <div className="space-y-4">
        <Field label="New expected arrival" htmlFor="ca-date"><Input id="ca-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Reason (required)" htmlFor="ca-reason"><Textarea id="ca-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vendor reported a port delay" /></Field>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

export function CancelReceiptDialog({ open, onClose, receipt }: { open: boolean; onClose: () => void; receipt: { id: number; receiptNumber: string } }) {
  const dispatch = useAppDispatch();
  const [cancel, state] = useCancelReceiptMutation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(''); setError(null); } }, [open]);
  const onConfirm = async () => {
    const parsed = reasonSchema.safeParse({ reason });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    try {
      const res = await cancel({ id: receipt.id, reason: parsed.data.reason }).unwrap();
      const n = res.dependentLines?.length ?? 0;
      dispatch(pushToast({ tone: n ? 'warning' : 'success', title: `${receipt.receiptNumber} canceled`, description: n ? `${n} order line(s) lost supply. Exceptions were raised in the queue.` : 'No order depended on this receipt.' }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Cancel ${receipt.receiptNumber}?`} description="Canceled supply leaves the ATP projection immediately. Dependent order lines get CANCELED_INBOUND_DEPENDENCY exceptions."
      footer={<><Button variant="secondary" onClick={onClose}>Keep receipt</Button><Button variant="danger" onClick={onConfirm} loading={state.isLoading}>Cancel receipt</Button></>}>
      <Field label="Cancellation reason (required)" htmlFor="cr-reason" error={error ?? undefined}><Textarea id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}
