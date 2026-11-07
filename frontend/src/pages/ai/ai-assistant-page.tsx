import { useState } from 'react';
import { Sparkles, Check, X, AlertTriangle, Info, Send, ShieldCheck, Gauge } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { errorMessage, useAiInteractionsQuery, useApprovePlannerNoteMutation, usePlannerNoteMutation, useRejectPlannerNoteMutation, useShortageInsightsQuery } from '../../app/api';
import { useAppDispatch } from '../../app/hooks';
import { PageHeader } from '../../components/common/page-header';
import { Badge } from '../../components/ui/badge';
import { Card, CardBody, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Field, Input, Select, Textarea } from '../../components/ui/input';
import { Tabs } from '../../components/ui/tabs';
import { EmptyState, Skeleton } from '../../components/ui/states';
import { pushToast } from '../../features/ui/uiSlice';
import { noteSchema, reasonSchema } from '../../lib/schemas';
import { fmtDate, fmtDateTime, fmtNum, humanize } from '../../lib/utils';
import { useForm as useRejectForm } from 'react-hook-form';
import type { AiInteraction } from '../../lib/dto';
import { cn } from '../../lib/utils';

const EXAMPLE = 'Vendor confirmed PO-22 slips by 5 days. Can we move Order #A104 to NJ warehouse? The customer wants partial ASAP.';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  PROPOSED: 'info',
  APPROVED: 'success',
  PARTIALLY_APPLIED: 'warning',
  REJECTED: 'neutral',
  STALE: 'danger',
  GENERATED: 'info',
  FAILED: 'danger',
};

export function AiAssistantPage() {
  const [tab, setTab] = useState<'planner' | 'insights' | 'log'>('planner');
  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Turn planner notes into proposed changes. The AI never edits data: it proposes, the system validates and simulates, and you approve or reject. Every interaction is logged."
        actions={<Badge tone="info"><Sparkles className="h-3 w-3" /> Advisory · human approval required</Badge>}
      />
      <div className="mb-6"><Tabs value={tab} onChange={setTab} items={[{ value: 'planner', label: 'Planner note' }, { value: 'insights', label: 'Shortage insights' }, { value: 'log', label: 'Interaction log' }]} /></div>
      {tab === 'planner' && <PlannerNote />}
      {tab === 'insights' && <ShortageInsights />}
      {tab === 'log' && <InteractionLog />}
    </>
  );
}

function PlannerNote() {
  const dispatch = useAppDispatch();
  const [propose, pState] = usePlannerNoteMutation();
  const [proposal, setProposal] = useState<AiInteraction | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [approve, aState] = useApprovePlannerNoteMutation();
  const [reject, rState] = useRejectPlannerNoteMutation();
  const [rejecting, setRejecting] = useState(false);
  const form = useForm<{ note: string }>({ resolver: zodResolver(noteSchema), defaultValues: { note: '' } });
  const rejectForm = useRejectForm<{ reason: string }>({ defaultValues: { reason: '' } });

  const submit = form.handleSubmit(async (v) => {
    try {
      const res = await propose({ note: v.note }).unwrap();
      setProposal(res);
      const valid = (res.output?.actions ?? []).filter((a: any) => a.valid);
      setSelected(Object.fromEntries(valid.map((a: any) => [a.id, true])));
      setDecisionError(null);
      setRejecting(false);
    } catch (e) {
      dispatch(pushToast({ tone: 'error', title: 'Could not analyse the note', description: errorMessage(e) }));
    }
  });

  const out = proposal?.output;
  const actions: any[] = out?.actions ?? [];
  const validIds = actions.filter((a) => a.valid).map((a) => a.id);
  const chosen = validIds.filter((id) => selected[id]);
  const decided = proposal && proposal.status !== 'PROPOSED';

  const onApprove = async () => {
    if (!proposal || chosen.length === 0) return;
    try {
      const res = await approve({ id: proposal.id, actionIds: chosen, reason: 'Approved after review' }).unwrap();
      setProposal(res);
      const applied = (res.output?.applied ?? []).filter((r: any) => r.status === 'APPLIED').length;
      dispatch(pushToast({ tone: res.status === 'APPROVED' ? 'success' : 'warning', title: res.status === 'APPROVED' ? 'Changes applied' : 'Partially applied', description: `${applied} of ${(res.output?.applied ?? []).length} action(s) applied through the normal services. Audit trail updated.` }));
    } catch (e) {
      setDecisionError(errorMessage(e));
    }
  };

  const onReject = rejectForm.handleSubmit(async (v) => {
    const parsed = reasonSchema.safeParse(v);
    if (!parsed.success || !proposal) return rejectForm.setError('reason', { message: 'Enter a reason of at least 3 characters' });
    try {
      setProposal(await reject({ id: proposal.id, reason: v.reason }).unwrap());
      setRejecting(false);
      dispatch(pushToast({ tone: 'info', title: 'Proposal rejected', description: 'Recorded with your reason. Nothing was changed.' }));
    } catch (e) {
      setDecisionError(errorMessage(e));
    }
  });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card>
        <CardHeader title="Planner note" description="Describe the supplier news or customer request in plain language." />
        <CardBody className="space-y-4">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Note" error={form.formState.errors.note?.message} htmlFor="note">
              <Textarea id="note" rows={5} placeholder={EXAMPLE} {...form.register('note')} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-xs font-medium text-info hover:underline" onClick={() => form.setValue('note', EXAMPLE, { shouldValidate: true })}>Use the example note</button>
              <Button type="submit" loading={pState.isLoading}><Send className="h-4 w-4" /> Analyse note</Button>
            </div>
          </form>
          <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">What happens next</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>The note is parsed into proposed actions with a confidence for each entity found.</li>
              <li>Every action is validated against business rules and simulated on the live plan.</li>
              <li>You review the before-and-after impact and approve or reject. Nothing is saved before that.</li>
            </ol>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-6">
        {!proposal && !pState.isLoading && (
          <Card><CardBody><EmptyState icon={Sparkles} title="No proposal yet" description="Analyse a note to see proposed actions, validation results and the impact on promises." /></CardBody></Card>
        )}
        {pState.isLoading && <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>}
        {proposal && out && (
          <>
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2">Proposal #{proposal.id} <Badge tone={STATUS_TONE[proposal.status] ?? 'neutral'}>{humanize(proposal.status)}</Badge></span>}
                description={`${out.summary} · parsed by ${out.parserUsed === 'llm' ? `${proposal.provider} (${proposal.model})` : 'rule-based parser'}`}
              />
              <CardBody className="space-y-4">
                {out.parserUsed === 'heuristic-fallback' && <p className="flex items-center gap-2 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5" /> The language model did not return a usable answer, so the rule-based parser was used.</p>}
                <ul className="space-y-3">
                  {actions.length === 0 && <li className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">No change could be identified with confidence. Try naming the receipt (for example PO-22) and the order (for example A104).</li>}
                  {actions.map((a: any) => (
                    <li key={a.id} className={cn('rounded-xl border p-4', a.valid ? 'border-border' : 'border-danger/30 bg-danger/[0.03]')}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <label className="flex items-start gap-3">
                          <input type="checkbox" className="mt-1" disabled={!a.valid || !!decided} checked={!!selected[a.id]} onChange={(e) => setSelected((s) => ({ ...s, [a.id]: e.target.checked }))} aria-label={`Include ${humanize(a.type)}`} />
                          <span>
                            <span className="text-sm font-semibold">{humanize(a.type)}</span>
                            <span className="block text-sm text-muted-foreground">{a.summary}</span>
                          </span>
                        </label>
                        <div className="flex flex-col items-end gap-1.5">
                          <ConfidenceMeter value={a.confidence} />
                          {a.valid ? <Badge tone="success"><ShieldCheck className="h-3 w-3" />Valid</Badge> : <Badge tone="danger"><X className="h-3 w-3" />Blocked</Badge>}
                        </div>
                      </div>
                      <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs italic text-muted-foreground">“{a.evidence}”</p>
                      {a.errors?.map((er: string) => <p key={er} className="mt-2 text-xs text-danger">• {er}</p>)}
                      {a.warnings?.map((w: string) => <p key={w} className="mt-2 text-xs text-warning">• {w}</p>)}
                    </li>
                  ))}
                </ul>
                {actions.length > 0 && validIds.length === 0 && <p className="text-xs text-danger">None of the proposed actions can be applied. Correct the note and analyse again.</p>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Impact on the current plan" description="Simulation with the same engine that runs live allocation. Nothing has been changed." />
              <CardBody className="space-y-3">
                {(out.impact?.lines ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No allocation or promise changes result from the valid actions.</p> : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="bg-muted/60 uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Promise</th><th className="px-3 py-2">Ships from</th><th className="px-3 py-2 text-right">Backorder</th><th className="px-3 py-2 text-right">Allocated</th></tr></thead>
                      <tbody className="divide-y divide-border">
                        {out.impact.lines.map((l: any) => {
                          const b = l.before ?? {}; const a = l.after ?? {};
                          const better = a.backorderedQty < b.backorderedQty || (a.effectivePromisedDate && b.effectivePromisedDate && a.effectivePromisedDate < b.effectivePromisedDate);
                          return (
                            <tr key={l.lineId}>
                              <td className="px-3 py-2 font-medium">{l.orderNumber}</td>
                              <td className="px-3 py-2">{l.sku}</td>
                              <td className="tabular px-3 py-2"><span className="text-muted-foreground">{fmtDate(b.effectivePromisedDate)}</span> → <span className={cn('font-semibold', better ? 'text-success' : a.effectivePromisedDate && b.effectivePromisedDate && a.effectivePromisedDate > b.effectivePromisedDate ? 'text-danger' : '')}>{fmtDate(a.effectivePromisedDate)}</span></td>
                              <td className="px-3 py-2">{b.fulfillmentLocationCode ?? '—'} → {a.fulfillmentLocationCode ?? '—'}</td>
                              <td className="tabular px-3 py-2 text-right">{fmtNum(b.backorderedQty)} → {fmtNum(a.backorderedQty)}</td>
                              <td className="tabular px-3 py-2 text-right">{fmtNum(b.allocatedQty)} → {fmtNum(a.allocatedQty)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Approval is refused if the plan changed since this proposal was made. You would then re-run the note.</p>
                {decisionError && <p role="alert" className="text-xs text-danger">{decisionError}</p>}

                {!decided && !rejecting && (
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button variant="secondary" onClick={() => setRejecting(true)}><X className="h-4 w-4" /> Reject</Button>
                    <Button variant="success" onClick={onApprove} loading={aState.isLoading} disabled={chosen.length === 0}><Check className="h-4 w-4" /> Approve {chosen.length} action(s)</Button>
                  </div>
                )}
                {!decided && rejecting && (
                  <form onSubmit={onReject} className="space-y-2 rounded-xl border border-border p-4">
                    <Field label="Why are you rejecting this?" error={rejectForm.formState.errors.reason?.message} htmlFor="reject-reason"><Input id="reject-reason" {...rejectForm.register('reason')} /></Field>
                    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRejecting(false)}>Back</Button><Button type="submit" variant="danger" loading={rState.isLoading}>Reject proposal</Button></div>
                  </form>
                )}
                {decided && (
                  <p className={cn('rounded-lg p-3 text-sm', proposal.status === 'APPROVED' ? 'bg-success/10 text-success' : proposal.status === 'REJECTED' ? 'bg-muted text-muted-foreground' : 'bg-warning/10 text-warning')}>
                    {humanize(proposal.status)}{proposal.decisionReason ? ` · ${proposal.decisionReason}` : ''}{proposal.decidedAt ? ` · ${fmtDateTime(proposal.decidedAt)}` : ''}
                  </p>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground" aria-label={`Confidence ${pct}%`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', pct >= 80 ? 'bg-success' : pct >= 60 ? 'bg-warning' : 'bg-danger')} style={{ width: `${pct}%` }} /></div>
      <span className="tabular w-8 text-right">{pct}%</span>
    </div>
  );
}

function ShortageInsights() {
  const q = useShortageInsightsQuery();
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error) return <Card><CardBody><p className="text-sm text-danger">{errorMessage(q.error)}</p></CardBody></Card>;
  const items = q.data?.items ?? [];
  return (
    <Card>
      <CardHeader title="SKUs trending toward shortage" description={`Projected from current ATP, committed demand and inbound timing as of ${fmtDate(q.data?.asOf)}. Suggestions are never applied automatically.`} />
      <CardBody className="space-y-3">
        {items.length === 0 && <EmptyState icon={Gauge} title="No shortage risk" description="Every SKU has cover above its safety stock." />}
        {items.map((i: any) => (
          <div key={i.skuId} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-semibold">{i.skuCode} <span className="font-normal text-muted-foreground">· {i.productName}</span></p><p className="tabular text-xs text-muted-foreground">ATP {fmtNum(i.atp)} · safety {fmtNum(i.safetyStock)} · open demand {fmtNum(i.openDemand)}{i.coverDays !== null ? ` · ~${i.coverDays} days cover` : ''}</p></div>
              <Badge tone={i.risk === 'HIGH' ? 'danger' : i.risk === 'MEDIUM' ? 'warning' : 'success'}>{i.risk} risk{i.projectedShortageDate ? ` · shortage ${fmtDate(i.projectedShortageDate)}` : ''}</Badge>
            </div>
            {i.suggestions.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm">
                {i.suggestions.map((s: any, k: number) => <li key={k} className="flex items-start gap-2"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" /><span><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{humanize(s.kind)} · </span>{s.text}</span></li>)}
              </ul>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function InteractionLog() {
  const [type, setType] = useState('');
  const q = useAiInteractionsQuery({ type: type || undefined, limit: 50 });
  return (
    <Card>
      <CardHeader title="AI interaction log" description="Input, structured output, provider, model and every decision. Kept for audit." actions={<Select aria-label="Filter AI interactions" className="w-56" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="PLANNER_NOTE">Planner notes</option><option value="CUSTOMER_COMMUNICATION">Customer updates</option><option value="EXCEPTION_SUMMARY">Exception summaries</option></Select>} />
      <CardBody className="p-0">
        {q.isLoading ? <div className="p-5"><Skeleton className="h-48 w-full" /></div> : (q.data ?? []).length === 0 ? <div className="p-5"><EmptyState title="No AI interactions yet" description="Planner notes, customer drafts and exception summaries are logged here." /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Input</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Provider</th><th className="px-4 py-2">Decision</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(q.data ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="tabular px-4 py-2 text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-4 py-2 text-xs">{humanize(r.type)}</td>
                    <td className="max-w-[300px] truncate px-4 py-2 text-xs" title={r.inputText}>{r.inputText}</td>
                    <td className="px-4 py-2"><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{humanize(r.status)}</Badge></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.provider} · {r.model}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.decisionReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
