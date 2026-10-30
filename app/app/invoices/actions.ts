"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { invoiceSchema, paymentSchema, reversalSchema, voidSchema } from "@/lib/validation/business";
import { uuid } from "@/lib/validation/common";
import { createInvoice, sendInvoice, updateDraft, voidInvoice } from "@/lib/services/invoices";
import { recordPayment, reversePayment } from "@/lib/services/payments";
import { actionError } from "@/lib/action-errors";
import { errorState, formValues, zodErrorState, type FormState } from "@/lib/forms";

const itemsJson = z.string().transform((text, ctx) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    ctx.addIssue({ code: "custom", message: "The items couldn't be read; reload and try again." });
    return z.NEVER;
  }
});

/**
 * One action for "save draft" and "save and send" (the pressed button's
 * value). Any total the browser might have sent is simply not part of the
 * schema; the service computes every total itself.
 */
export async function saveInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const items = itemsJson.safeParse(values.items ?? "[]");
  if (!items.success) return zodErrorState(items.error, values);
  const parsed = invoiceSchema.safeParse({ ...values, items: items.data, send: values.intent === "send" });
  if (!parsed.success) return zodErrorState(parsed.error, values);

  const editing = uuid.safeParse(values.invoiceId);
  let id: string;
  try {
    if (editing.success) {
      await updateDraft(ctx, editing.data, parsed.data);
      id = editing.data;
    } else {
      id = (await createInvoice(ctx, parsed.data)).id;
    }
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/invoices/${id}?notice=${parsed.data.send ? "sent" : "saved"}`);
}

export async function sendInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const id = uuid.safeParse(formData.get("invoiceId"));
  if (!id.success) return errorState("Missing invoice.");
  try {
    await sendInvoice(ctx, id.data);
  } catch (error) {
    return actionError(error, {});
  }
  redirect(`/app/invoices/${id.data}?notice=sent`);
}

export async function voidInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const id = uuid.safeParse(values.invoiceId);
  const parsed = voidSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  if (!id.success) return errorState("Missing invoice.", values);
  try {
    await voidInvoice(ctx, id.data, parsed.data.reason);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/invoices/${id.data}?notice=voided`);
}

export async function recordPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = paymentSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await recordPayment(ctx, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/invoices/${parsed.data.invoiceId}?notice=paid`);
}

export async function reversePaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = reversalSchema.safeParse(values);
  const invoiceId = uuid.safeParse(values.invoiceId);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await reversePayment(ctx, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(invoiceId.success ? `/app/invoices/${invoiceId.data}?notice=reversed` : "/app/payments");
}
