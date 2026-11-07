import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />}
          {c.to && i < items.length - 1 ? (
            <Link to={c.to} className="truncate hover:text-foreground hover:underline">
              {c.label}
            </Link>
          ) : (
            <span aria-current={i === items.length - 1 ? 'page' : undefined} className="truncate text-foreground/80">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
