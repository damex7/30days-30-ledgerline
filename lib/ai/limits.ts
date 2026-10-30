// Every limit on the assistant, in one place, and why it exists. They are
// deliberately low: a free tier allows only a handful of requests per minute
// and per day for the whole project, so one enthusiastic user (or a loop)
// must not use up everyone's quota.

/** Long questions cost tokens and are a favourite place to hide injections. */
export const MAX_QUESTION_CHARS = 500;
/** Invoice-from-text requests are a sentence or two. */
export const MAX_DRAFT_CHARS = 600;
/** Bursts: protects the provider's per-minute quota. */
export const USER_PER_MINUTE = 6;
/** One person's share of the day. */
export const USER_PER_DAY = 40;
/** A business's share of the day (several staff share it). */
export const WORKSPACE_PER_DAY = 150;
/** Short answers: cheaper, faster and easier to check. */
export const MAX_OUTPUT_TOKENS = 700;
/** A question may lead to at most 4 model round trips (tool calls). Stops loops. */
export const MAX_TOOL_ROUNDS = 4;
/** Hard cap on rows any tool returns to the model. */
export const MAX_TOOL_ROWS = 20;
/** Each tool query gets this long before Postgres cancels it. */
export const TOOL_STATEMENT_TIMEOUT_MS = 3_000;
/** The whole request, all rounds included. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Pending proposals expire so stale prices aren't approved weeks later. */
export const PROPOSAL_TTL_HOURS = 48;
