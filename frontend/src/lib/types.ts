/** Response envelope used by every endpoint. */
export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export type Priority = 'HIGH' | 'MED' | 'LOW';
export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'FULFILLING' | 'SHIPPED' | 'CANCELED';
export type AllocationStatus = 'UNALLOCATED' | 'FULLY_ALLOCATED' | 'PARTIALLY_ALLOCATED' | 'BACKORDERED' | 'SHIPPED' | 'NOT_APPLICABLE';
export type RiskLevel = 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';
export type ReceiptStatus = 'PLANNED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELED';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ExceptionType = 'PROMISE_DATE_AT_RISK' | 'BACKORDER' | 'DELAYED_INBOUND' | 'CANCELED_INBOUND_DEPENDENCY' | 'HIGH_PRIORITY_INSUFFICIENT_STOCK';
export type StockStatus = 'HEALTHY' | 'LOW_STOCK' | 'SHORTAGE' | 'INCOMING_ONLY' | 'OUT_OF_STOCK';

export interface Sku {
  id: number;
  skuCode: string;
  name: string;
  unitOfMeasure: string | null;
  leadTimeDays: number | null;
  safetyStockQty: number;
  version: number;
}
export interface Location {
  id: number;
  locationCode: string;
  name: string;
  timezone: string | null;
  isActive: boolean;
  version: number;
}
