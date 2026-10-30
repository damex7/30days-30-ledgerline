import type { z } from "zod";
import type { FieldErrors } from "@/lib/errors";

// The shape every form action returns to useActionState. On an error the
// typed values come back too, so the form re-renders with what the person
// typed instead of an empty form (passwords are never echoed).

export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: FieldErrors; values: Record<string, string> }
  | { status: "success"; message: string; values?: Record<string, string> };

export const IDLE: FormState = { status: "idle" };

const NEVER_ECHO = /password|token/i;

export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !NEVER_ECHO.test(key) && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}

export function zodErrorState(error: z.ZodError, values: Record<string, string>): FormState {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values };
}

export function errorState(message: string, values: Record<string, string> = {}, fieldErrors: FieldErrors = {}): FormState {
  return { status: "error", message, fieldErrors, values };
}
