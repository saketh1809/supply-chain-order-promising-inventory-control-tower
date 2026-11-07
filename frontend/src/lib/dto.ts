import type { AllocationStatus, ExceptionType, OrderStatus, Priority, ReceiptStatus, RiskLevel, Severity, StockStatus } from './types';

export interface OrderListItem {
  id: number;
  orderNumber: string;
  customer: string;
  priority: Priority;
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  riskLevel: RiskLevel;
  createdAt: string;
  requestedShipDate: string | null;
  promisedShipDate: string | null;
  backorderedQty: number;
  lineCount: number;
  unitsRequested: number;
  openExceptions: number;
  topExceptionType: ExceptionType | null;
  isLate: boolean;
}

export interface OrderLineDetail {
  id: number;
  lineNumber: number;
  sku: { id: number; skuCode: string; name: string; leadTimeDays: number | null };
  requestedQty: number;
  shippedQty: number;
  openQty: number;
  allocatedQty: number;
  backorderedQty: number;
  allocationStatus: AllocationStatus;
  preferredLocation: { id: number; locationCode: string } | null;
  fulfillmentLocation: { id: number; locationCode: string } | null;
  calculatedPromisedDate: string | null;
  manualPromisedDate: string | null;
  manualPromiseReason: string | null;
  effectivePromisedDate: string | null;
  earliestShipDate: string | null;
  expectedCompletionDate: string | null;
  version: number;
  allocations: Array<{
    id: number;
    location: string;
    source: 'ON_HAND' | 'INBOUND';
    receiptId: number | null;
    receiptNumber: string | null;
    receiptStatus: ReceiptStatus | null;
    receiptExpectedArrival: string | null;
    quantity: number;
    availableDate: string;
  }>;
}

export interface OrderDetail {
  id: number;
  orderNumber: string;
  customer: { id: number; name: string; preferredLocation: { id: number; locationCode: string } | null };
  priority: Priority;
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  riskLevel: RiskLevel;
  preferredLocation: { id: number; locationCode: string } | null;
  createdAt: string;
  confirmedAt: string | null;
  shippedAt: string | null;
  canceledAt: string | null;
  requestedShipDate: string | null;
  promisedShipDate: string | null;
  version: number;
  communicationCount: number;
  isEditable: boolean;
  lines: OrderLineDetail[];
  summary: {
    lineCount: number;
    fullyAllocatedLines: number;
    partiallyAllocatedLines: number;
    backorderedLines: number;
    totalRequested: number;
    totalAllocated: number;
    totalShipped: number;
    backorderedUnits: number;
    earliestPossibleShipment: string | null;
    expectedCompletionDate: string | null;
    requestedShipDate: string | null;
    daysLate: number;
    asOf: string;
  };
  supplyDependencies: Array<{
    receiptId: number;
    receiptNumber: string;
    status: string;
    expectedArrival: string;
    originalExpectedArrival: string;
    delayDays: number;
    location: string;
    sku: string;
    quantity: number;
    lines: number[];
  }>;
  shipments: Array<{
    id: number;
    shipmentNumber: string;
    shippedAt: string;
    location: string;
    isSplit: boolean;
    reason: string | null;
    lines: Array<{ sku: string; quantity: number; promisedDate: string | null; onTime: boolean }>;
  }>;
  openExceptions: Array<{ id: number; exceptionNumber: string; type: ExceptionType; severity: Severity; affectedQty: number }>;
}

export interface TimelineEvent {
  at: string;
  type: string;
  label: string;
  sku: string | null;
  location: string | null;
  quantity: number | null;
  reference: string | null;
  atpImpact: number | null;
  note: string | null;
  source: string;
}

export interface ExceptionRow {
  id: number;
  exceptionNumber: string;
  type: ExceptionType;
  severity: Severity;
  priority: Priority;
  status: 'OPEN' | 'RESOLVED';
  order: { id: number; orderNumber: string; status: OrderStatus };
  customer: string;
  orderLineId: number | null;
  sku: { id: number; skuCode: string; name: string };
  location: { id: number; locationCode: string } | null;
  receipt: { id: number; receiptNumber: string; status: ReceiptStatus; expectedArrival: string | null } | null;
  affectedQty: number;
  currentPromisedDate: string | null;
  requestedShipDate: string | null;
  recommendedAction: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ExceptionDetail extends ExceptionRow {
  details: Record<string, unknown> | null;
  resolutionNote: string | null;
  resolutionKind: string | null;
  resolvedBy: { id: number; name: string } | null;
  currentAllocations: Array<{ location: string; source: string; receiptNumber: string | null; quantity: number; availableDate: string | null }>;
  history: Array<{ id: string; action: string; previousValue: unknown; newValue: unknown; reason: string | null; user: { id: number; name: string } | null; timestamp: string }>;
}

export interface ReceiptRow {
  id: number;
  receiptNumber: string;
  skuId: number;
  locationId: number;
  skuCode: string;
  productName: string;
  locationCode: string;
  quantity: number;
  status: ReceiptStatus;
  expectedArrivalTime: string;
  originalExpectedArrivalTime: string;
  delayDays: number;
  receivedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  version: number;
}

export interface InventoryRow {
  balanceId: number;
  skuId: number;
  skuCode: string;
  productName: string;
  locationId: number;
  locationCode: string;
  onHand: number;
  allocated: number;
  allocatedTotal: number;
  available: number;
  incoming: number;
  nextArrival: string | null;
  atp: number;
  status: StockStatus;
  safetyStock: number;
  lastUpdated: string;
}

export interface AtpProjectionPoint {
  date: string;
  supply: number;
  demand: number;
  atp: number;
  delta: number;
}

export interface MovementSummary {
  lineId: number;
  orderNumber: string;
  sku: string;
  requestedQty: number;
  backorderedBefore: number;
  backorderedAfter: number;
  promiseBefore: string | null;
  promiseAfter: string | null;
  fulfillmentBefore: string | null;
  fulfillmentAfter: string | null;
}

export interface AiInteraction {
  id: number;
  interactionId: string;
  type: 'PLANNER_NOTE' | 'CUSTOMER_COMMUNICATION' | 'EXCEPTION_SUMMARY' | 'SHORTAGE_INSIGHTS';
  status: 'GENERATED' | 'PROPOSED' | 'APPROVED' | 'PARTIALLY_APPLIED' | 'REJECTED' | 'STALE' | 'FAILED';
  provider: string;
  model: string;
  inputText: string;
  output: any;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface SkuSummary {
  id: number;
  skuCode: string;
  name: string;
  unitOfMeasure: string | null;
  leadTimeDays: number | null;
  safetyStockQty: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  stock: { onHand: number; allocated: number; inbound: number; atp: number } | null;
}

export interface DashboardSummary {
  asOf: string;
  generatedAt: string;
  kpis: {
    activeOrders: Kpi;
    ordersAtRisk: Kpi;
    availableInventory: Kpi & { onHandCurrent?: number; onHandPrevious?: number; note?: string };
    backorderedUnits: Kpi;
    incomingReceipts: Kpi & { units?: number; previousUnits?: number };
    onTimePromiseRate: { current: number | null; previous: number | null; delta: number | null; unit: 'pct'; label: string; promiseCompliance: number | null; trend: Array<number | null>; href: string; key: string };
  };
  sections: {
    orderFulfillment: { statusCounts: Array<{ status: OrderStatus; count: number }>; series: Array<{ date: string; onTime: number; late: number; newOrders: number; shipped: number }>; onTimeLast30: { total: number; onTime: number; rate: number | null }; onTimePrevious30: { total: number; onTime: number; rate: number | null } };
    incomingSupply: { openReceipts: number; delayed: number; canceledLast30Days: number; upcoming: IncomingRow[]; timeline: Array<{ date: string; units: number; receipts: number }> };
    fulfillmentRisk: {
      atRisk: Array<{ id: number; orderNumber: string; customer: string; priority: Priority; riskLevel: RiskLevel; backorderedQty: number; promised: string | null }>;
      highPriority: Array<{ id: number; orderNumber: string; customer: string; riskLevel: RiskLevel; backorderedQty: number }>;
      promiseFailures: Array<{ orderNumber: string; customer: string; requested: string; promised: string; daysLate: number; priority: Priority }>;
      exceptions: { open: number; bySeverity: Array<{ severity: Severity; count: number }>; byType: Array<{ type: ExceptionType; count: number }> };
    };
  };
  recentActivity: Array<{ id: string; action: string; entityType: string; entityId: string; user: string; reason: string | null; timestamp: string }>;
}

export interface IncomingRow {
  id: number;
  receiptNumber: string;
  sku: string;
  location: string;
  quantity: number;
  status: ReceiptStatus;
  expectedArrival: string;
  delayDays: number;
}

export interface Kpi {
  current: number | null;
  previous: number | null;
  delta: number | null;
  unit: string;
  label: string;
  trend: Array<number | null>;
  href: string;
  key: string;
  note?: string;
}

export type Kpis = DashboardSummary['kpis'];
