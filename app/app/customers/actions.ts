"use server";

import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { customerSchema } from "@/lib/validation/business";
import { uuid } from "@/lib/validation/common";
import { archiveCustomer, createCustomer, updateCustomer } from "@/lib/services/customers";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";

// Thin actions: parse with Zod, call the service with the context, shape the response.

export async function saveCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = customerSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  const id = uuid.safeParse(values.id);
  let target: string;
  try {
    if (id.success) {
      await updateCustomer(ctx, id.data, parsed.data);
      target = id.data;
    } else {
      target = await createCustomer(ctx, parsed.data);
    }
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/customers/${target}?notice=saved`);
}

export async function archiveCustomerAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = uuid.parse(formData.get("id"));
  await archiveCustomer(ctx, id, formData.get("archived") === "true");
  redirect(`/app/customers/${id}?notice=${formData.get("archived") === "true" ? "archived" : "restored"}`);
}
