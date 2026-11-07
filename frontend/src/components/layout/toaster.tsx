import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { dismissToast, type Toast } from '../../features/ui/uiSlice';
import { cn } from '../../lib/utils';

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle } as const;
const TONE = { success: 'text-success', error: 'text-danger', info: 'text-info', warning: 'text-warning' } as const;

export function Toaster() {
  const toasts = useAppSelector((s) => s.ui.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const id = window.setTimeout(() => dispatch(dismissToast(toast.id)), toast.tone === 'error' ? 8000 : 4500);
    return () => window.clearTimeout(id);
  }, [dispatch, toast.id, toast.tone]);
  const Icon = ICON[toast.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-pop"
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[toast.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-muted-foreground">{toast.description}</p>}
      </div>
      <button type="button" onClick={() => dispatch(dismissToast(toast.id))} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss notification">
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
