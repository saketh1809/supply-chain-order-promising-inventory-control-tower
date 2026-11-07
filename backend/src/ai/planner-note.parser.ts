/**
 * Planner-note understanding.
 *
 * Two interchangeable parsers produce the same `ProposedAction[]` shape:
 *   - heuristicParse: deterministic rules + exact matching against the known receipts, orders and
 *     locations in the database (no guessing of IDs). Always available.
 *   - LLM parse (see AiService): the model is given the same catalog and must answer with JSON.
 * Either way, the output is only a PROPOSAL. Validation against business rules happens in
 * PlannerNoteValidator, and nothing is persisted until a planner approves.
 */
import { z } from 'zod';

export const ACTION_TYPES = ['DELAY_RECEIPT', 'EXPEDITE_RECEIPT', 'REASSIGN_LOCATION', 'SPLIT_SHIPMENT'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const proposedActionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  receiptNumber: z.string().nullable().optional(),
  orderNumber: z.string().nullable().optional(),
  locationCode: z.string().nullable().optional(),
  deltaDays: z.number().int().min(-365).max(365).nullable().optional(),
  newArrival: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(500),
});
export const llmPlanSchema = z.object({
  summary: z.string().max(600),
  actions: z.array(proposedActionSchema).max(10),
});

export type ProposedAction = z.infer<typeof proposedActionSchema>;

export interface CatalogReceipt {
  id: number;
  receiptNumber: string;
  skuCode: string;
  locationCode: string;
  status: string;
  expectedArrival: string;
  quantity: number;
}
export interface CatalogOrder {
  id: number;
  orderNumber: string;
  customer: string;
  status: string;
  skuCodes: string[];
}
export interface CatalogLocation {
  id: number;
  locationCode: string;
  name: string;
}
export interface Catalog {
  receipts: CatalogReceipt[];
  orders: CatalogOrder[];
  locations: CatalogLocation[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds catalog entries whose code appears in the text (normalized, whole-token). */
function mentions<T>(text: string, items: T[], codeOf: (t: T) => string): Array<{ item: T; exact: boolean }> {
  const tokens = text.split(/[^A-Za-z0-9-]+/).filter(Boolean);
  const normTokens = tokens.map((t) => norm(t));
  const out: Array<{ item: T; exact: boolean }> = [];
  for (const item of items) {
    const code = codeOf(item);
    const n = norm(code);
    if (!n) continue;
    if (tokens.some((t) => t.toLowerCase() === code.toLowerCase())) {
      out.push({ item, exact: true });
    } else if (normTokens.includes(n)) {
      out.push({ item, exact: false });
    }
  }
  return out;
}

const DAYS_RE = /(\d{1,3})\s*(?:business\s+)?days?/i;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1 };

function extractDays(sentence: string): number | null {
  const m = sentence.match(DAYS_RE);
  if (m) return Number(m[1]);
  const w = sentence.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a)\s+(?:business\s+)?days?\b/i);
  return w ? WORD_NUM[w[1].toLowerCase()] : null;
}

/**
 * Rule-based parser. Splits the note into sentences and emits proposals per sentence.
 * Mentions are matched against the catalog, so unknown identifiers produce no action.
 */
export function heuristicParse(note: string, catalog: Catalog): { summary: string; actions: ProposedAction[] } {
  const sentences = note.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const actions: ProposedAction[] = [];
  let lastOrder: string | null = null;

  for (const sentence of sentences) {
    const receipts = mentions(sentence, catalog.receipts, (r) => r.receiptNumber);
    const orders = mentions(sentence, catalog.orders, (o) => o.orderNumber);
    const locations = mentions(sentence, catalog.locations, (l) => l.locationCode);
    const namedLocation = catalog.locations.find((l) => l.name && sentence.toLowerCase().includes(l.name.toLowerCase()));
    const location = locations[0] ?? (namedLocation ? { item: namedLocation, exact: false } : null);
    const lower = sentence.toLowerCase();

    if (orders.length) lastOrder = orders[0].item.orderNumber;

    if (receipts.length) {
      const r = receipts[0];
      const days = extractDays(sentence);
      const slips = /\b(slip|slips|slipped|delay|delayed|late|later|push|pushed|postpone|pushes back|pushed back|moves? (back|out)|will arrive later)\b/.test(lower);
      const pulls = /\b(expedite|expedited|pull(ed)? (forward|in)|earlier|sooner|accelerat|ahead of schedule|arrive earlier)\b/.test(lower);
      if (slips || pulls) {
        const delta = days ?? null;
        const type: ActionType = pulls && !slips ? 'EXPEDITE_RECEIPT' : 'DELAY_RECEIPT';
        actions.push({
          type,
          receiptNumber: r.item.receiptNumber,
          orderNumber: null,
          locationCode: null,
          deltaDays: delta,
          newArrival: null,
          confidence: round2((r.exact ? 0.95 : 0.75) * (delta !== null ? 1 : 0.6)),
          evidence: sentence.slice(0, 300),
        });
      }
    }

    // A sentence can refer back to the order named earlier in the note ("The customer wants partial ASAP").
    const targetOrder = orders[0]?.item.orderNumber ?? lastOrder;
    if (orders.length && location && /\b(move|moving|reassign|switch|transfer|route|ship (it )?from|fulfil+ from|to the|to)\b/.test(lower)) {
      if (/\b(move|reassign|switch|transfer|route|fulfil+ from|ship from)\b/.test(lower) || /\bto\s+(the\s+)?\w+/.test(lower)) {
        actions.push({
          type: 'REASSIGN_LOCATION',
          receiptNumber: null,
          orderNumber: orders[0].item.orderNumber,
          locationCode: location.item.locationCode,
          deltaDays: null,
          newArrival: null,
          confidence: round2(orders[0] && location.exact ? 0.9 : 0.7),
          evidence: sentence.slice(0, 300),
        });
      }
    }

    if (targetOrder && /\b(partial|partially|split|part of|some of|ship what|asap|right away|now|available units)\b/i.test(lower) && !/\b(all|full|entire)\b/i.test(lower)) {
      actions.push({
        type: 'SPLIT_SHIPMENT',
        receiptNumber: null,
        orderNumber: targetOrder,
        locationCode: null,
        deltaDays: null,
        newArrival: null,
        confidence: orders[0] ? 0.8 : 0.6,
        evidence: sentence.slice(0, 300),
      });
    }
  }

  const summary =
    actions.length === 0
      ? 'No supply-chain change could be identified with confidence from this note.'
      : `Identified ${actions.length} candidate change(s): ${actions.map((a) => a.type.replace(/_/g, ' ').toLowerCase()).join(', ')}.`;
  // De-duplicate identical proposals produced by overlapping sentences.
  const seen = new Set<string>();
  const unique = actions.filter((a) => {
    const k = `${a.type}|${a.receiptNumber}|${a.orderNumber}|${a.locationCode}|${a.deltaDays}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { summary, actions: unique };
}
