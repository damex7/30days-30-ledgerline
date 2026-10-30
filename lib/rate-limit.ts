import "server-only";
import { db, int, toDate, type Db } from "@/lib/db";
import { RateLimitedError } from "@/lib/errors";

// Fixed-window counter in Postgres. One statement both creates the window's
// row and increments it (INSERT ... ON CONFLICT DO UPDATE), and Postgres
// makes that atomic, so two requests landing at once both get counted. On
// serverless every request may run in a fresh instance, so an in-memory Map
// would start at zero each time and limit nothing; the database is shared.

export interface Limit {
  /** For example "signin:ada@x.com" or "ai:user:<id>:minute". */
  key: string;
  max: number;
  windowSeconds: number;
}

export interface LimitResult {
  ok: boolean;
  count: number;
  retryAfterSeconds: number;
}

export async function hit(limit: Limit, client: Db = db): Promise<LimitResult> {
  const rows = await client.query<{ count: unknown; window_start: unknown }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count, window_start`,
    [limit.key, limit.windowSeconds],
  );
  const row = rows[0];
  if (!row) throw new Error("rate limit upsert returned nothing");
  const count = int(row.count);
  const windowEnds = toDate(row.window_start).getTime() + limit.windowSeconds * 1000;
  return {
    ok: count <= limit.max,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnds - Date.now()) / 1000)),
  };
}

/** Counts the hit and throws RateLimitedError when over the limit. */
export async function enforce(limit: Limit, message: string, client: Db = db): Promise<void> {
  const result = await hit(limit, client);
  if (!result.ok) throw new RateLimitedError(message, result.retryAfterSeconds);
}

/** Reads the current count without counting (for "x of y used today"). */
export async function peek(key: string, windowSeconds: number): Promise<number> {
  const rows = await db.query<{ count: unknown }>(
    `SELECT count FROM rate_limits
      WHERE key = $1 AND window_start = to_timestamp(floor(extract(epoch FROM now()) / $2) * $2)`,
    [key, windowSeconds],
  );
  return rows[0] ? int(rows[0].count) : 0;
}

/** Clears a key (a successful sign-in resets the failure counter). */
export async function reset(key: string): Promise<void> {
  await db.query("DELETE FROM rate_limits WHERE key = $1", [key]);
}
