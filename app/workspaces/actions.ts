"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/context";
import { createWorkspace, switchWorkspace } from "@/lib/services/workspaces";
import { createWorkspaceSchema } from "@/lib/validation/workspace";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";
import { enforce } from "@/lib/rate-limit";

export async function createWorkspaceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = formValues(formData);
  const parsed = createWorkspaceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await enforce({ key: `workspace:create:${user.userId}`, max: 10, windowSeconds: 86_400 }, "You've created a lot of workspaces today.");
    await createWorkspace(user, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect("/app");
}

export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formData.get("workspaceId"));
  if (!id.success) redirect("/workspaces");
  // Not a member: the service says "not found", and we simply stay here.
  try {
    await switchWorkspace(user, id.data);
  } catch {
    redirect("/workspaces?notice=not-found");
  }
  redirect("/app");
}
