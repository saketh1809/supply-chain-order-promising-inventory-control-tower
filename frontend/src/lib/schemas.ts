import { z } from 'zod';

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .or(z.literal(''));

export const orderLineSchema = z.object({
  skuId: z.string().min(1, 'Choose a SKU'),
  quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(1_000_000),
  preferredLocationId: z.string(),
});

export const newOrderSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .min(2, 'Enter an order number')
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits, dot, dash and underscore only'),
  customerName: z.string().trim().min(2, 'Enter the customer name').max(255),
  priority: z.enum(['HIGH', 'MED', 'LOW']),
  requestedShipDate: ymd,
  preferredLocationId: z.string(),
  lines: z.array(orderLineSchema).min(1, 'Add at least one line'),
});
export type NewOrderValues = z.infer<typeof newOrderSchema>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Enter a reason (at least 3 characters)').max(500),
});

export const expediteSchema = z.object({
  receiptId: z.number(),
  newExpectedArrival: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  reason: z.string().trim().min(3, 'A reason is required to expedite a receipt').max(500),
});

export const overrideSchema = z.object({
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  justification: z.string().trim().min(10, 'Justification must be at least 10 characters').max(500),
});

export const adjustmentSchema = z.object({
  skuId: z.string().min(1, 'Choose a SKU'),
  locationId: z.string().min(1, 'Choose a warehouse'),
  mode: z.enum(['INCREASE', 'DECREASE']),
  quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int('Whole units only').min(1, 'Enter at least 1 unit').max(1_000_000),
  reason: z.string().trim().min(5, 'Enter a reason of at least 5 characters').max(500),
});
export type AdjustmentValues = z.infer<typeof adjustmentSchema>;

export const receiptSchema = z.object({
  receiptNumber: z.string().trim().min(2, 'Enter a receipt or PO number').max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits, dot, dash and underscore only'),
  skuId: z.string().min(1, 'Choose a SKU'),
  locationId: z.string().min(1, 'Choose a destination'),
  quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int().min(1, 'Quantity must be at least 1'),
  expectedArrivalTime: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an arrival date'),
  status: z.enum(['PLANNED', 'IN_TRANSIT']),
});
export type ReceiptValues = z.infer<typeof receiptSchema>;

export const skuSchema = z.object({
  skuCode: z.string().trim().min(2, 'Enter a SKU code').max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, digits, dot, dash and underscore only'),
  name: z.string().trim().min(2, 'Enter a product name').max(255),
  unitOfMeasure: z.string().trim().max(32),
  leadTimeDays: z.string().regex(/^\d*$/, 'Whole days only'),
  safetyStockQty: z.coerce.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(1_000_000),
});
export type SkuValues = z.infer<typeof skuSchema>;

export const locationSchema = z.object({
  locationCode: z.string().trim().min(2, 'Enter a code').max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Letters, digits, dash and underscore only'),
  name: z.string().trim().min(2, 'Enter a name').max(255),
  timezone: z.string().trim().max(64),
});
export type LocationValues = z.infer<typeof locationSchema>;

export const communicationSchema = z.object({
  subject: z.string().trim().min(3, 'Enter a subject').max(255),
  body: z.string().trim().min(10, 'The message is too short').max(10000),
});
export type CommunicationValues = z.infer<typeof communicationSchema>;

export const settingsSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the company name').max(255),
  timezone: z.string().trim().min(2).max(64),
  defaultSafetyStock: z.coerce.number().int().min(0).max(100000),
});
export type SettingsValues = z.infer<typeof settingsSchema>;

export const noteSchema = z.object({
  note: z.string().trim().min(10, 'Describe the change in at least 10 characters').max(4000),
});
