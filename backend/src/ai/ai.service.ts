/**
 * AI service layer.
 *
 * Rules enforced here (see README "AI approval and audit workflow"):
 *  - The model never touches the database. It only returns text/JSON, which is parsed with zod.
 *  - Every interaction is stored (input, structured output, provider, model, decisions).
 *  - Planner-note proposals are validated against business rules and simulated; nothing persists
 *    until a planner approves, and the approval is refused if the plan changed since the proposal.
 *  - Approval applies changes through the same services a human planner uses, so they are audited
 *    and trigger allocation recalculation like any other change.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AllocationService, LineSummary, SimOverrides } from '../allocation/allocation.service';
import { ApiError } from '../common/api/api-error';
import { addDaysYmd, diffDaysYmd, nullableDateToYmd, todayYmd, toYmd } from '../common/dates';
import { PrismaService, Tx } from '../common/prisma/prisma.service';
import { ExceptionsService } from '../exceptions/exceptions.service';
import { OrdersService } from '../orders/orders.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { PlannerService } from '../planner/planner.service';
import { projectAtp, firstShortageDate } from '../allocation/atp';
import { computeAtp } from '../allocation/allocation-engine';
import { AppConfig } from '../common/config/configuration';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider, LlmProvider, OpenAiCompatibleProvider, parseJsonObject } from './llm/llm.provider';
import {
  Catalog,
  heuristicParse,
  llmPlanSchema,
  ProposedAction,
} from './planner-note.parser';
import { PlannerNoteValidator, ValidatedAction } from './planner-note.validator';

export interface AiInteractionView {
  id: number;
  interactionId: string;
  type: string;
  status: string;
  provider: string;
  model: string;
  inputText: string;
  output: unknown;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface ProposalOutput {
  summary: string;
  actions: ValidatedAction[];
  impact: { lines: Array<{ lineId: number; orderNumber: string; sku: string; before: LineSummary | null; after: LineSummary | null }> };
  fingerprint: string;
  sim: { overrides: SerializedOverrides };
  parserUsed: 'heuristic' | 'llm' | 'heuristic-fallback';
  notes: string[];
}

/** Overrides are stored in JSON so an approval can re-validate them later. */
interface SerializedOverrides {
  receiptArrival: Array<[number, string]>;
  lineLocation: Array<[number, number | null]>;
  lineOpenQty: Array<[number, number]>;
  onHandDelta: Array<[string, number]>;
  skuIds: number[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private readonly provider: LlmProvider | null;
  private readonly validator: PlannerNoteValidator;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: AllocationService,
    private readonly exceptions: ExceptionsService,
    private readonly orders: OrdersService,
    private readonly receipts: ReceiptsService,
    private readonly planner: PlannerService,
    config: ConfigService<AppConfig, true>,
  ) {
    const llm = config.get('llm', { infer: true });
    this.provider =
      llm.provider === 'openai' && llm.apiKey
        ? new OpenAiCompatibleProvider(llm.model, llm.apiKey, llm.baseUrl)
        : llm.provider === 'anthropic' && llm.apiKey
          ? new AnthropicProvider(llm.model, llm.apiKey)
          : null;
    this.validator = new PlannerNoteValidator(prisma);
    this.logger.log(`AI provider: ${this.providerName()}`);
  }

  providerName(): string {
    return this.provider ? `${this.provider.name}:${this.provider.model}` : 'heuristic:rules-v1';
  }

  // ==================================================================== 1. planner note

  async plannerNote(note: string, actorId: number): Promise<AiInteractionView> {
    const catalog = await this.loadCatalog();
    const notes: string[] = [];
    let parsed: { summary: string; actions: ProposedAction[] };
    let parserUsed: ProposalOutput['parserUsed'] = 'heuristic';

    if (this.provider) {
      try {
        parsed = await this.llmPlanner(note, catalog);
        parserUsed = 'llm';
      } catch (err) {
        this.logger.warn(`LLM planner parse failed, using rules: ${(err as Error).message}`);
        notes.push('The language model did not return a usable answer; the rule-based parser was used instead.');
        parsed = heuristicParse(note, catalog);
        parserUsed = 'heuristic-fallback';
      }
    } else {
      parsed = heuristicParse(note, catalog);
    }

    const { validated, overrides, skuIds, impact } = await this.prisma.transact(async (tx) => {
      const validated = await this.validator.validate(tx, parsed.actions);
      const valid = validated.filter((v) => v.valid);
      const { overrides, skuIds } = await this.buildOverrides(tx, valid);
      const sim = skuIds.length ? await this.allocation.simulate(tx, skuIds, overrides) : { before: new Map(), after: new Map() };
      const lineIds = [...new Set([...sim.before.keys(), ...sim.after.keys()])].filter((id) => id > 0);
      const lineRows = await tx.orderLine.findMany({ where: { id: { in: lineIds } }, include: { order: true, sku: true } });
      const impact = lineRows
        .map((l) => ({ lineId: l.id, orderNumber: l.order.orderNumber, sku: l.sku.skuCode, before: sim.before.get(l.id) ?? null, after: sim.after.get(l.id) ?? null }))
        .filter((r) => JSON.stringify(r.before) !== JSON.stringify(r.after));
      return { validated, overrides, skuIds, impact };
    });

    const fingerprint = await this.fingerprint(skuIds, validated);
    const output: ProposalOutput = {
      summary: parsed.summary,
      actions: validated,
      impact: { lines: impact },
      fingerprint,
      sim: { overrides: serializeOverrides(overrides, skuIds) },
      parserUsed,
      notes,
    };
    const row = await this.prisma.transact(async (tx) => {
      const row = await tx.aIInteraction.create({
        data: {
          interactionId: randomUUID(),
          type: 'PLANNER_NOTE',
          status: 'PROPOSED',
          inputText: note,
          context: { receiptsConsidered: catalog.receipts.length, ordersConsidered: catalog.orders.length } as Prisma.InputJsonValue,
          output: output as unknown as Prisma.InputJsonValue,
          provider: parserUsed === 'llm' && this.provider ? this.provider.name : 'heuristic',
          model: parserUsed === 'llm' && this.provider ? this.provider.model : 'rules-v1',
          requestedById: actorId,
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'AIInteraction',
        entityId: row.id,
        action: 'AI_SUGGESTION_CREATED',
        newValue: { type: 'PLANNER_NOTE', actions: validated.map((a) => ({ type: a.type, valid: a.valid })) },
        reason: 'AI planner note produced proposed changes (not applied)',
      });
      return row;
    });
    return this.view(row);
  }

  async approvePlannerNote(id: number, body: { actionIds?: string[]; reason?: string }, actorId: number) {
    const row = await this.requireInteraction(id, 'PLANNER_NOTE');
    if (row.status !== 'PROPOSED') {
      throw ApiError.conflict('PROPOSAL_NOT_PENDING', `This proposal is ${row.status} and cannot be approved`);
    }
    const out = row.output as unknown as ProposalOutput;
    const chosen = out.actions.filter((a) => a.valid && (!body.actionIds?.length || body.actionIds.includes(a.id)));
    if (chosen.length === 0) {
      throw ApiError.unprocessable('NO_APPLICABLE_ACTIONS', 'There are no valid actions to approve in this proposal');
    }

    // Stale check: the proposal was computed against a specific plan state. If it changed, refuse.
    const currentPrint = await this.fingerprint(out.sim.overrides.skuIds, out.actions);
    if (currentPrint !== out.fingerprint) {
      await this.prisma.transact(async (tx) => {
        await tx.aIInteraction.update({ where: { id }, data: { status: 'STALE', decidedById: actorId, decidedAt: new Date(), decisionReason: 'Plan changed since the proposal was generated' } });
        await this.audit.record(tx, { userId: actorId, entityType: 'AIInteraction', entityId: id, action: 'AI_PROPOSAL_STALE', reason: 'Plan changed since proposal' });
      });
      throw ApiError.conflict('PROPOSAL_STALE', 'The plan changed after this proposal was generated. Re-run the planner note to see the current impact.');
    }

    const results: Array<{ actionId: string; type: string; status: 'APPLIED' | 'FAILED'; message: string }> = [];
    for (const action of chosen) {
      try {
        const message = await this.applyAction(action, actorId, `AI proposal #${id}: ${body.reason ?? 'approved'}`);
        results.push({ actionId: action.id, type: action.type, status: 'APPLIED', message });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ actionId: action.id, type: action.type, status: 'FAILED', message });
      }
    }
    const allApplied = results.every((r) => r.status === 'APPLIED');
    const status = allApplied ? 'APPROVED' : 'PARTIALLY_APPLIED';
    const updated = await this.prisma.transact(async (tx) => {
      const updated = await tx.aIInteraction.update({
        where: { id },
        data: {
          status,
          decidedById: actorId,
          decidedAt: new Date(),
          decisionReason: body.reason ?? 'Approved by planner',
          output: { ...out, applied: results } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(tx, {
        userId: actorId,
        entityType: 'AIInteraction',
        entityId: id,
        action: 'AI_PROPOSAL_APPROVED',
        newValue: { status, applied: results },
        reason: body.reason ?? 'AI proposal approved by planner',
      });
      return updated;
    });
    return this.view(updated);
  }

  async rejectPlannerNote(id: number, reason: string, actorId: number) {
    const row = await this.requireInteraction(id, 'PLANNER_NOTE');
    if (row.status !== 'PROPOSED') throw ApiError.conflict('PROPOSAL_NOT_PENDING', `This proposal is ${row.status} and cannot be rejected`);
    const updated = await this.prisma.transact(async (tx) => {
      const updated = await tx.aIInteraction.update({
        where: { id },
        data: { status: 'REJECTED', decidedById: actorId, decidedAt: new Date(), decisionReason: reason },
      });
      await this.audit.record(tx, { userId: actorId, entityType: 'AIInteraction', entityId: id, action: 'AI_PROPOSAL_REJECTED', reason });
      return updated;
    });
    return this.view(updated);
  }

  // ==================================================================== 2. customer communication

  async customerCommunication(orderId: number, actorId: number, tone: 'formal' | 'friendly' = 'formal'): Promise<AiInteractionView> {
    const facts = await this.communicationFacts(orderId);
    const system =
      'You draft professional customer shipping updates for a supply-chain planning team. Use only the facts provided. Never invent dates, quantities or warehouses. Respond with JSON: {"subject": string, "body": string}. The body must be plain text, under 180 words.';
    const user = JSON.stringify({ tone, facts });
    let draft = this.templateCommunication(facts);
    let provider = 'heuristic';
    let model = 'rules-v1';
    if (this.provider) {
      try {
        const res = await this.provider.complete({ system, user, expectJson: true, maxTokens: 700 });
        const parsed = z.object({ subject: z.string().min(3).max(200), body: z.string().min(20).max(4000) }).parse(parseJsonObject(res.text));
        draft = parsed;
        provider = this.provider.name;
        model = this.provider.model;
      } catch (err) {
        this.logger.warn(`LLM communication failed, using template: ${(err as Error).message}`);
      }
    }
    const row = await this.prisma.transact(async (tx) => {
      const row = await tx.aIInteraction.create({
        data: {
          interactionId: randomUUID(),
          type: 'CUSTOMER_COMMUNICATION',
          status: 'GENERATED',
          inputText: `Customer update for order ${facts.orderNumber} (${tone})`,
          context: { orderId } as Prisma.InputJsonValue,
          output: { ...draft, facts } as unknown as Prisma.InputJsonValue,
          provider,
          model,
          requestedById: actorId,
        },
      });
      await this.audit.record(tx, { userId: actorId, entityType: 'AIInteraction', entityId: row.id, action: 'AI_DRAFT_GENERATED', reason: 'Customer update drafted (not sent)', metadata: { orderId } });
      return row;
    });
    return this.view(row);
  }

  // ==================================================================== 3. exception summary

  async exceptionSummary(exceptionId: number, actorId: number): Promise<AiInteractionView> {
    const facts = await this.exceptionFacts(exceptionId);
    const system =
      'You explain supply-chain fulfillment exceptions to planners. Use only the facts provided. Advisory only; never claim an action has been taken. Respond with JSON: {"whatHappened": string, "currentPlan": string, "nextBestActions": [{"action": string, "impact": string}], "impact": string}.';
    let summary = this.templateExceptionSummary(facts);
    let provider = 'heuristic';
    let model = 'rules-v1';
    if (this.provider) {
      try {
        const res = await this.provider.complete({ system, user: JSON.stringify(facts), expectJson: true, maxTokens: 900 });
        summary = z
          .object({
            whatHappened: z.string(),
            currentPlan: z.string(),
            nextBestActions: z.array(z.object({ action: z.string(), impact: z.string() })).max(6),
            impact: z.string(),
          })
          .parse(parseJsonObject(res.text));
        provider = this.provider.name;
        model = this.provider.model;
      } catch (err) {
        this.logger.warn(`LLM exception summary failed, using template: ${(err as Error).message}`);
      }
    }
    const row = await this.prisma.transact(async (tx) => {
      const row = await tx.aIInteraction.create({
        data: {
          interactionId: randomUUID(),
          type: 'EXCEPTION_SUMMARY',
          status: 'GENERATED',
          inputText: `Summary for ${facts.exceptionNumber}`,
          context: { exceptionId } as Prisma.InputJsonValue,
          output: { ...summary, facts } as unknown as Prisma.InputJsonValue,
          provider,
          model,
          requestedById: actorId,
        },
      });
      await this.audit.record(tx, { userId: actorId, entityType: 'AIInteraction', entityId: row.id, action: 'AI_SUMMARY_GENERATED', reason: 'Advisory exception summary', metadata: { exceptionId } });
      return row;
    });
    return this.view(row);
  }

  // ==================================================================== 4. stretch: shortage insights

  async shortageInsights() {
    const skus = await this.prisma.sku.findMany({ orderBy: { skuCode: 'asc' } });
    const asOf = todayYmd();
    const insights = [];
    for (const sku of skus) {
      const [balances, inbound, lines, allocs] = await Promise.all([
        this.prisma.inventoryBalance.findMany({ where: { skuId: sku.id }, include: { location: true } }),
        this.prisma.inboundReceipt.findMany({ where: { skuId: sku.id, status: { in: ['PLANNED', 'IN_TRANSIT'] } }, include: { location: true }, orderBy: { expectedArrivalTime: 'asc' } }),
        this.prisma.orderLine.findMany({ where: { skuId: sku.id, order: { status: { in: ['CONFIRMED', 'FULFILLING'] } }, canceledAt: null }, include: { order: true } }),
        this.prisma.allocation.findMany({ where: { skuId: sku.id, status: 'ACTIVE' } }),
      ]);
      const onHand = balances.reduce((s, b) => s + b.onHand, 0);
      const eligibleInbound = inbound.reduce((s, r) => s + r.quantity, 0);
      const allocated = allocs.reduce((s, a) => s + a.quantity, 0);
      const atp = computeAtp({ onHand, eligibleInbound, allocatedDemand: allocated });
      const openDemand = lines.reduce((s, l) => s + (l.requestedQty - l.shippedQty), 0);
      if (openDemand === 0 && atp >= sku.safetyStockQty) continue;

      const projection = projectAtp({
        asOfDate: asOf,
        horizonDays: 30,
        onHand,
        inbound: inbound.map((r) => ({ date: toYmd(r.expectedArrivalTime) < asOf ? asOf : toYmd(r.expectedArrivalTime), quantity: r.quantity, reference: r.receiptNumber })),
        demand: allocs.map((a) => ({ date: toYmd(a.availableDate), quantity: a.quantity, reference: `ALLOC-${a.id}` })),
      });
      const shortageDate = firstShortageDate(projection);
      const dailyDemand = openDemand / 30;
      const coverDays = dailyDemand > 0 ? Math.max(0, Math.floor(atp / dailyDemand)) : null;
      const risk: 'HIGH' | 'MEDIUM' | 'LOW' = shortageDate || atp < 0 ? 'HIGH' : atp < sku.safetyStockQty ? 'MEDIUM' : 'LOW';

      const suggestions: Array<{ kind: string; text: string; appliedAutomatically: false }> = [];
      if (shortageDate || atp < sku.safetyStockQty) {
        const pullForward = inbound.find((r) => shortageDate !== null && toYmd(r.expectedArrivalTime) > shortageDate);
        if (pullForward) {
          suggestions.push({ kind: 'PULL_FORWARD_RECEIPT', text: `Ask the supplier to pull forward ${pullForward.receiptNumber} (${pullForward.quantity} units, due ${toYmd(pullForward.expectedArrivalTime)}) before ${shortageDate}.`, appliedAutomatically: false });
        }
        const surplus = balances.filter((b) => b.onHand > 0).sort((a, b) => b.onHand - a.onHand);
        const deficit = balances.filter((b) => b.onHand === 0);
        if (surplus.length && deficit.length) {
          suggestions.push({ kind: 'REBALANCE_INVENTORY', text: `Rebalance from ${surplus[0].location.locationCode} (${surplus[0].onHand} on hand) to ${deficit[0].location.locationCode} (no on-hand stock).`, appliedAutomatically: false });
        }
        const urgent = lines.filter((l) => l.order.priority === 'HIGH' && l.backorderedQty > 0);
        if (urgent.length) {
          suggestions.push({ kind: 'REPRIORITIZE_ORDERS', text: `Protect ${urgent.length} HIGH priority line(s) with backorders (${urgent.map((u) => u.order.orderNumber).join(', ')}); consider deferring LOW priority demand.`, appliedAutomatically: false });
        }
        if (suggestions.length === 0) {
          suggestions.push({ kind: 'REPLENISH', text: `Place a replenishment receipt${sku.leadTimeDays ? ` (lead time ${sku.leadTimeDays} days)` : ''} for ${sku.skuCode}.`, appliedAutomatically: false });
        }
      }

      insights.push({
        skuId: sku.id,
        skuCode: sku.skuCode,
        productName: sku.name,
        atp,
        safetyStock: sku.safetyStockQty,
        openDemand,
        coverDays,
        projectedShortageDate: shortageDate,
        risk,
        suggestions,
      });
    }
    return {
      asOf,
      advisoryOnly: true,
      generatedBy: this.providerName(),
      items: insights.sort((a, b) => (a.risk === b.risk ? a.atp - b.atp : a.risk === 'HIGH' ? -1 : 1)),
    };
  }

  // ==================================================================== log

  async interactions(params: { type?: string; status?: string; limit: number }) {
    const rows = await this.prisma.aIInteraction.findMany({
      where: { ...(params.type ? { type: params.type as never } : {}), ...(params.status ? { status: params.status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
    });
    return rows.map((r) => this.view(r));
  }

  // ==================================================================== internals

  view(r: { id: number; interactionId: string; type: string; status: string; provider: string; model: string; inputText: string; output: unknown; decisionReason: string | null; decidedAt: Date | null; createdAt: Date }): AiInteractionView {
    return {
      id: r.id,
      interactionId: r.interactionId,
      type: r.type,
      status: r.status,
      provider: r.provider,
      model: r.model,
      inputText: r.inputText,
      output: r.output,
      decisionReason: r.decisionReason,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async requireInteraction(id: number, type: string) {
    const row = await this.prisma.aIInteraction.findUnique({ where: { id } });
    if (!row || row.type !== type) throw ApiError.notFound('AIInteraction', id);
    return row;
  }

  private async loadCatalog(): Promise<Catalog> {
    const [receipts, orders, locations] = await Promise.all([
      this.prisma.inboundReceipt.findMany({ where: { status: { in: ['PLANNED', 'IN_TRANSIT'] } }, include: { sku: true, location: true } }),
      this.prisma.order.findMany({
        where: { status: { in: ['CONFIRMED', 'FULFILLING'] } },
        include: { customer: true, lines: { include: { sku: true } } },
        take: 500,
      }),
      this.prisma.location.findMany({ where: { isActive: true } }),
    ]);
    return {
      receipts: receipts.map((r) => ({
        id: r.id,
        receiptNumber: r.receiptNumber,
        skuCode: r.sku.skuCode,
        locationCode: r.location.locationCode,
        status: r.status,
        expectedArrival: toYmd(r.expectedArrivalTime),
        quantity: r.quantity,
      })),
      orders: orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, customer: o.customer.name, status: o.status, skuCodes: o.lines.map((l) => l.sku.skuCode) })),
      locations: locations.map((l) => ({ id: l.id, locationCode: l.locationCode, name: l.name })),
    };
  }

  private async llmPlanner(note: string, catalog: Catalog): Promise<{ summary: string; actions: ProposedAction[] }> {
    const system =
      'You convert a supply-chain planner\'s note into proposed structured changes. Only use receiptNumber, orderNumber and locationCode values that appear in the provided catalog, copied exactly. Action types: DELAY_RECEIPT (supplier slip), EXPEDITE_RECEIPT (earlier arrival), REASSIGN_LOCATION (move an order to a warehouse), SPLIT_SHIPMENT (ship available units now). Use deltaDays for relative changes. Do not decide anything yourself: this is a proposal for a human to approve. Respond with JSON: {"summary": string, "actions": [{"type", "receiptNumber", "orderNumber", "locationCode", "deltaDays", "newArrival", "confidence" (0-1), "evidence" (quote from note)}]}.';
    const res = await this.provider!.complete({ system, user: JSON.stringify({ note, catalog }), expectJson: true, maxTokens: 1200 });
    const parsed = llmPlanSchema.parse(parseJsonObject(res.text));
    return parsed;
  }

  private async fingerprint(skuIds: number[], actions: ValidatedAction[] | Array<{ resolved?: unknown }>): Promise<string> {
    const ids = [...new Set(skuIds)].sort((a, b) => a - b);
    const lines = await this.prisma.orderLine.findMany({
      where: { skuId: { in: ids } },
      select: { id: true, allocatedQty: true, backorderedQty: true, calculatedPromisedDate: true, manualPromisedDate: true, preferredLocationId: true, shippedQty: true, requestedQty: true },
      orderBy: { id: 'asc' },
    });
    const receipts = await this.prisma.inboundReceipt.findMany({
      where: { skuId: { in: ids } },
      select: { id: true, status: true, expectedArrivalTime: true, quantity: true },
      orderBy: { id: 'asc' },
    });
    const balances = await this.prisma.inventoryBalance.findMany({ where: { skuId: { in: ids } }, select: { skuId: true, locationId: true, onHand: true }, orderBy: [{ skuId: 'asc' }, { locationId: 'asc' }] });
    const actionKey = actions.map((a) => ('resolved' in a ? a.resolved : a));
    // Canonical JSON: MySQL's JSON column re-orders object keys, so the hash must not depend on key order.
    return createHash('sha256').update(canonicalJson({ lines, receipts, balances, actionKey })).digest('hex');
  }

  /** Builds simulation overrides from validated actions. Pure with respect to the DB except reads. */
  private async buildOverrides(tx: Tx, actions: ValidatedAction[]): Promise<{ overrides: SimOverrides; skuIds: number[] }> {
    const overrides: SimOverrides = { receiptArrival: new Map(), lineLocation: new Map(), lineOpenQty: new Map(), onHandDelta: new Map() };
    const skuIds = new Set<number>();
    for (const a of actions) {
      const r = a.resolved;
      if ((a.type === 'DELAY_RECEIPT' || a.type === 'EXPEDITE_RECEIPT') && r.receiptId && r.newArrival) {
        overrides.receiptArrival!.set(r.receiptId, new Date(`${r.newArrival}T00:00:00.000Z`));
        if (r.skuId) skuIds.add(r.skuId);
      }
      if (a.type === 'REASSIGN_LOCATION' && r.orderId && r.locationId) {
        const lines = await tx.orderLine.findMany({ where: { orderId: r.orderId, canceledAt: null } });
        for (const l of lines) {
          if (l.requestedQty - l.shippedQty <= 0) continue;
          overrides.lineLocation!.set(l.id, r.locationId);
          skuIds.add(l.skuId);
        }
      }
      if (a.type === 'SPLIT_SHIPMENT' && r.orderId) {
        for (const ship of await this.shippablePlan(tx, r.orderId)) {
          skuIds.add(ship.skuId);
          overrides.lineOpenQty!.set(ship.lineId, ship.lineOpenQty - ship.quantity);
          for (const d of ship.draws) {
            const key = `${ship.skuId}:${d.locationId}`;
            overrides.onHandDelta!.set(key, (overrides.onHandDelta!.get(key) ?? 0) - d.qty);
          }
        }
      }
    }
    return { overrides, skuIds: [...skuIds].sort((x, y) => x - y) };
  }

  /** What could ship right now for an order: on-hand allocations available today, per line. */
  private async shippablePlan(tx: Tx, orderId: number) {
    const today = new Date(`${todayYmd()}T00:00:00.000Z`);
    const lines = await tx.orderLine.findMany({
      where: { orderId, canceledAt: null },
      include: { allocations: { where: { status: 'ACTIVE', sourceType: 'ON_HAND', availableDate: { lte: today } }, include: { location: true }, orderBy: [{ location: { locationCode: 'asc' } }] } },
    });
    const out: Array<{ lineId: number; skuId: number; lineOpenQty: number; quantity: number; draws: Array<{ locationId: number; qty: number }> }> = [];
    for (const l of lines) {
      const open = l.requestedQty - l.shippedQty;
      let remaining = open;
      const draws: Array<{ locationId: number; qty: number }> = [];
      for (const a of l.allocations) {
        if (remaining === 0) break;
        const take = Math.min(remaining, a.quantity);
        draws.push({ locationId: a.locationId, qty: take });
        remaining -= take;
      }
      const quantity = open - remaining;
      if (quantity > 0) out.push({ lineId: l.id, skuId: l.skuId, lineOpenQty: open, quantity, draws });
    }
    return out;
  }

  private async applyAction(action: ValidatedAction, actorId: number, reason: string): Promise<string> {
    const r = action.resolved;
    if (action.type === 'DELAY_RECEIPT' || action.type === 'EXPEDITE_RECEIPT') {
      if (!r.receiptId || !r.newArrival) throw new Error('Receipt or date no longer resolvable');
      const res = await this.receipts.update(
        r.receiptId,
        { expectedArrivalTime: r.newArrival, reason, version: undefined },
        actorId,
      );
      return `Receipt ${r.receiptNumber} arrival set to ${r.newArrival} (${res.delta.direction.toLowerCase()})`;
    }
    if (action.type === 'REASSIGN_LOCATION') {
      if (!r.orderId || !r.locationId) throw new Error('Order or location no longer resolvable');
      const lines = await this.prisma.orderLine.findMany({ where: { orderId: r.orderId, canceledAt: null }, select: { id: true, requestedQty: true, shippedQty: true } });
      let count = 0;
      for (const l of lines) {
        if (l.requestedQty - l.shippedQty <= 0) continue;
        await this.planner.reassignLocation({ orderLineId: l.id, locationId: r.locationId, reason }, actorId);
        count += 1;
      }
      return `Reassigned ${count} line(s) of ${r.orderNumber} to ${r.locationCode}`;
    }
    if (action.type === 'SPLIT_SHIPMENT') {
      if (!r.orderId) throw new Error('Order no longer resolvable');
      const plan = await this.prisma.transact(async (tx) => this.shippablePlan(tx, r.orderId as number));
      if (plan.length === 0) throw new Error('No on-hand units are available to ship right now');
      const res = await this.orders.ship(
        r.orderId,
        { lines: plan.map((p) => ({ orderLineId: p.lineId, quantity: p.quantity })), reason, isSplit: true },
        actorId,
      );
      return `Shipped ${plan.reduce((s, p) => s + p.quantity, 0)} available unit(s) of ${r.orderNumber} as ${res.shipment.shipmentNumber}`;
    }
    throw new Error(`Unsupported action ${action.type}`);
  }

  private async communicationFacts(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        lines: { where: { canceledAt: null }, include: { sku: true, fulfillmentLocation: true, allocations: { where: { status: 'ACTIVE' }, include: { location: true, receipt: true } } }, orderBy: { lineNumber: 'asc' } },
        exceptions: { where: { status: 'OPEN' } },
      },
    });
    if (!order) throw ApiError.notFound('Order', orderId);
    const today = todayYmd();
    const shippableNow = await this.prisma.transact(async (tx) => this.shippablePlan(tx, orderId));
    const lines = order.lines.map((l) => {
      const promised = nullableDateToYmd(l.manualPromisedDate ?? l.calculatedPromisedDate);
      return {
        sku: l.sku.skuCode,
        productName: l.sku.name,
        requested: l.requestedQty,
        shipped: l.shippedQty,
        allocated: l.allocatedQty,
        backordered: l.backorderedQty,
        warehouse: l.fulfillmentLocation?.locationCode ?? null,
        promisedDate: promised,
        arrivalsForBackorder: l.allocations.filter((a) => a.sourceType === 'INBOUND').map((a) => ({ receipt: a.receipt?.receiptNumber, qty: a.quantity, arrives: toYmd(a.availableDate) })),
      };
    });
    const orderPromise = lines.every((l) => l.promisedDate) ? lines.reduce<string | null>((m, l) => (m === null || (l.promisedDate as string) > m ? (l.promisedDate as string) : m), null) : null;
    const alternates: Array<{ sku: string; location: string; available: number }> = [];
    for (const l of order.lines) {
      if (l.backorderedQty === 0) continue;
      const bal = await this.prisma.inventoryBalance.findMany({ where: { skuId: l.skuId, onHand: { gt: 0 } }, include: { location: true } });
      for (const b of bal) {
        if (b.locationId === l.fulfillmentLocationId) continue;
        alternates.push({ sku: l.sku.skuCode, location: b.location.locationCode, available: b.onHand });
      }
    }
    return {
      orderNumber: order.orderNumber,
      customer: order.customer.name,
      priority: order.priority,
      today,
      requestedShipDate: nullableDateToYmd(order.requestedShipDate),
      promisedShipDate: orderPromise,
      nextUpdateBy: addDaysYmd(today, 2),
      lines,
      totals: {
        requested: lines.reduce((s, l) => s + l.requested - l.shipped, 0),
        shippableNow: shippableNow.reduce((s, p) => s + p.quantity, 0),
        backordered: lines.reduce((s, l) => s + l.backordered, 0),
      },
      warehouses: [...new Set(lines.map((l) => l.warehouse).filter(Boolean))],
      openRisks: order.exceptions.map((e) => ({ type: e.type, severity: e.severity })),
      options: [
        ...(shippableNow.length ? ['Ship the available units now and send the remainder when it arrives (partial shipment).'] : []),
        ...(alternates.length ? [`Alternate warehouse with stock: ${[...new Set(alternates.map((a) => `${a.location} (${a.sku})`))].join(', ')}.`] : []),
      ],
    };
  }

  private templateCommunication(f: Awaited<ReturnType<AiService['communicationFacts']>>) {
    const lineLines = f.lines
      .map((l) => `- ${l.sku}: ${l.requested - l.shipped} unit(s) open${l.allocated ? `, ${l.allocated} allocated from ${l.warehouse ?? 'stock'}` : ''}${l.backordered ? `, ${l.backordered} backordered` : ''}${l.promisedDate ? `, planned by ${l.promisedDate}` : ''}`)
      .join('\n');
    const body = [
      `Hello ${f.customer},`,
      '',
      `Here is an update on order ${f.orderNumber}.`,
      '',
      lineLines,
      '',
      f.totals.shippableNow > 0
        ? `We can ship ${f.totals.shippableNow} unit(s) now from ${f.warehouses.join(', ') || 'our warehouse'}.`
        : 'Nothing can ship today; we are waiting on inbound supply.',
      f.totals.backordered > 0 ? `${f.totals.backordered} unit(s) remain backordered and will follow when they arrive.` : '',
      f.promisedShipDate ? `The current planned completion date is ${f.promisedShipDate}.` : 'We do not yet have a committed completion date for the remaining units.',
      f.openRisks.length ? 'We are actively working on the supply risks affecting this order and will update you if the timing changes.' : '',
      f.options.length ? `Options: ${f.options.join(' ')}` : '',
      `You will hear from us again by ${f.nextUpdateBy}.`,
      '',
      'Thank you for your patience.',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    return { subject: `Shipping update for order ${f.orderNumber}`, body };
  }

  private async exceptionFacts(exceptionId: number) {
    const detail = await this.prisma.transact((tx) => this.exceptions.context(tx, exceptionId));
    const exc = await this.prisma.exception.findUnique({ where: { id: exceptionId }, include: { orderLine: true } });
    const line = exc?.orderLine;
    const today = todayYmd();
    let alternates: Array<{ location: string; onHand: number }> = [];
    let impacts: Array<{ option: string; promiseAfter: string | null; backorderedAfter: number }> = [];
    if (line) {
      const bal = await this.prisma.inventoryBalance.findMany({ where: { skuId: exc!.skuId, onHand: { gt: 0 } }, include: { location: true } });
      alternates = bal.filter((b) => b.locationId !== line.fulfillmentLocationId).map((b) => ({ location: b.location.locationCode, onHand: b.onHand }));
      const sim = await this.prisma.transact(async (tx) => {
        const s: Array<{ option: string; promiseAfter: string | null; backorderedAfter: number }> = [];
        for (const a of alternates.slice(0, 2)) {
          const loc = await tx.location.findFirst({ where: { locationCode: a.location } });
          if (!loc) continue;
          const res = await this.allocation.simulate(tx, [exc!.skuId], { lineLocation: new Map([[line.id, loc.id]]) });
          const after = res.after.get(line.id);
          s.push({ option: `Reassign line to ${a.location}`, promiseAfter: after?.effectivePromisedDate ?? null, backorderedAfter: after?.backorderedQty ?? 0 });
        }
        if (exc?.receiptId) {
          const r = await tx.inboundReceipt.findUnique({ where: { id: exc.receiptId } });
          if (r && (r.status === 'PLANNED' || r.status === 'IN_TRANSIT')) {
            const earlier = addDaysYmd(today, 1);
            const res = await this.allocation.simulate(tx, [exc.skuId], { receiptArrival: new Map([[r.id, new Date(`${earlier}T00:00:00.000Z`)]]) });
            const after = res.after.get(line.id);
            s.push({ option: `Expedite ${r.receiptNumber} to ${earlier}`, promiseAfter: after?.effectivePromisedDate ?? null, backorderedAfter: after?.backorderedQty ?? 0 });
          }
        }
        return s;
      });
      impacts = sim;
    }
    return {
      exceptionNumber: detail.exceptionNumber,
      type: detail.type,
      severity: detail.severity,
      priority: detail.priority,
      order: detail.order,
      customer: detail.customer,
      sku: detail.sku.skuCode,
      affectedQty: detail.affectedQty,
      currentPromisedDate: detail.currentPromisedDate,
      requestedShipDate: detail.requestedShipDate,
      recommendedAction: detail.recommendedAction,
      details: detail.details,
      currentAllocations: detail.currentAllocations,
      alternateLocationsWithStock: alternates,
      optionImpacts: impacts,
      asOf: today,
      daysLate: detail.currentPromisedDate && detail.requestedShipDate ? diffDaysYmd(detail.requestedShipDate, detail.currentPromisedDate) : null,
    };
  }

  private templateExceptionSummary(f: Awaited<ReturnType<AiService['exceptionFacts']>>) {
    const allocs = f.currentAllocations.map((a) => `${a.quantity} from ${a.location}${a.receiptNumber ? ` (${a.receiptNumber})` : ' on-hand'}`).join(', ') || 'no active allocations';
    const next = f.optionImpacts.map((o) => ({ action: o.option, impact: `Promise would be ${o.promiseAfter ?? 'undetermined'}, backordered ${o.backorderedAfter}.` }));
    next.push({ action: f.recommendedAction, impact: 'Advisory only; requires planner action.' });
    return {
      whatHappened: `${f.type.replace(/_/g, ' ').toLowerCase()} on ${f.order.orderNumber} (${f.customer}) for ${f.sku}: ${f.affectedQty} unit(s) affected at ${f.severity} severity.${f.daysLate ? ` Promise is ${f.daysLate} day(s) after the requested date.` : ''}`,
      currentPlan: `Current allocations: ${allocs}. Promised ${f.currentPromisedDate ?? 'no date committed'}, requested ${f.requestedShipDate ?? 'none'}.`,
      nextBestActions: next.slice(0, 5),
      impact: next.length > 1 ? 'Estimated impacts are simulations on the current plan; nothing has been changed.' : 'No alternate option was found in the current data.',
    };
  }
}

/** JSON with object keys sorted recursively, so equal values always serialize identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function serializeOverrides(o: SimOverrides, skuIds: number[]): SerializedOverrides {
  return {
    receiptArrival: [...(o.receiptArrival ?? new Map()).entries()].map(([k, v]) => [k, toYmd(v)]),
    lineLocation: [...(o.lineLocation ?? new Map()).entries()],
    lineOpenQty: [...(o.lineOpenQty ?? new Map()).entries()],
    onHandDelta: [...(o.onHandDelta ?? new Map()).entries()],
    skuIds,
  };
}
