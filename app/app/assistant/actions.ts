"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { approveProposal, draftInvoiceFromText, draftReminder, rateAnswer, rejectProposal, weeklySummary } from "@/lib/services/assistant";
import { draftRequestSchema, feedbackSchema, reminderRequestSchema } from "@/lib/ai/schemas";
import { invoiceSchema } from "@/lib/validation/business";
import { uuid } from "@/lib/validation/common";
import { actionError } from "@/lib/action-errors";
import { errorState, formValues, zodErrorState, type FormState } from "@/lib/forms";

export async function draftInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = draftRequestSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  let proposalId: string;
  try {
    const result = await draftInvoiceFromText(ctx, parsed.data);
    if (!result.ok) return errorState(result.message, values);
    proposalId = result.proposalId;
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/assistant/proposals/${proposalId}`);
}

/** The proposal editor posts the same fields as the invoice form. */
export async function approveProposalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const proposalId = uuid.safeParse(values.proposalId);
  if (!proposalId.success) return errorState("Missing proposal.", values);
  let items: unknown;
  try {
    items = JSON.parse(values.items ?? "[]");
  } catch {
    return errorState("The items couldn't be read; reload and try again.", values);
  }
  // Re-validated from scratch with the normal invoice schema.
  const parsed = invoiceSchema.safeParse({ ...values, items, send: values.intent === "send" });
  if (!parsed.success) return zodErrorState(parsed.error, values);
  let invoiceId: string;
  try {
    invoiceId = await approveProposal(ctx, proposalId.data, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/invoices/${invoiceId}?notice=${parsed.data.send ? "sent" : "saved"}`);
}

export async function rejectProposalAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = uuid.parse(formData.get("proposalId"));
  await rejectProposal(ctx, id).catch(() => undefined);
  redirect("/app/assistant?notice=rejected");
}

export type ReminderState = (
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; message: string; phone: string | null; unverified: string[]; provider: string }
) & { nextRequestId?: string };

export async function reminderAction(prev: ReminderState, formData: FormData): Promise<ReminderState> {
  return { ...(await reminder(prev, formData)), nextRequestId: randomUUID() };
}

async function reminder(_prev: ReminderState, formData: FormData): Promise<ReminderState> {
  const ctx = await getContext();
  const parsed = reminderRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Choose an invoice, a tone and a language." };
  try {
    const r = await draftReminder(ctx, parsed.data);
    if (!r.ok) return { status: "error", message: r.message };
    return { status: "ok", message: r.message, phone: r.phone, unverified: r.unverified, provider: r.provider };
  } catch (error) {
    const state = actionError(error, {});
    return { status: "error", message: state.status === "error" ? state.message : "Something went wrong." };
  }
}

export type SummaryState = (
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; narration: string; facts: { label: string; value: string }[]; unverified: string[]; provider: string; period: string }
) & { nextRequestId?: string };

export async function summaryAction(prev: SummaryState, formData: FormData): Promise<SummaryState> {
  return { ...(await summary(prev, formData)), nextRequestId: randomUUID() };
}

async function summary(_prev: SummaryState, formData: FormData): Promise<SummaryState> {
  const ctx = await getContext();
  const id = z.uuid().safeParse(formData.get("clientRequestId"));
  if (!id.success) return { status: "error", message: "Reload the page and try again." };
  try {
    const r = await weeklySummary(ctx, { clientRequestId: id.data });
    if (!r.ok) return { status: "error", message: r.message };
    return { status: "ok", ...r };
  } catch (error) {
    const state = actionError(error, {});
    return { status: "error", message: state.status === "error" ? state.message : "Something went wrong." };
  }
}

export async function feedbackAction(input: { runId: string; rating: "up" | "down"; reason?: string }): Promise<{ ok: boolean }> {
  const ctx = await getContext();
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  try {
    await rateAnswer(ctx, parsed.data);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
