import "server-only";
import { int, toDate, toDateOrNull, type Db, type Param } from "@/lib/db";
import type { CustomerInput } from "@/lib/validation/business";

// SQL only. Every query is scoped with workspace_id = $1: a repo function
// cannot even express "a customer from any workspace".

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  tags: string[];
  archivedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  /** Computed from open invoices; never stored, never typed. */
  balanceKobo: number;
}

type Row = Record<string, unknown>;

/** Balance owed = what's left on sent and partly paid invoices. */
export const BALANCE_SQL = `COALESCE((
  SELECT SUM(i.total_kobo - i.amount_paid_kobo) FROM invoices i
   WHERE i.workspace_id = c.workspace_id AND i.customer_id = c.id AND i.status IN ('sent', 'partly_paid')
), 0)`;

const COLUMNS = `c.id, c.name, c.phone, c.whatsapp, c.email, c.notes, c.tags, c.archived_at, c.created_by, c.created_at,
  ${BALANCE_SQL} AS balance_kobo`;

export function mapCustomer(r: Row): Customer {
  return {
    id: String(r.id),
    name: String(r.name),
    phone: (r.phone as string | null) ?? null,
    whatsapp: (r.whatsapp as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    archivedAt: toDateOrNull(r.archived_at),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: toDate(r.created_at),
    balanceKobo: int(r.balance_kobo ?? 0),
  };
}

/** Escapes LIKE wildcards so a search for "50%" means the text "50%". */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function findCustomer(db: Db, workspaceId: string, id: string): Promise<Customer | null> {
  const rows = await db.query<Row>(`SELECT ${COLUMNS} FROM customers c WHERE c.workspace_id = $1 AND c.id = $2`, [workspaceId, id]);
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function listCustomers(
  db: Db,
  workspaceId: string,
  options: { q?: string | undefined; after?: { name: string; id: string } | null; limit: number; archived?: boolean },
): Promise<Customer[]> {
  const params: Param[] = [workspaceId];
  const where = ["c.workspace_id = $1", options.archived ? "c.archived_at IS NOT NULL" : "c.archived_at IS NULL"];
  if (options.q) {
    params.push(`%${likeEscape(options.q.toLowerCase())}%`, options.q.toLowerCase());
    where.push(`(lower(c.name) LIKE $${params.length - 1} OR lower(c.name) % $${params.length} OR c.phone LIKE $${params.length - 1})`);
  }
  if (options.after) {
    params.push(options.after.name, options.after.id);
    where.push(`(lower(c.name), c.id) > ($${params.length - 1}, $${params.length}::uuid)`);
  }
  params.push(options.limit);
  const rows = await db.query<Row>(
    `SELECT ${COLUMNS} FROM customers c WHERE ${where.join(" AND ")} ORDER BY lower(c.name), c.id LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapCustomer);
}

/**
 * Typo-tolerant search for pickers and the AI's find_customer tool. Trigram
 * similarity ranks "Mama Chidi" first for "mama chid" or "mama chidy".
 */
export async function searchCustomers(
  db: Db,
  workspaceId: string,
  query: string,
  limit: number,
): Promise<(Customer & { score: number })[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await db.query<Row>(
    `SELECT ${COLUMNS}, similarity(lower(c.name), $2) AS score
       FROM customers c
      WHERE c.workspace_id = $1 AND c.archived_at IS NULL
        AND (lower(c.name) % $2 OR lower(c.name) LIKE $3 OR word_similarity($2, lower(c.name)) > 0.45)
      ORDER BY (lower(c.name) = $2) DESC, similarity(lower(c.name), $2) DESC, lower(c.name)
      LIMIT $4`,
    [workspaceId, q, `%${likeEscape(q)}%`, limit],
  );
  return rows.map((r) => ({ ...mapCustomer(r), score: Number(r.score) }));
}

export async function insertCustomer(db: Db, workspaceId: string, userId: string, input: CustomerInput): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO customers (workspace_id, name, phone, whatsapp, email, notes, tags, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [workspaceId, input.name, input.phone, input.whatsapp, input.email, input.notes, input.tags, userId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("customer insert returned nothing");
  return id;
}

export async function updateCustomerRow(db: Db, workspaceId: string, id: string, input: CustomerInput): Promise<void> {
  await db.query(
    `UPDATE customers SET name = $3, phone = $4, whatsapp = $5, email = $6, notes = $7, tags = $8
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, input.name, input.phone, input.whatsapp, input.email, input.notes, input.tags],
  );
}

export async function setCustomerArchived(db: Db, workspaceId: string, id: string, archived: boolean): Promise<void> {
  await db.query(
    `UPDATE customers SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, archived],
  );
}
