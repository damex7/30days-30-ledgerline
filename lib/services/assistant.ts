import "server-only";
import type { z } from "zod";
import { db, int, toDate, toDateOrNull, transaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, can } from "@/lib/permissions";
import { ConflictError, NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { addDays, formatDate, resolvePreset, todayInLagos } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { logError } from "@/lib/log";
import type { Ctx } from "@/lib/context";
import type { AiProvider } from "@/lib/ai/provider";
import { openProviderSession } from "@/lib/ai/select";
import { enforceAiLimits } from "@/lib/ai/runner";
import { checkNumbers, redact, wrapUntrusted } from "@/lib/ai/guardrails";
import { estimateCostMicroUsd } from "@/lib/ai/pricing";
import { MAX_OUTPUT_TOKENS, PROPOSAL_TTL_HOURS } from "@/lib/ai/limits";
import {
  INVOICE_DRAFT_SYSTEM,
  invoiceDraftPrompt,
  PROMPT_VERSION,
  REMINDER_SYSTEM,
  repairInstruction,
  SUMMARY_SYSTEM,
} from "@/lib/ai/prompts";
import {
  invoiceDraftSchema,
  jsonSchemaOf,
  parseModelJson,
  reminderOutputSchema,
  summaryOutputSchema,
  type InvoiceDraft,
} from "@/lib/ai/schemas";
import { findRunByRequest, finishRun, insertRun, saveAnswer, type RunKind, type RunStatus } from "@/lib/repos/ai-runs";
import { searchCustomers } from "@/lib/repos/customers";
import { searchProducts } from "@/lib/repos/products";
import * as reports from "@/lib/repos/reports";
import { createInvoiceTx, getInvoice } from "@/lib/services/invoices";
import type { InvoiceInput } from "@/lib/validation/business";

interface RunOptions {
  primary?: AiProvider;
  skipLimits?: boolean;
}

type StructuredOutcome<T> =
  | { ok: true; value: T; runId: string; provider: string }
  | { ok: false; runId: string | null; status: RunStatus; message: string };

/**
 * One structured-output model call with every rule applied: idempotent run
 * row written first, limits, Zod validation of the output, ONE repair retry,
 * and a clear failure (never acted on) if it still doesn't validate.
 */
async function structuredRun<S extends z.ZodType>(
  ctx: Ctx,
  v: { kind: RunKind; logText: string; system: string; prompt: string; schema: S; clientRequestId: string },
  options: RunOptions,
): Promise<StructuredOutcome<z.infer<S>> & { existing?: boolean }> {
  const existing = await findRunByRequest(db, ctx.workspaceId, v.clientRequestId);
  if (existing) return { ok: false, runId: existing.id, status: existing.status, message: "This request was already handled.", existing: true };

  const session = openProviderSession(options.primary ? { primary: options.primary } : {});
  const base = {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    kind: v.kind,
    questionRedacted: redact(v.logText),
    promptVersion: PROMPT_VERSION,
    provider: session.configured,
    model: session.fastModel,
    clientRequestId: v.clientRequestId,
  };
  if (!options.skipLimits) {
    try {
      await enforceAiLimits(ctx);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        await insertRun(db, { ...base, status: "rate_limited" });
        return { ok: false, runId: null, status: "rate_limited", message: `${error.message} Try again in ${error.retryAfterSeconds} seconds.` };
      }
      throw error;
    }
  }
  const runId = await insertRun(db, base);
  if (!runId) return { ok: false, runId: null, status: "error", message: "This request is already being handled." };

  const started = Date.now();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let status: RunStatus = "ok";
  let value: z.infer<S> | null = null;
  try {
    const jsonSchema = jsonSchemaOf(v.schema);
    let prompt = v.prompt;
    for (let attempt = 0; attempt < 2 && value === null; attempt++) {
      const out = await session.provider.structured({
        model: session.fastModel,
        system: v.system,
        prompt,
        jsonSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        signal: AbortSignal.timeout(20_000),
      });
      usage.inputTokens += out.usage.inputTokens;
      usage.outputTokens += out.usage.outputTokens;
      const parsed = parseModelJson(v.schema, out.text);
      if (parsed.ok) value = parsed.value;
      else prompt = `${v.prompt}\n\n${repairInstruction(parsed.issues)}`;
    }
    if (value === null) status = "invalid_output";
    else if (session.fellBack()) status = "fallback_mock";
  } catch (error) {
    const kind = (error as { kind?: string }).kind;
    status = kind === "timeout" ? "timeout" : kind === "refused" ? "refused" : kind === "rate_limit" ? "rate_limited" : "error";
    if (status === "error") logError("ai structured failed", error, { runId });
  }
  const actual = session.actual();
  await finishRun(db, {
    id: runId,
    workspaceId: ctx.workspaceId,
    status,
    toolCalls: [],
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - started,
    costMicroUsd: estimateCostMicroUsd(actual.provider === "mock" ? "mock-1" : session.fastModel, usage.inputTokens, usage.outputTokens),
    provider: actual.provider,
    model: actual.provider === "mock" ? "mock-1" : session.fastModel,
    questionRedacted: base.questionRedacted,
  });
  if (value === null) {
    return {
      ok: false,
      runId,
      status,
      message: status === "invalid_output" ? "I couldn't produce a valid result for that. Nothing was created; please rephrase or fill in the form yourself." : "The assistant couldn't answer just now. Nothing was created; please try again.",
    };
  }
  return { ok: true, value, runId, provider: actual.provider };
}

// ------------------------------------------------------------ proposals
export interface Match {
  id: string;
  name: string;
}

export interface ProposalLine {
  query: string;
  quantity: number;
  unitPriceKobo: number | null;
  status: "matched" | "ambiguous" | "not_found";
  selected: (Match & { priceKobo: number; unit: string }) | null;
  candidates: Match[];
}

export interface ProposalPayload {
  note: string;
  customer: { query: string; status: "matched" | "ambiguous" | "not_found"; selected: Match | null; candidates: Match[] };
  lines: ProposalLine[];
  deliveryFeeKobo: number;
  discountKobo: number;
  dueDate: string | null;
  /** Things the person must decide; never guessed silently. */
  questions: string[];
}

function decide<T extends { name: string; score: number }>(query: string, rows: T[]): { status: "matched" | "ambiguous" | "not_found"; pick: T | null } {
  if (rows.length === 0) return { status: "not_found", pick: null };
  const exact = rows.filter((r) => r.name.toLowerCase() === query.toLowerCase());
  if (exact.length === 1) return { status: "matched", pick: exact[0]! };
  const [top, second] = rows;
  if (top && top.score >= 0.45 && (!second || top.score - second.score >= 0.15)) return { status: "matched", pick: top };
  if (rows.length === 1 && top && top.score >= 0.3) return { status: "matched", pick: top };
  return { status: "ambiguous", pick: null };
}

/** Server-side matching: the model only names things; the database finds them. */
async function matchDraft(ctx: Ctx, note: string, draft: InvoiceDraft): Promise<ProposalPayload> {
  const questions: string[] = [];
  const customers = await searchCustomers(db, ctx.workspaceId, draft.customer_query, 4);
  const c = decide(draft.customer_query, customers);
  if (c.status === "ambiguous") questions.push(`Which customer is “${draft.customer_query}”? ${customers.slice(0, 3).map((x) => x.name).join(", ")}?`);
  if (c.status === "not_found") questions.push(`No customer matches “${draft.customer_query}”. Choose one, or add them first.`);

  const lines: ProposalLine[] = [];
  for (const l of draft.lines) {
    const products = await searchProducts(db, ctx.workspaceId, l.product_query, 4);
    const p = decide(l.product_query, products);
    if (p.status === "ambiguous") questions.push(`Which product is “${l.product_query}”? ${products.slice(0, 3).map((x) => x.name).join(", ")}?`);
    if (p.status === "not_found") questions.push(`No product matches “${l.product_query}”. It will be a free-text line unless you pick one.`);
    lines.push({
      query: l.product_query,
      quantity: l.quantity,
      unitPriceKobo: l.unit_price_kobo ?? null,
      status: p.status,
      selected: p.pick ? { id: p.pick.id, name: p.pick.name, priceKobo: p.pick.priceKobo, unit: p.pick.unit } : null,
      candidates: products.slice(0, 4).map((x) => ({ id: x.id, name: x.name })),
    });
  }
  return {
    note,
    customer: {
      query: draft.customer_query,
      status: c.status,
      selected: c.pick ? { id: c.pick.id, name: c.pick.name } : null,
      candidates: customers.slice(0, 4).map((x) => ({ id: x.id, name: x.name })),
    },
    lines,
    deliveryFeeKobo: draft.delivery_fee_kobo,
    discountKobo: draft.discount_kobo,
    dueDate: draft.due_date ?? null,
    questions,
  };
}

/** Text in, a PENDING proposal out. Nothing in the books changes here. */
export async function draftInvoiceFromText(
  ctx: Ctx,
  input: { text: string; clientRequestId: string },
  options: RunOptions = {},
): Promise<{ ok: true; proposalId: string } | { ok: false; message: string }> {
  assertCan(ctx, "invoice.create");
  const today = todayInLagos();
  const out = await structuredRun(
    ctx,
    {
      kind: "invoice_draft",
      logText: "Draft an invoice from a sales note",
      system: INVOICE_DRAFT_SYSTEM,
      prompt: invoiceDraftPrompt(input.text, today),
      schema: invoiceDraftSchema,
      clientRequestId: input.clientRequestId,
    },
    options,
  );
  if (!out.ok) {
    if (out.existing && out.runId) {
      const rows = await db.query<{ id: string }>("SELECT id FROM ai_proposals WHERE workspace_id = $1 AND run_id = $2", [ctx.workspaceId, out.runId]);
      if (rows[0]) return { ok: true, proposalId: rows[0].id };
    }
    return { ok: false, message: out.message };
  }
  const payload = await matchDraft(ctx, input.text, out.value);
  const rows = await db.query<{ id: string }>(
    `INSERT INTO ai_proposals (workspace_id, run_id, kind, payload, created_by, expires_at)
     VALUES ($1, $2, 'invoice', $3, $4, now() + make_interval(hours => $5)) RETURNING id`,
    [ctx.workspaceId, out.runId, JSON.stringify(payload), ctx.userId, PROPOSAL_TTL_HOURS],
  );
  return { ok: true, proposalId: rows[0]!.id };
}

export interface Proposal {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  payload: ProposalPayload;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  resultingInvoiceId: string | null;
  createdBy: string | null;
  createdByName: string | null;
}

function mapProposal(r: Record<string, unknown>): Proposal {
  const expired = r.status === "pending" && toDate(r.expires_at).getTime() < Date.now();
  return {
    id: String(r.id),
    status: expired ? "expired" : (r.status as Proposal["status"]),
    payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as ProposalPayload,
    createdAt: toDate(r.created_at),
    expiresAt: toDate(r.expires_at),
    decidedAt: toDateOrNull(r.decided_at),
    resultingInvoiceId: (r.resulting_invoice_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
  };
}

const PROPOSAL_SELECT = `SELECT p.*, u.name AS created_by_name FROM ai_proposals p LEFT JOIN users u ON u.id = p.created_by`;

export async function getProposal(ctx: Ctx, id: string): Promise<Proposal> {
  assertCan(ctx, "invoice.view");
  const rows = await db.query<Record<string, unknown>>(`${PROPOSAL_SELECT} WHERE p.workspace_id = $1 AND p.id = $2`, [ctx.workspaceId, id]);
  if (!rows[0]) throw new NotFoundError("Proposal");
  return mapProposal(rows[0]);
}

export async function listProposals(ctx: Ctx, limit = 10): Promise<Proposal[]> {
  assertCan(ctx, "invoice.view");
  const rows = await db.query<Record<string, unknown>>(
    `${PROPOSAL_SELECT} WHERE p.workspace_id = $1 ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT $2`,
    [ctx.workspaceId, limit],
  );
  return rows.map(mapProposal);
}

/**
 * Approving runs the edited invoice through the SAME schema (the caller
 * parsed it with invoiceSchema) and the SAME createInvoiceTx the manual form
 * uses: same permission check, same customer/product checks, same
 * server-computed totals, same gapless number. Nothing from the stored
 * payload is trusted: it came from a model, and prices, stock and the
 * approver's role may have changed since it was drafted.
 * The proposal row is locked, must still be pending, and the invoice's
 * idempotency key IS the proposal id, so approving twice can't make two.
 */
export async function approveProposal(ctx: Ctx, id: string, input: InvoiceInput): Promise<string> {
  assertCan(ctx, "invoice.create");
  return transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>("SELECT id, status, expires_at FROM ai_proposals WHERE workspace_id = $1 AND id = $2 FOR UPDATE", [
      ctx.workspaceId,
      id,
    ]);
    const p = rows[0];
    if (!p) throw new NotFoundError("Proposal");
    if (p.status !== "pending") throw new ConflictError(`This proposal was already ${String(p.status)}.`);
    if (toDate(p.expires_at).getTime() < Date.now()) throw new ConflictError("This proposal has expired. Draft it again.");
    const created = await createInvoiceTx(tx, ctx, { ...input, clientRequestId: id });
    await tx.query(
      "UPDATE ai_proposals SET status = 'approved', decided_by = $3, decided_at = now(), resulting_invoice_id = $4 WHERE workspace_id = $1 AND id = $2",
      [ctx.workspaceId, id, ctx.userId, created.id],
    );
    await audit(tx, ctx, "ai_proposal.approve", "invoice", created.id, { proposal: id });
    return created.id;
  });
}

export async function rejectProposal(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, "invoice.create");
  await transaction(async (tx) => {
    const rows = await tx.query(
      "UPDATE ai_proposals SET status = 'rejected', decided_by = $3, decided_at = now() WHERE workspace_id = $1 AND id = $2 AND status = 'pending' RETURNING id",
      [ctx.workspaceId, id, ctx.userId],
    );
    if (!rows.length) throw new ConflictError("This proposal is no longer pending.");
    await audit(tx, ctx, "ai_proposal.reject", "ai_proposal", id);
  });
}

// ------------------------------------------------------------ reminders
export async function draftReminder(
  ctx: Ctx,
  input: { invoiceId: string; tone: "polite" | "firm" | "final"; language: "english" | "pidgin"; clientRequestId: string },
  options: RunOptions = {},
): Promise<{ ok: true; message: string; phone: string | null; unverified: string[]; provider: string } | { ok: false; message: string }> {
  assertCan(ctx, "invoice.view");
  const invoice = await getInvoice(ctx, input.invoiceId);
  if (invoice.status !== "sent" && invoice.status !== "partly_paid") throw new ValidationError("Only unpaid invoices need a reminder.");
  const ws = await db.query<{ name: string; bank_details: string | null }>("SELECT name, bank_details FROM workspaces WHERE id = $1", [ctx.workspaceId]);
  const today = todayInLagos();
  const facts = {
    customer: invoice.customer.name,
    invoice: invoice.label,
    balance: { kobo: invoice.balanceKobo, naira: formatNaira(invoice.balanceKobo) },
    due_date: formatDate(invoice.dueDate),
    days_overdue: Math.max(0, Math.round((Date.parse(today) - Date.parse(invoice.dueDate)) / 86_400_000)),
    business: ws[0]?.name ?? "",
    bank_details: ws[0]?.bank_details ?? null,
    tone: input.tone,
    language: input.language,
  };
  const out = await structuredRun(
    ctx,
    {
      kind: "reminder",
      logText: `Payment reminder (${input.tone}, ${input.language})`,
      system: REMINDER_SYSTEM,
      prompt: `${wrapUntrusted("invoice_facts", facts)}\nWrite a ${input.tone} reminder in ${input.language === "pidgin" ? "Nigerian Pidgin" : "English"}.`,
      schema: reminderOutputSchema,
      clientRequestId: input.clientRequestId,
    },
    options,
  );
  if (!out.ok) return { ok: false, message: out.message };
  const unverified = checkNumbers(out.value.message, [facts]).filter((f) => !f.verified).map((f) => f.text);
  return { ok: true, message: out.value.message, phone: invoice.customer.whatsapp ?? invoice.customer.phone, unverified, provider: out.provider };
}

// ------------------------------------------------------------ weekly summary
/** SQL computes every number; the model only narrates them. */
export async function weeklySummary(
  ctx: Ctx,
  input: { clientRequestId: string },
  options: RunOptions = {},
): Promise<
  | { ok: true; narration: string; facts: { label: string; value: string }[]; unverified: string[]; provider: string; period: string }
  | { ok: false; message: string }
> {
  assertCan(ctx, "report.basic");
  const today = todayInLagos();
  const week = resolvePreset("last_7_days", today);
  const prevTo = addDays(week.from, -1);
  const prevFrom = addDays(prevTo, -6);
  const [now, before, owed, low] = await Promise.all([
    reports.summary(db, ctx.workspaceId, week.from, week.to),
    reports.summary(db, ctx.workspaceId, prevFrom, prevTo),
    reports.owed(db, ctx.workspaceId, today),
    reports.lowStock(db, ctx.workspaceId, 20),
  ]);
  const money = (k: number) => ({ kobo: k, naira: formatNaira(k) });
  const profit = can(ctx.role, "report.profit");
  const data = {
    period: week.label,
    this_week: { invoices_sent: now.invoiceCount, sales: money(now.salesKobo), payments_received: money(now.paymentsKobo), ...(profit ? { estimated_profit: money(now.estimatedProfitKobo) } : {}) },
    last_week: { invoices_sent: before.invoiceCount, sales: money(before.salesKobo), payments_received: money(before.paymentsKobo) },
    owed_now: { ...money(owed.owedKobo), open_invoices: owed.openCount },
    overdue_now: { ...money(owed.overdueKobo), invoices: owed.overdueCount },
    low_stock_count: low.length,
  };
  const out = await structuredRun(
    ctx,
    {
      kind: "summary",
      logText: "Weekly business summary",
      system: SUMMARY_SYSTEM,
      prompt: `${wrapUntrusted("weekly_numbers", data)}\nNarrate this week for the owner.`,
      schema: summaryOutputSchema,
      clientRequestId: input.clientRequestId,
    },
    options,
  );
  if (!out.ok) return { ok: false, message: out.message };
  const unverified = checkNumbers(out.value.narration, [data]).filter((f) => !f.verified).map((f) => f.text);
  await saveAnswer(db, { runId: out.runId, workspaceId: ctx.workspaceId, question: "Weekly summary", answer: out.value.narration, toolsUsed: [], figures: [], unverified });
  const facts = [
    { label: "Invoices sent (last 7 days)", value: String(now.invoiceCount) },
    { label: "Sales (last 7 days)", value: formatNaira(now.salesKobo) },
    { label: "Sales (7 days before)", value: formatNaira(before.salesKobo) },
    { label: "Payments received (last 7 days)", value: formatNaira(now.paymentsKobo) },
    ...(profit ? [{ label: "Estimated profit (last 7 days)", value: formatNaira(now.estimatedProfitKobo) }] : []),
    { label: "Owed now", value: `${formatNaira(owed.owedKobo)} on ${owed.openCount} invoices` },
    { label: "Overdue now", value: `${formatNaira(owed.overdueKobo)} on ${owed.overdueCount} invoices` },
    { label: "Products running low", value: String(low.length) },
  ];
  return { ok: true, narration: out.value.narration, facts, unverified, provider: out.provider, period: week.label };
}

// ------------------------------------------------------------ feedback & usage
export async function rateAnswer(ctx: Ctx, input: { runId: string; rating: "up" | "down"; reason?: string | undefined }): Promise<void> {
  assertCan(ctx, "ai.ask");
  const run = await db.query("SELECT 1 FROM ai_runs WHERE workspace_id = $1 AND id = $2", [ctx.workspaceId, input.runId]);
  if (!run.length) throw new NotFoundError("Answer");
  await db.query(
    `INSERT INTO ai_feedback (workspace_id, run_id, user_id, rating, reason) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT ai_feedback_one_per_user DO UPDATE SET rating = EXCLUDED.rating, reason = EXCLUDED.reason, created_at = now()`,
    [ctx.workspaceId, input.runId, ctx.userId, input.rating, input.rating === "down" ? (input.reason?.slice(0, 500) ?? null) : null],
  );
}

export async function thumbsDown(ctx: Ctx, limit = 20) {
  assertCan(ctx, "ai.usage");
  const rows = await db.query<Record<string, unknown>>(
    `SELECT f.reason, f.created_at, r.kind, r.question_text_redacted, u.name
       FROM ai_feedback f JOIN ai_runs r ON r.id = f.run_id LEFT JOIN users u ON u.id = f.user_id
      WHERE f.workspace_id = $1 AND f.rating = 'down' ORDER BY f.created_at DESC LIMIT $2`,
    [ctx.workspaceId, limit],
  );
  return rows.map((r) => ({
    reason: (r.reason as string | null) ?? null,
    createdAt: toDate(r.created_at),
    kind: String(r.kind),
    question: String(r.question_text_redacted),
    by: (r.name as string | null) ?? "Former member",
  }));
}

export async function feedbackCounts(ctx: Ctx): Promise<{ up: number; down: number }> {
  assertCan(ctx, "ai.usage");
  const rows = await db.query<{ up: unknown; down: unknown }>(
    "SELECT count(*) FILTER (WHERE rating = 'up') AS up, count(*) FILTER (WHERE rating = 'down') AS down FROM ai_feedback WHERE workspace_id = $1",
    [ctx.workspaceId],
  );
  return { up: int(rows[0]?.up ?? 0), down: int(rows[0]?.down ?? 0) };
}
