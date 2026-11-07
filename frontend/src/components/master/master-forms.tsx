import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { errorMessage, useCreateLocationMutation, useCreateSkuMutation, useUpdateLocationMutation, useUpdateSkuMutation } from '../../app/api';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/input';
import { pushToast } from '../../features/ui/uiSlice';
import { locationSchema, skuSchema, type LocationValues, type SkuValues } from '../../lib/schemas';
import type { Location, Sku } from '../../lib/types';

export function SkuFormDialog({ open, onClose, sku }: { open: boolean; onClose: () => void; sku?: Sku }) {
  const dispatch = useAppDispatch();
  const [create, cState] = useCreateSkuMutation();
  const [update, uState] = useUpdateSkuMutation();
  const editing = !!sku;
  const form = useForm<SkuValues>({
    resolver: zodResolver(skuSchema),
    defaultValues: { skuCode: '', name: '', unitOfMeasure: '', leadTimeDays: '', safetyStockQty: 10 },
  });
  useEffect(() => {
    if (open) {
      form.reset({
        skuCode: sku?.skuCode ?? '',
        name: sku?.name ?? '',
        unitOfMeasure: sku?.unitOfMeasure ?? '',
        leadTimeDays: sku?.leadTimeDays === null || sku?.leadTimeDays === undefined ? '' : String(sku.leadTimeDays),
        safetyStockQty: sku?.safetyStockQty ?? 10,
      });
    }
  }, [open, sku, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    const body = { name: v.name, unitOfMeasure: v.unitOfMeasure || null, leadTimeDays: v.leadTimeDays === '' ? null : Number(v.leadTimeDays), safetyStockQty: Number(v.safetyStockQty) };
    try {
      if (editing && sku) await update({ id: sku.id, version: sku.version, ...body } as never).unwrap();
      else await create({ skuCode: v.skuCode, ...body }).unwrap();
      dispatch(pushToast({ tone: 'success', title: editing ? 'SKU updated' : `SKU ${v.skuCode} created`, description: editing ? 'The change is audited.' : 'It can now be used in receipts and orders.' }));
      onClose();
    } catch (e) {
      form.setError(editing ? 'name' : 'skuCode', { message: errorMessage(e) });
      dispatch(pushToast({ tone: 'error', title: 'SKU not saved', description: errorMessage(e) }));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Edit ${sku?.skuCode}` : 'Create SKU'} description={editing ? 'The SKU code is permanent because it is referenced by history. Other fields are editable.' : 'SKU codes are unique and cannot be changed later.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={cState.isLoading || uState.isLoading}>{editing ? 'Save changes' : 'Create SKU'}</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
        <Field label="SKU code" error={form.formState.errors.skuCode?.message} htmlFor="sku-code"><Input id="sku-code" disabled={editing} {...form.register('skuCode')} /></Field>
        <Field label="Product name" error={form.formState.errors.name?.message} htmlFor="sku-name"><Input id="sku-name" {...form.register('name')} /></Field>
        <Field label="Unit of measure" hint="Optional, e.g. EA, CS, KG" htmlFor="sku-uom"><Input id="sku-uom" {...form.register('unitOfMeasure')} /></Field>
        <Field label="Lead time (days)" error={form.formState.errors.leadTimeDays?.message} hint="Optional. Used to estimate promises for backordered units." htmlFor="sku-lead"><Input id="sku-lead" inputMode="numeric" {...form.register('leadTimeDays')} /></Field>
        <Field label="Safety stock (units)" error={form.formState.errors.safetyStockQty?.message} hint="Stock at or below this ATP is flagged as low." htmlFor="sku-safety"><Input id="sku-safety" type="number" min={0} {...form.register('safetyStockQty')} /></Field>
      </form>
    </Dialog>
  );
}

export function LocationFormDialog({ open, onClose, location }: { open: boolean; onClose: () => void; location?: Location }) {
  const dispatch = useAppDispatch();
  const [create, cState] = useCreateLocationMutation();
  const [update, uState] = useUpdateLocationMutation();
  const editing = !!location;
  const form = useForm<LocationValues>({ resolver: zodResolver(locationSchema), defaultValues: { locationCode: '', name: '', timezone: '' } });
  useEffect(() => {
    if (open) form.reset({ locationCode: location?.locationCode ?? '', name: location?.name ?? '', timezone: location?.timezone ?? '' });
  }, [open, location, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (editing && location) await update({ id: location.id, version: location.version, name: v.name, timezone: v.timezone || null }).unwrap();
      else await create({ locationCode: v.locationCode, name: v.name, timezone: v.timezone || null }).unwrap();
      dispatch(pushToast({ tone: 'success', title: editing ? 'Location updated' : `Location ${v.locationCode} created` }));
      onClose();
    } catch (e) {
      form.setError(editing ? 'name' : 'locationCode', { message: errorMessage(e) });
      dispatch(pushToast({ tone: 'error', title: 'Location not saved', description: errorMessage(e) }));
    }
  });

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Edit ${location?.locationCode}` : 'Create location'} description="Warehouses are where stock is held and receipts land. Codes are permanent."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={cState.isLoading || uState.isLoading}>{editing ? 'Save changes' : 'Create location'}</Button></>}>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
        <Field label="Location code" error={form.formState.errors.locationCode?.message} htmlFor="loc-code" hint="Example: NJ"><Input id="loc-code" disabled={editing} {...form.register('locationCode')} /></Field>
        <Field label="Name" error={form.formState.errors.name?.message} htmlFor="loc-name"><Input id="loc-name" {...form.register('name')} /></Field>
        <Field label="Timezone" hint="IANA name, e.g. America/New_York" htmlFor="loc-tz"><Input id="loc-tz" {...form.register('timezone')} /></Field>
      </form>
    </Dialog>
  );
}
