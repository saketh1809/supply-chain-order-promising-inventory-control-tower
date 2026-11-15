import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { AuthError, changePassword, signOut } from '../../features/auth/auth-client';
import { pushToast } from '../../features/ui/uiSlice';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field, Input } from '../ui/input';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'The two passwords do not match' });
type Values = z.infer<typeof schema>;

/** Changing the password signs the user out of every device, so they sign in again with the new one. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector((s) => s.auth.accessToken);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) {
      form.reset();
      setServerError(null);
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    setServerError(null);
    try {
      await changePassword(accessToken ?? '', v.currentPassword, v.newPassword);
      dispatch(pushToast({ tone: 'success', title: 'Password changed', description: 'Sign in again with your new password.' }));
      onClose();
      await signOut(dispatch);
    } catch (e) {
      setServerError(e instanceof AuthError ? e.message : 'Could not change the password. Please try again.');
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change password"
      description="You will be signed out on all devices afterwards."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting} type="button">Change password</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {serverError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{serverError}</p>}
        <Field label="Current password" htmlFor="cp-current" error={errors.currentPassword?.message}>
          <Input id="cp-current" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field label="New password" htmlFor="cp-new" hint="8 to 72 characters." error={errors.newPassword?.message}>
          <Input id="cp-new" type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <Field label="Repeat new password" htmlFor="cp-confirm" error={errors.confirm?.message}>
          <Input id="cp-confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
