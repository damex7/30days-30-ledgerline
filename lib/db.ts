import "server-only";
import { neon, Pool, type PoolClient } from "@neondatabase/serverless";

// The only module that talks to Postgres. Two rules:
//  1. Parameterised queries only: SQL text and values travel separately
//     ($1, $2 ...), so a customer called "'); DROP TABLE --" is just a name.
//  2. Multi-step writes go through transaction(): one connection, BEGIN ...
//     COMMIT, ROLLBACK if anything throws.

export type Row = Record<string, unknown>;
export type Param =
  | string
  | number
  | boolean
  | bigint
  | null
  | Date
  | readonly string[]
  | Record<string, unknown>
  | readonly Record<string, unknown>[];

/** Anything that can run a query: the shared client or an open transaction. */
export interface Db {
  query<T extends object = Row>(text: string, params?: readonly Param[]): Promise<T[]>;
}

/** Postgres is unreachable (or not configured): pages show a friendly screen. */
export class DatabaseUnavailableError extends Error {
  override name = "DatabaseUnavailableError";
}

/** A Postgres error with its SQLSTATE (23505 unique, 23503 FK, 23514 check). */
export class DatabaseError extends Error {
  override name = "DatabaseError";
  readonly code: string;
  readonly constraint: string | undefined;
  constructor(message: string, code: string, constraint: string | undefined, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.constraint = constraint;
  }
}

function url(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new DatabaseUnavailableError("DATABASE_URL is not set");
  return value;
}

function encode(params: readonly Param[]): unknown[] {
  // Plain objects (jsonb) go as JSON text; string arrays (text[]) pass through.
  return params.map((p) => {
    if (typeof p === "bigint") return p.toString();
    if (p === null || p instanceof Date || typeof p !== "object") return p;
    if (Array.isArray(p) && p.every((v) => typeof v === "string")) return p;
    return JSON.stringify(p);
  });
}

function wrap(error: unknown): Error {
  if (error instanceof DatabaseError || error instanceof DatabaseUnavailableError) return error;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
    return new DatabaseError(String(e.message), e.code, typeof e.constraint === "string" ? e.constraint : undefined, { cause: error });
  }
  // Next aborts in-flight work when a prerender finishes; let that through.
  if (error instanceof Error && /HANGING_PROMISE|prerender/i.test(error.message)) return error;
  return new DatabaseUnavailableError("The database could not be reached", { cause: error });
}

let http: ReturnType<typeof neon> | null = null;

/** One-shot queries over HTTP: nothing to hold open, ideal on serverless. */
export const db: Db = {
  async query<T extends object = Row>(text: string, params: readonly Param[] = []): Promise<T[]> {
    http ??= neon(url());
    try {
      return (await http.query(text, encode(params))) as T[];
    } catch (error) {
      throw wrap(error);
    }
  },
};

let pool: Pool | null = null;

export interface TransactionOptions {
  /** READ ONLY: Postgres itself refuses any INSERT/UPDATE/DELETE. */
  readOnly?: boolean;
  /** Cancels any single statement that runs longer than this. */
  statementTimeoutMs?: number;
}

/** Runs fn inside BEGIN/COMMIT on one pooled WebSocket connection. */
export async function transaction<T>(fn: (tx: Db) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  pool ??= new Pool({ connectionString: url() });
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw wrap(error);
  }
  const tx: Db = {
    async query<R extends object = Row>(text: string, params: readonly Param[] = []): Promise<R[]> {
      try {
        return (await client.query(text, encode(params))).rows as R[];
      } catch (error) {
        throw wrap(error);
      }
    },
  };
  try {
    await client.query(options.readOnly ? "BEGIN READ ONLY" : "BEGIN");
    if (options.statementTimeoutMs) {
      await client.query(`SET LOCAL statement_timeout = ${Math.trunc(options.statementTimeoutMs)}`);
    }
    const result = await fn(tx);
    await client.query("COMMIT").catch((error: unknown) => {
      throw wrap(error);
    });
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Scripts call this so Node can exit (the pool keeps a socket open). */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export const isUniqueViolation = (e: unknown, constraint?: string): boolean =>
  e instanceof DatabaseError && e.code === "23505" && (!constraint || e.constraint === constraint);
export const isCheckViolation = (e: unknown, constraint?: string): boolean =>
  e instanceof DatabaseError && e.code === "23514" && (!constraint || e.constraint === constraint);
export const isForeignKeyViolation = (e: unknown): boolean => e instanceof DatabaseError && e.code === "23503";

// ------------------------------------------------------------ row decoding
// The driver returns bigint as a string (it can exceed JS numbers in
// general). Kobo amounts here stay far below 2^53 (about ₦90 trillion), so
// they become plain integers, and anything outside that range is a bug we
// want to hear about, not a silently rounded number.

export function int(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Expected an integer from the database, got ${String(value)}`);
  return n;
}

export function intOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : int(value);
}

/** timestamptz may arrive as a Date or as "2026-10-30 09:15:00+00". */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const text = String(value).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`Bad timestamp from the database: ${String(value)}`);
  return date;
}

export function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}
