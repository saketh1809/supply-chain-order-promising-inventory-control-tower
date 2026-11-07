import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap', {
  variants: {
    tone: {
      success: 'border-success/25 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/10 text-warning',
      danger: 'border-danger/25 bg-danger/10 text-danger',
      info: 'border-info/25 bg-info/10 text-info',
      neutral: 'border-border bg-muted text-muted-foreground',
      dark: 'border-primary/20 bg-primary text-primary-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ tone, className, children }: VariantProps<typeof badgeVariants> & { className?: string; children: React.ReactNode }) {
  return <span className={cn(badgeVariants({ tone }), className)}>{children}</span>;
}
