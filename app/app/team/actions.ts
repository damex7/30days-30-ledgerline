"use server";

import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { changeRole, invite, removeMember, revokeInvitation } from "@/lib/services/team";
import { inviteSchema, memberIdSchema, roleChangeSchema } from "@/lib/validation/team";
import { uuid } from "@/lib/validation/common";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";

export async function inviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    const { link } = await invite(ctx, parsed.data);
    // Shown once to the owner so it can also be shared by hand.
    return { status: "success", message: `Invitation sent to ${parsed.data.email}. You can also share this link with them: ${link}` };
  } catch (error) {
    return actionError(error, values);
  }
}

export async function changeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = roleChangeSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await changeRole(ctx, parsed.data.userId, parsed.data.role);
  } catch (error) {
    return actionError(error, values);
  }
  redirect("/app/team?notice=role");
}

export async function removeMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = memberIdSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await removeMember(ctx, parsed.data.userId);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(parsed.data.userId === ctx.userId ? "/workspaces" : "/app/team?notice=removed");
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  await revokeInvitation(ctx, uuid.parse(formData.get("id")));
  redirect("/app/team?notice=revoked");
}
