import "server-only";
import { unstable_rethrow } from "next/navigation";
import { DatabaseUnavailableError } from "@/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";
import { errorState, type FormState } from "@/lib/forms";
import { logError } from "@/lib/log";

/** Turns a thrown service error into a form state; redirects pass through. */
export function actionError(error: unknown, values: Record<string, string>): FormState {
  unstable_rethrow(error);
  if (error instanceof ValidationError) return errorState(error.message, values, error.fieldErrors);
  if (error instanceof NotFoundError) return errorState("That record no longer exists.", values);
  if (error instanceof ForbiddenError || error instanceof ConflictError) return errorState(error.message, values);
  if (error instanceof RateLimitedError) {
    return errorState(`${error.message} Try again in ${Math.ceil(error.retryAfterSeconds / 60)} minute(s).`, values);
  }
  if (error instanceof UnauthenticatedError) return errorState("Your session ended. Please sign in again.", values);
  if (error instanceof DatabaseUnavailableError) {
    return errorState("We couldn't reach the database. Your input is still here; please try again.", values);
  }
  logError("action failed", error);
  return errorState("Something went wrong. Your input is still here; please try again.", values);
}
