import "server-only";
import { DatabaseUnavailableError } from "@/lib/db";
import { ForbiddenError, NotFoundError, RateLimitedError, UnauthenticatedError, ValidationError, ConflictError } from "@/lib/errors";
import { logError } from "@/lib/log";

/** Route handlers: known errors become clean JSON with the right status. */
export function errorResponse(error: unknown): Response {
  if (error instanceof UnauthenticatedError) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (error instanceof NotFoundError) return Response.json({ error: "Not found." }, { status: 404 });
  if (error instanceof ForbiddenError) return Response.json({ error: error.message }, { status: 403 });
  if (error instanceof ValidationError) return Response.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 });
  if (error instanceof ConflictError) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof RateLimitedError) {
    return Response.json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  }
  if (error instanceof DatabaseUnavailableError) return Response.json({ error: "The database can't be reached right now." }, { status: 503 });
  logError("route failed", error);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}
