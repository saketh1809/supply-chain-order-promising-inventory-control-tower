import { Badge } from '../ui/badge';
import { humanize } from '../../lib/utils';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'dark';

const ORDER: Record<string, Tone> = { DRAFT: 'neutral', CONFIRMED: 'info', FULFILLING: 'info', SHIPPED: 'success', CANCELED: 'neutral' };
const ALLOC: Record<string, Tone> = {
  FULLY_ALLOCATED: 'success',
  PARTIALLY_ALLOCATED: 'warning',
  BACKORDERED: 'danger',
  UNALLOCATED: 'neutral',
  SHIPPED: 'success',
  NOT_APPLICABLE: 'neutral',
};
const RISK: Record<string, Tone> = { ON_TRACK: 'success', AT_RISK: 'warning', CRITICAL: 'danger' };
const RECEIPT: Record<string, Tone> = { PLANNED: 'neutral', IN_TRANSIT: 'info', RECEIVED: 'success', CANCELED: 'neutral' };
const SEVERITY: Record<string, Tone> = { CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral' };
const PRIORITY: Record<string, Tone> = { HIGH: 'dark', MED: 'info', LOW: 'neutral' };
const STOCK: Record<string, Tone> = { HEALTHY: 'success', LOW_STOCK: 'warning', SHORTAGE: 'danger', INCOMING_ONLY: 'info', OUT_OF_STOCK: 'danger' };

const LABELS: Record<string, string> = {
  MED: 'Medium',
  FULLY_ALLOCATED: 'Fully allocated',
  PARTIALLY_ALLOCATED: 'Partially allocated',
  NOT_APPLICABLE: 'N/A',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  INCOMING_ONLY: 'Incoming only',
  OUT_OF_STOCK: 'Out of stock',
  LOW_STOCK: 'Low stock',
  IN_TRANSIT: 'In transit',
};

function Pill({ map, value, className }: { map: Record<string, Tone>; value: string; className?: string }) {
  return (
    <Badge tone={map[value] ?? 'neutral'} className={className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {LABELS[value] ?? humanize(value)}
    </Badge>
  );
}

export const OrderStatusBadge = ({ value }: { value: string }) => <Pill map={ORDER} value={value} />;
export const AllocationBadge = ({ value }: { value: string }) => <Pill map={ALLOC} value={value} />;
export const RiskBadge = ({ value }: { value: string }) => <Pill map={RISK} value={value} />;
export const ReceiptBadge = ({ value }: { value: string }) => <Pill map={RECEIPT} value={value} className={value === 'CANCELED' ? 'line-through' : undefined} />;
export const SeverityBadge = ({ value }: { value: string }) => <Pill map={SEVERITY} value={value} />;
export const PriorityBadge = ({ value }: { value: string }) => <Pill map={PRIORITY} value={value} />;
export const StockBadge = ({ value }: { value: string }) => <Pill map={STOCK} value={value} />;
export const ExceptionTypeLabel = ({ value }: { value: string }) => <span className="text-sm">{humanize(value)}</span>;
