// Errors services throw on purpose. Actions and route handlers turn them
// into a 404 page, a 403 message, field errors or a 429 with Retry-After.

/**
 * The record doesn't exist IN THIS WORKSPACE. A record that belongs to
 * another business is reported exactly like one that doesn't exist (404, not
 * 403): a 403 would confirm "yes, invoice 7f3c... is real, just not yours",
 * which leaks that another business exists and how busy it is.
 */
export class NotFoundError extends Error {
  override name = "NotFoundError";
  constructor(what = "Record") {
    super(`${what} not found`);
  }
}

/** Signed in and in the right workspace, but this role may not do this. */
export class ForbiddenError extends Error {
  override name = "ForbiddenError";
  constructor(message = "Your role doesn't allow this.") {
    super(message);
  }
}

export type FieldErrors = Record<string, string[] | undefined>;

/** Input broke a business rule; fieldErrors map to form fields. */
export class ValidationError extends Error {
  override name = "ValidationError";
  readonly fieldErrors: FieldErrors;
  constructor(message: string, fieldErrors: FieldErrors = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

/** The request is valid but the record's state doesn't allow it. */
export class ConflictError extends Error {
  override name = "ConflictError";
}

export class RateLimitedError extends Error {
  override name = "RateLimitedError";
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Not signed in (or the session ended). */
export class UnauthenticatedError extends Error {
  override name = "UnauthenticatedError";
  constructor() {
    super("Please sign in.");
  }
}
