import "server-only";
import { int, intOrNull, toDate, toDateOrNull, type Db, type Param } from "@/lib/db";
import { invoiceLabel, type ComputedInvoice } from "@/lib/invoice-math";
import type { InvoiceDisplayStatus } from "@/components/ui/status";

export type InvoiceStatus = "draft" | "sent" | "partly_paid" | "paid" | "void";

export interface InvoiceSummary {
  id: string;
  number: number;
  label: string;
  customerId: string;
  customerName: string;
  status: InvoiceStatus;
  /** status, with "overdue" derived from the due date. */
  displayStatus: InvoiceDisplayStatus;
  issueDate: string;
  dueDate: string;
  totalKobo: number;
  amountPaidKobo: number;
  balanceKobo: number;
  createdBy: string | null;
}

export interface InvoiceItem {
  id: string;
  position: number;
  productId: string | null;
  description: string;
  quantity: number;
  unitPriceKobo: number;
  unitCostKobo: number;
  lineTotalKobo: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  subtotalKobo: number;
  discountKobo: number;
  deliveryFeeKobo: number;
  notes: string | null;
  sentAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdByName: string | null;
  customer: { name: string; phone: string | null; whatsapp: string | null; email: string | null };
  items: InvoiceItem[];
}

type Row = Record<string, unknown>;

/** Overdue is derived at read time: open and past its due date (Lagos time). */
export function displayStatus(status: InvoiceStatus, dueDate: string, today: string): InvoiceDisplayStatus {
  if ((status === "sent" || status === "partly_paid") && dueDate < today) return "overdue";
  return status;
}

const SUMMARY = `i.id, i.number, w.invoice_prefix, i.customer_id, c.name AS customer_name, i.status,
  i.issue_date::text AS issue_date, i.due_date::text AS due_date, i.total_kobo, i.amount_paid_kobo, i.created_by`;
const FROM = `invoices i JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
  JOIN workspaces w ON w.id = i.workspace_id`;

function mapSummary(r: Row, today: string): InvoiceSummary {
  const status = r.status as InvoiceStatus;
  const totalKobo = int(r.total_kobo);
  const amountPaidKobo = int(r.amount_paid_kobo);
  const dueDate = String(r.due_date);
  return {
    id: String(r.id),
    number: int(r.number),
    label: invoiceLabel(String(r.invoice_prefix), int(r.number)),
    customerId: String(r.customer_id),
    customerName: String(r.customer_name),
    status,
    displayStatus: displayStatus(status, dueDate, today),
    issueDate: String(r.issue_date),
    dueDate,
    totalKobo,
    amountPaidKobo,
    balanceKobo: status === "void" ? 0 : totalKobo - amountPaidKobo,
    createdBy: (r.created_by as string | null) ?? null,
  };
}

export interface InvoiceQuery {
  status?: "draft" | "sent" | "partly_paid" | "paid" | "overdue" | "void" | "open" | undefined;
  customerId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  after?: { date: string; id: string } | null;
  limit: number;
}

export async function listInvoices(db: Db, workspaceId: string, today: string, q: InvoiceQuery): Promise<InvoiceSummary[]> {
  const params: Param[] = [workspaceId];
  const where = ["i.workspace_id = $1"];
  const add = (sql: (n: number) => string, value: Param) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (q.status === "overdue") add((n) => `i.status IN ('sent', 'partly_paid') AND i.due_date < $${n}::date`, today);
  else if (q.status === "open") where.push("i.status IN ('sent', 'partly_paid')");
  else if (q.status) add((n) => `i.status = $${n}`, q.status);
  if (q.customerId) add((n) => `i.customer_id = $${n}`, q.customerId);
  if (q.from) add((n) => `i.issue_date >= $${n}::date`, q.from);
  if (q.to) add((n) => `i.issue_date <= $${n}::date`, q.to);
  if (q.after) {
    params.push(q.after.date, q.after.id);
    where.push(`(i.issue_date, i.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  params.push(q.limit);
  const rows = await db.query<Row>(
    `SELECT ${SUMMARY} FROM ${FROM} WHERE ${where.join(" AND ")}
      ORDER BY i.issue_date DESC, i.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => mapSummary(r, today));
}

export async function findInvoice(db: Db, workspaceId: string, id: string, today: string, lock = false): Promise<InvoiceDetail | null> {
  const rows = await db.query<Row>(
    `SELECT ${SUMMARY}, i.subtotal_kobo, i.discount_kobo, i.delivery_fee_kobo, i.notes, i.sent_at, i.voided_at, i.void_reason,
            u.name AS created_by_name, c.phone, c.whatsapp, c.email
       FROM ${FROM} LEFT JOIN users u ON u.id = i.created_by
      WHERE i.workspace_id = $1 AND i.id = $2
      ${lock ? "FOR UPDATE OF i" : ""}`,
    [workspaceId, id],
  );
  const r = rows[0];
  if (!r) return null;
  const items = await db.query<Row>(
    `SELECT id, position, product_id, description, quantity, unit_price_kobo, unit_cost_kobo, line_total_kobo
       FROM invoice_items WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY position`,
    [workspaceId, id],
  );
  return {
    ...mapSummary(r, today),
    subtotalKobo: int(r.subtotal_kobo),
    discountKobo: int(r.discount_kobo),
    deliveryFeeKobo: int(r.delivery_fee_kobo),
    notes: (r.notes as string | null) ?? null,
    sentAt: toDateOrNull(r.sent_at),
    voidedAt: toDateOrNull(r.voided_at),
    voidReason: (r.void_reason as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    customer: {
      name: String(r.customer_name),
      phone: (r.phone as string | null) ?? null,
      whatsapp: (r.whatsapp as string | null) ?? null,
      email: (r.email as string | null) ?? null,
    },
    items: items.map((it) => ({
      id: String(it.id),
      position: int(it.position),
      productId: (it.product_id as string | null) ?? null,
      description: String(it.description),
      quantity: int(it.quantity),
      unitPriceKobo: int(it.unit_price_kobo),
      unitCostKobo: int(it.unit_cost_kobo),
      lineTotalKobo: int(it.line_total_kobo),
    })),
  };
}

export async function findInvoiceByNumber(db: Db, workspaceId: string, number: number): Promise<string | null> {
  const rows = await db.query<{ id: string }>("SELECT id FROM invoices WHERE workspace_id = $1 AND number = $2", [workspaceId, number]);
  return rows[0]?.id ?? null;
}

export async function findByRequestId(db: Db, workspaceId: string, clientRequestId: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>("SELECT id FROM invoices WHERE workspace_id = $1 AND client_request_id = $2", [
    workspaceId,
    clientRequestId,
  ]);
  return rows[0]?.id ?? null;
}

/**
 * Takes the next gapless number. The UPDATE locks this workspace's row until
 * the surrounding transaction ends, so concurrent creators queue up here and
 * each gets the next number; a rollback undoes the bump, so no gaps.
 * (A Postgres SEQUENCE is NOT gapless: nextval() is never rolled back, so a
 * failed or retried insert burns a number for good: INV-0007 would be missing.)
 */
export async function takeInvoiceNumber(db: Db, workspaceId: string): Promise<number> {
  const rows = await db.query<{ number: unknown }>(
    "UPDATE workspaces SET next_invoice_number = next_invoice_number + 1 WHERE id = $1 RETURNING next_invoice_number - 1 AS number",
    [workspaceId],
  );
  if (!rows[0]) throw new Error("workspace not found while numbering");
  return int(rows[0].number);
}

export async function insertInvoice(
  db: Db,
  v: {
    workspaceId: string;
    number: number;
    customerId: string;
    issueDate: string;
    dueDate: string;
    computed: ComputedInvoice;
    notes: string | null;
    clientRequestId: string;
    userId: string;
  },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO invoices (workspace_id, number, customer_id, issue_date, due_date, subtotal_kobo, discount_kobo,
                           delivery_fee_kobo, total_kobo, notes, client_request_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      v.workspaceId,
      v.number,
      v.customerId,
      v.issueDate,
      v.dueDate,
      v.computed.subtotalKobo,
      v.computed.discountKobo,
      v.computed.deliveryFeeKobo,
      v.computed.totalKobo,
      v.notes,
      v.clientRequestId,
      v.userId,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("invoice insert returned nothing");
  await insertItems(db, v.workspaceId, id, v.computed);
  return id;
}

export async function insertItems(db: Db, workspaceId: string, invoiceId: string, computed: ComputedInvoice): Promise<void> {
  for (const line of computed.lines) {
    await db.query(
      `INSERT INTO invoice_items (workspace_id, invoice_id, position, product_id, description, quantity,
                                  unit_price_kobo, unit_cost_kobo, line_total_kobo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        workspaceId,
        invoiceId,
        line.position,
        line.productId,
        line.description,
        line.quantity,
        line.unitPriceKobo,
        line.unitCostKobo,
        line.lineTotalKobo,
      ],
    );
  }
}

export async function replaceDraft(
  db: Db,
  v: { workspaceId: string; id: string; customerId: string; issueDate: string; dueDate: string; computed: ComputedInvoice; notes: string | null },
): Promise<void> {
  await db.query("DELETE FROM invoice_items WHERE workspace_id = $1 AND invoice_id = $2", [v.workspaceId, v.id]);
  await insertItems(db, v.workspaceId, v.id, v.computed);
  await db.query(
    `UPDATE invoices SET customer_id = $3, issue_date = $4, due_date = $5, subtotal_kobo = $6, discount_kobo = $7,
            delivery_fee_kobo = $8, total_kobo = $9, notes = $10
      WHERE workspace_id = $1 AND id = $2 AND status = 'draft'`,
    [
      v.workspaceId,
      v.id,
      v.customerId,
      v.issueDate,
      v.dueDate,
      v.computed.subtotalKobo,
      v.computed.discountKobo,
      v.computed.deliveryFeeKobo,
      v.computed.totalKobo,
      v.notes,
    ],
  );
}

export async function customerInvoiceCount(db: Db, workspaceId: string, customerId: string): Promise<number> {
  const rows = await db.query<{ n: unknown }>("SELECT count(*) AS n FROM invoices WHERE workspace_id = $1 AND customer_id = $2", [
    workspaceId,
    customerId,
  ]);
  return intOrNull(rows[0]?.n) ?? 0;
}

export function parseIssued(value: unknown): Date {
  return toDate(value);
}
