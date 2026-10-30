import { isIsoDate } from "@/lib/dates";

// Keyset ("seek") pagination cursors. Instead of OFFSET 400 (which makes
// Postgres read and throw away 400 rows, slower every page, and shows
// duplicates or skips rows when someone adds an invoice between page loads),
// the next page asks for rows strictly after the last one seen:
//   WHERE (issue_date, id) < ($date, $id) ORDER BY issue_date DESC, id DESC
// The id is the tie-breaker: many invoices share a date, and without it rows
// with the same date could repeat or vanish between pages.
// The cursor is opaque text in the URL; it is validated, never trusted.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}

function decode(cursor: string | undefined): string[] | null {
  if (!cursor || cursor.length > 200) return null;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8").split("|");
  } catch {
    return null;
  }
}

/** (date, id) cursors for invoices and expenses. */
export function decodeDateCursor(cursor: string | undefined): { date: string; id: string } | null {
  const parts = decode(cursor);
  if (!parts || parts.length !== 2) return null;
  const [date, id] = parts as [string, string];
  return isIsoDate(date) && UUID.test(id) ? { date, id } : null;
}

/** (timestamp, id) cursors for payments, audit events and AI history. */
export function decodeTimeCursor(cursor: string | undefined): { at: string; id: string } | null {
  const parts = decode(cursor);
  if (!parts || parts.length !== 2) return null;
  const [at, id] = parts as [string, string];
  return !Number.isNaN(Date.parse(at)) && (UUID.test(id) || /^\d{1,19}$/.test(id)) ? { at, id } : null;
}

/** (name, id) cursors for alphabetical lists. */
export function decodeNameCursor(cursor: string | undefined): { name: string; id: string } | null {
  const parts = decode(cursor);
  if (!parts || parts.length !== 2) return null;
  const [name, id] = parts as [string, string];
  return name.length <= 120 && UUID.test(id) ? { name, id } : null;
}

export const PAGE_SIZE = 25;
