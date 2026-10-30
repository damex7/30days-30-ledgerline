"use server";

import { redirect } from "next/navigation";
import { signInSchema, signUpSchema, safeNext } from "@/lib/validation/auth";
import { signIn, signUp } from "@/lib/services/auth";
import { clearSessionCookie, deleteSession, getSession, setSessionCookie } from "@/lib/auth/session";
import { clientIp } from "@/lib/request";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error, values);
  try {
    await signUp(parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  // The same message whether or not the email was already registered.
  const next = safeNext(values.next);
  redirect(`/sign-in?notice=created&email=${encodeURIComponent(parsed.data.email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return zodErrorState(parsed.error, values);
  let destination: string;
  try {
    const result = await signIn(parsed.data, await clientIp());
    await setSessionCookie(result.token);
    destination = safeNext(parsed.data.next) ?? (result.workspaceId ? "/app" : "/workspaces");
  } catch (error) {
    return actionError(error, values);
  }
  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) await deleteSession(session.sessionId);
  await clearSessionCookie();
  redirect("/sign-in?notice=signed-out");
}
