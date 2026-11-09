import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import type { ApiEnvelope, ApiErrorBody, Location, PageMeta, Sku } from '../lib/types';
import type {
  AiInteraction,
  AtpProjectionPoint,
  DashboardSummary,
  ExceptionDetail,
  ExceptionRow,
  InventoryRow,
  MovementSummary,
  OrderDetail,
  OrderListItem,
  ReceiptRow,
  SkuSummary,
  TimelineEvent,
} from '../lib/dto';

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

/** Turns an RTK Query error into a sentence a planner can act on. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as FetchBaseQueryError & { data?: unknown; message?: string };
  if ('status' in e && e.status === 'FETCH_ERROR') return 'The API is unreachable. Check that the backend is running.';
  if ('data' in e && e.data && typeof e.data === 'object' && 'error' in (e.data as object)) {
    const body = e.data as ApiErrorBody;
    const issues = (body.error.details as { issues?: string[] } | null)?.issues;
    return issues?.length ? issues.join(' ') : body.error.message || fallback;
  }
  return e.message ?? fallback;
}

export function errorCode(err: unknown): string | undefined {
  const e = err as { data?: ApiErrorBody } | undefined;
  return e?.data?.error?.code;
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${import.meta.env.VITE_API_BASE ?? ''}/api/v1`,
  prepareHeaders: (headers, { getState }) => {
    const actingUserId = (getState() as { ui: { actingUserId: number } }).ui.actingUserId;
    headers.set('x-user-id', String(actingUserId));
    headers.set('content-type', 'application/json');
    return headers;
  },
});

/** Unwraps the { success, data, meta } envelope so endpoints receive the payload directly. */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await rawBaseQuery(args, api, extra);
  if (result.error) return result;
  const body = result.data as ApiEnvelope<unknown>;
  if (body && typeof body === 'object' && 'meta' in body && body.meta) {
    return { data: { items: body.data, meta: body.meta } };
  }
  return { data: body?.data };
};

type Q = Record<string, string | number | boolean | undefined | null>;
const qs = (params: Q = {}) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

/** Every planner/AI/inventory write refreshes all read models: the source of truth is the server, so
 *  no client-side guessing of derived numbers is ever needed. */
const TAG_TYPES = ['Order', 'Inventory', 'Receipt', 'Exception', 'Dashboard', 'Atp', 'Allocation', 'Audit', 'AI', 'Sku', 'Location', 'Customer', 'Settings'] as const;
const MUTATION_INVALIDATES = TAG_TYPES.map((type) => ({ type }));

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [...TAG_TYPES],
  endpoints: (b) => ({
    // ---------------- dashboard
    dashboardSummary: b.query<DashboardSummary, number | void>({
      query: (days) => `/dashboard/summary${qs({ days: days ?? undefined })}`,
      providesTags: [{ type: 'Dashboard', id: 'SUMMARY' }],
    }),
    inventoryHealth: b.query<any, void>({
      query: () => '/dashboard/inventory-health',
      providesTags: [{ type: 'Dashboard', id: 'HEALTH' }],
    }),
    fulfillmentTrends: b.query<{ asOf: string; days: number; activeOrdersNow: number; series: Array<{ date: string; ordersCreated: number; ordersShipped: number; unitsOnTime: number; unitsLate: number; onTimeRate: number | null }> }, number | void>({
      query: (days) => `/dashboard/fulfillment-trends${qs({ days: days ?? undefined })}`,
      providesTags: [{ type: 'Dashboard', id: 'TRENDS' }],
    }),

    // ---------------- orders
    listOrders: b.query<Paged<OrderListItem>, Q>({
      query: (params) => `/orders${qs(params)}`,
      providesTags: (res) => [{ type: 'Order', id: 'LIST' }, ...(res?.items.map((o) => ({ type: 'Order' as const, id: o.id })) ?? [])],
    }),
    getOrder: b.query<OrderDetail, number>({
      query: (id) => `/orders/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Order', id }],
    }),
    getOrderTimeline: b.query<{ orderNumber: string; events: TimelineEvent[]; promiseExplanations: Array<{ lineId: number; lineNumber: number; sku: string; promised: string | null; allocations: string[]; backorderedQty: number; explanation: string }> }, { id: number; skuId?: number; locationId?: number }>({
      query: ({ id, ...params }) => `/orders/${id}/timeline${qs(params)}`,
      providesTags: (_r, _e, a) => [{ type: 'Order', id: a.id }],
    }),
    previewOrder: b.mutation<any, Record<string, unknown>>({
      query: (body) => ({ url: '/orders/preview', method: 'POST', body }),
    }),
    createOrder: b.mutation<OrderDetail, Record<string, unknown>>({
      query: (body) => ({ url: '/orders', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    updateOrder: b.mutation<OrderDetail, { id: number } & Record<string, unknown>>({
      query: ({ id, ...body }) => ({ url: `/orders/${id}`, method: 'PATCH', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    confirmOrder: b.mutation<OrderDetail, { id: number; version?: number }>({
      query: ({ id, ...body }) => ({ url: `/orders/${id}/confirm`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    cancelOrder: b.mutation<any, { id: number; reason: string; version?: number }>({
      query: ({ id, ...body }) => ({ url: `/orders/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    shipOrder: b.mutation<any, { id: number; lines: Array<{ orderLineId: number; quantity: number }>; reason?: string; isSplit?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/orders/${id}/ship`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    getOrderCommunications: b.query<Array<{ id: number; subject: string; body: string; status: string; sentAt: string | null; createdBy: string | null; aiGenerated: boolean; createdAt: string }>, number>({
      query: (id) => `/orders/${id}/communications`,
      providesTags: (_r, _e, id) => [{ type: 'Order', id }],
    }),
    recordCommunication: b.mutation<any, { id: number; subject: string; body: string; aiInteractionId?: number }>({
      query: ({ id, ...body }) => ({ url: `/orders/${id}/communications`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),

    // ---------------- products, locations, customers
    listSkus: b.query<Paged<SkuSummary>, Q>({
      query: (params) => `/skus${qs(params)}`,
      providesTags: [{ type: 'Sku', id: 'LIST' }],
    }),
    getSku: b.query<any, number>({
      query: (id) => `/skus/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Sku', id }],
    }),
    createSku: b.mutation<Sku, Partial<Sku> & { skuCode: string; name: string }>({
      query: (body) => ({ url: '/skus', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    updateSku: b.mutation<Sku, { id: number } & Partial<Sku>>({
      query: ({ id, ...body }) => ({ url: `/skus/${id}`, method: 'PATCH', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    deleteSku: b.mutation<{ id: number; deleted: boolean }, number>({
      query: (id) => ({ url: `/skus/${id}`, method: 'DELETE' }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    listLocations: b.query<Paged<any>, Q>({
      query: (params) => `/locations${qs(params)}`,
      providesTags: [{ type: 'Location', id: 'LIST' }],
    }),
    getLocation: b.query<any, number>({
      query: (id) => `/locations/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Location', id }],
    }),
    createLocation: b.mutation<Location, { locationCode: string; name: string; timezone?: string | null }>({
      query: (body) => ({ url: '/locations', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    updateLocation: b.mutation<Location, { id: number } & Partial<Location>>({
      query: ({ id, ...body }) => ({ url: `/locations/${id}`, method: 'PATCH', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    listCustomers: b.query<Array<{ id: number; name: string; preferredLocation: { id: number; locationCode: string } | null; orderCount: number }>, string | void>({
      query: (search) => `/customers${qs({ search: search ?? undefined })}`,
      providesTags: [{ type: 'Customer', id: 'LIST' }],
    }),
    setCustomerPreferredLocation: b.mutation<any, { id: number; locationId: number | null }>({
      query: ({ id, ...body }) => ({ url: `/customers/${id}/preferred-location`, method: 'PATCH', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),

    // ---------------- inventory & ATP
    listInventory: b.query<Paged<InventoryRow> & { summary: { rows: number; onHand: number; allocated: number; available: number; incoming: number; lowOrShort: number } }, Q>({
      query: (params) => `/inventory${qs(params)}`,
      providesTags: [{ type: 'Inventory', id: 'LIST' }],
    }),
    getInventoryItem: b.query<any, number>({
      query: (id) => `/inventory/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Inventory', id }],
    }),
    previewAdjustment: b.mutation<any, { skuId: number; locationId: number; quantityDelta: number; reason: string }>({
      query: (body) => ({ url: '/inventory/adjustments/preview', method: 'POST', body }),
    }),
    adjustInventory: b.mutation<any, { skuId: number; locationId: number; quantityDelta: number; reason: string; expectedVersion?: number }>({
      query: (body) => ({ url: '/inventory/adjustments', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    atp: b.query<{ asOf: string; sku: { id: number; skuCode: string; name: string; safetyStockQty: number }; byLocation: Array<{ locationId: number; locationCode: string; onHand: number; allocated: number; available: number; incoming: number; atp: number; formula: string }>; total: { onHand: number; atp: number }; timeline: AtpProjectionPoint[] }, { skuId: number; locationId?: number }>({
      query: (params) => `/atp${qs(params)}`,
      providesTags: [{ type: 'Atp', id: 'LIST' }],
    }),
    listAllocations: b.query<Paged<any>, Q>({
      query: (params) => `/allocations${qs(params)}`,
      providesTags: [{ type: 'Allocation', id: 'LIST' }],
    }),
    recalculate: b.mutation<any, { skuIds?: number[] } | void>({
      query: (body) => ({ url: '/allocations/recalculate', method: 'POST', body: body ?? {} }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),

    // ---------------- receipts
    listReceipts: b.query<Paged<ReceiptRow>, Q>({
      query: (params) => `/receipts${qs(params)}`,
      providesTags: [{ type: 'Receipt', id: 'LIST' }],
    }),
    getReceipt: b.query<any, number>({
      query: (id) => `/receipts/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Receipt', id }],
    }),
    createReceipt: b.mutation<any, Record<string, unknown>>({
      query: (body) => ({ url: '/receipts', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    updateReceipt: b.mutation<any, { id: number } & Record<string, unknown>>({
      query: ({ id, ...body }) => ({ url: `/receipts/${id}`, method: 'PATCH', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    markReceiptInTransit: b.mutation<any, number>({
      query: (id) => ({ url: `/receipts/${id}/in-transit`, method: 'POST' }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    receiveReceipt: b.mutation<any, { id: number; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/receipts/${id}/receive`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    cancelReceipt: b.mutation<any, { id: number; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/receipts/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),

    // ---------------- exceptions
    listExceptions: b.query<Paged<ExceptionRow>, Q>({
      query: (params) => `/exceptions${qs(params)}`,
      providesTags: [{ type: 'Exception', id: 'LIST' }],
    }),
    getException: b.query<ExceptionDetail, number>({
      query: (id) => `/exceptions/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Exception', id }],
    }),
    resolveException: b.mutation<ExceptionDetail, { id: number; note: string }>({
      query: ({ id, ...body }) => ({ url: `/exceptions/${id}/resolve`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),

    // ---------------- planner actions
    previewExpedite: b.mutation<{ receipt: any; impact: MovementSummary[] }, { receiptId: number; newExpectedArrival: string; reason: string }>({
      query: (body) => ({ url: '/planner/expedite-receipt/preview', method: 'POST', body }),
    }),
    expediteReceipt: b.mutation<any, { receiptId: number; newExpectedArrival: string; reason: string }>({
      query: (body) => ({ url: '/planner/expedite-receipt', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    previewReassign: b.mutation<{ line: any; options: Array<{ locationId: number; locationCode: string; locationName: string; onHand: number; incoming: number; allocatedQty: number; backorderedQty: number; promisedShipDate: string | null; earliestShipDate: string | null; isCurrent: boolean }>; recommendedLocationId: number | null }, { orderLineId: number }>({
      query: (body) => ({ url: '/planner/reassign-location/preview', method: 'POST', body }),
    }),
    reassignLocation: b.mutation<any, { orderLineId: number; locationId: number | null; reason: string }>({
      query: (body) => ({ url: '/planner/reassign-location', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    overridePromise: b.mutation<any, { orderLineId: number; promisedDate: string | null; justification: string }>({
      query: (body) => ({ url: '/planner/override-promise', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    splitShipment: b.mutation<any, { orderId: number; lines: Array<{ orderLineId: number; quantity: number }>; reason: string }>({
      query: (body) => ({ url: '/planner/split-shipment', method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),

    // ---------------- AI
    plannerNote: b.mutation<AiInteraction, { note: string }>({
      query: (body) => ({ url: '/ai/planner-note', method: 'POST', body }),
      invalidatesTags: [{ type: 'AI', id: 'LIST' }],
    }),
    approvePlannerNote: b.mutation<AiInteraction, { id: number; actionIds?: string[]; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/ai/planner-note/${id}/approve`, method: 'POST', body }),
      invalidatesTags: MUTATION_INVALIDATES,
    }),
    rejectPlannerNote: b.mutation<AiInteraction, { id: number; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/ai/planner-note/${id}/reject`, method: 'POST', body }),
      invalidatesTags: [{ type: 'AI', id: 'LIST' }],
    }),
    customerCommunicationDraft: b.mutation<AiInteraction, { orderId: number; tone?: 'formal' | 'friendly' }>({
      query: (body) => ({ url: '/ai/customer-communication', method: 'POST', body }),
      invalidatesTags: [{ type: 'AI', id: 'LIST' }],
    }),
    exceptionSummary: b.mutation<AiInteraction, { exceptionId: number }>({
      query: (body) => ({ url: '/ai/exception-summary', method: 'POST', body }),
      invalidatesTags: [{ type: 'AI', id: 'LIST' }],
    }),
    shortageInsights: b.query<any, void>({
      query: () => '/ai/shortage-insights',
      providesTags: [{ type: 'AI', id: 'SHORTAGE' }],
    }),
    aiInteractions: b.query<AiInteraction[], { type?: string; status?: string; limit?: number }>({
      query: (params) => `/ai/interactions${qs(params)}`,
      providesTags: [{ type: 'AI', id: 'LIST' }],
    }),

    // ---------------- audit, settings, search
    listAudit: b.query<Paged<any>, Q>({
      query: (params) => `/audit-logs${qs(params)}`,
      providesTags: [{ type: 'Audit', id: 'LIST' }],
    }),
    getSettings: b.query<{ companyName: string; timezone: string; defaultSafetyStock: number }, void>({
      query: () => '/settings',
      providesTags: [{ type: 'Settings', id: 'SELF' }],
    }),
    updateSettings: b.mutation<any, { companyName?: string; timezone?: string; defaultSafetyStock?: number }>({
      query: (body) => ({ url: '/settings', method: 'PATCH', body }),
      invalidatesTags: [{ type: 'Settings', id: 'SELF' }],
    }),
    getUsers: b.query<Array<{ id: number; name: string; email: string; role: string }>, void>({
      query: () => '/users',
    }),
    globalSearch: b.query<{ query: string; skus: Array<{ id: number; label: string; sublabel: string; href: string }>; orders: Array<{ id: number; label: string; sublabel: string; href: string }>; receipts: Array<{ id: number; label: string; sublabel: string; href: string }>; locations: Array<{ id: number; label: string; sublabel: string; href: string }> }, string>({
      query: (q) => `/search${qs({ q })}`,
    }),
  }),
});

export const {
  useDashboardSummaryQuery,
  useInventoryHealthQuery,
  useFulfillmentTrendsQuery,
  useListOrdersQuery,
  useGetOrderQuery,
  useGetOrderTimelineQuery,
  usePreviewOrderMutation,
  useCreateOrderMutation,
  useUpdateOrderMutation,
  useConfirmOrderMutation,
  useCancelOrderMutation,
  useShipOrderMutation,
  useGetOrderCommunicationsQuery,
  useRecordCommunicationMutation,
  useListSkusQuery,
  useGetSkuQuery,
  useCreateSkuMutation,
  useUpdateSkuMutation,
  useDeleteSkuMutation,
  useListLocationsQuery,
  useGetLocationQuery,
  useCreateLocationMutation,
  useUpdateLocationMutation,
  useListCustomersQuery,
  useSetCustomerPreferredLocationMutation,
  useListInventoryQuery,
  useGetInventoryItemQuery,
  usePreviewAdjustmentMutation,
  useAdjustInventoryMutation,
  useAtpQuery,
  useListAllocationsQuery,
  useRecalculateMutation,
  useListReceiptsQuery,
  useGetReceiptQuery,
  useCreateReceiptMutation,
  useUpdateReceiptMutation,
  useMarkReceiptInTransitMutation,
  useReceiveReceiptMutation,
  useCancelReceiptMutation,
  useListExceptionsQuery,
  useGetExceptionQuery,
  useResolveExceptionMutation,
  usePreviewExpediteMutation,
  useExpediteReceiptMutation,
  usePreviewReassignMutation,
  useReassignLocationMutation,
  useOverridePromiseMutation,
  useSplitShipmentMutation,
  usePlannerNoteMutation,
  useApprovePlannerNoteMutation,
  useRejectPlannerNoteMutation,
  useCustomerCommunicationDraftMutation,
  useExceptionSummaryMutation,
  useShortageInsightsQuery,
  useAiInteractionsQuery,
  useListAuditQuery,
  useGetSettingsQuery,
  useUpdateSettingsMutation,
  useGetUsersQuery,
  useGlobalSearchQuery,
} = api;
