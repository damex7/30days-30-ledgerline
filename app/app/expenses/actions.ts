"use server";

import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { expenseSchema } from "@/lib/validation/business";
import { uuid } from "@/lib/validation/common";
import { createExpense, deleteExpense, updateExpense } from "@/lib/services/expenses";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";

export async function saveExpenseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = expenseSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  const id = uuid.safeParse(values.id);
  try {
    if (id.success) await updateExpense(ctx, id.data, parsed.data);
    else await createExpense(ctx, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/expenses?notice=${id.success ? "updated" : "saved"}`);
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  await deleteExpense(ctx, uuid.parse(formData.get("id")));
  redirect("/app/expenses?notice=deleted");
}
