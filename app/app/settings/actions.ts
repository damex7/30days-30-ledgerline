"use server";

import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { deleteWorkspace, updateWorkspaceDetails } from "@/lib/services/workspaces";
import { changePassword } from "@/lib/services/auth";
import { workspaceDetailsSchema } from "@/lib/validation/workspace";
import { changePasswordSchema } from "@/lib/validation/auth";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";

export async function saveDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = workspaceDetailsSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await updateWorkspaceDetails(ctx, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  return { status: "success", message: "Business details saved.", values };
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error, {});
  try {
    await changePassword({ userId: ctx.userId, sessionId: ctx.user.sessionId }, parsed.data);
  } catch (error) {
    return actionError(error, {});
  }
  return { status: "success", message: "Password changed. You've been signed out on every other device." };
}

export async function deleteWorkspaceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  try {
    await deleteWorkspace(ctx, values.confirmName ?? "");
  } catch (error) {
    return actionError(error, values);
  }
  redirect("/workspaces?notice=deleted");
}
