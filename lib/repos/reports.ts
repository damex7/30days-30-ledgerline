import "server-only";
import { int, type Db } from "@/lib/db";
import { invoiceLabel } from "@/lib/invoice-math";
import { LOW_STOCK_SQL } from "@/lib/repos/products";

// Every number on the dashboard, in reports and in the AI's tools is computed
// HERE, in SQL, from the ledgers. Nothing is summed in JavaScript from a
// page of rows, and the AI never does arithmetic: it only explains these.
//
// Definitions (also in the README):
//   sales           = totals of invoices ISSUED in the range that were sent
//                     (sent, partly paid, paid). Drafts and voids don't count.
//   payments in     = net payments RECEIVED in the range (reversals subtract).
//   money owed      = what's left on open invoices right now.
//   cost of goods   = quantity x unit cost copied onto each sold line.
//   est. profit     = sales − cost of goods − expenses in the range.

const SOLD = "('sent', 'partly_paid', 'paid')";

export interface Summary {
  from: string;
  to: string;
  invoiceCount: number;
  salesKobo: number;
  paymentsKobo: number;
  expensesKobo: number;
  costOfGoodsKobo: number;
  estimatedProfitKobo: number;
}

export async function summary(db: Db, workspaceId: string, from: string, to: string): Promise<Summary> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT
       (SELECT count(*) FROM invoices WHERE workspace_id = $1 AND status IN ${SOLD} AND issue_date BETWEEN $2 AND $3) AS invoice_count,
       (SELECT COALESCE(SUM(total_kobo), 0) FROM invoices WHERE workspace_id = $1 AND status IN ${SOLD} AND issue_date BETWEEN $2 AND $3) AS sales,
       (SELECT COALESCE(SUM(amount_kobo), 0) FROM payments
         WHERE workspace_id = $1 AND (paid_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $2 AND $3) AS payments,
       (SELECT COALESCE(SUM(amount_kobo), 0) FROM expenses WHERE workspace_id = $1 AND spent_on BETWEEN $2 AND $3) AS expenses,
       (SELECT COALESCE(SUM(it.quantity * it.unit_cost_kobo), 0) FROM invoice_items it
          JOIN invoices i ON i.id = it.invoice_id AND i.workspace_id = it.workspace_id
         WHERE i.workspace_id = $1 AND i.status IN ${SOLD} AND i.issue_date BETWEEN $2 AND $3) AS cogs`,
    [workspaceId, from, to],
  );
  const r = rows[0]!;
  const sales = int(r.sales);
  const cogs = int(r.cogs);
  const expenses = int(r.expenses);
  return {
    from,
    to,
    invoiceCount: int(r.invoice_count),
    salesKobo: sales,
    paymentsKobo: int(r.payments),
    expensesKobo: expenses,
    costOfGoodsKobo: cogs,
    estimatedProfitKobo: sales - cogs - expenses,
  };
}

export interface Owed {
  openCount: number;
  owedKobo: number;
  overdueCount: number;
  overdueKobo: number;
}

export async function owed(db: Db, workspaceId: string, today: string): Promise<Owed> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT count(*) AS open_count, COALESCE(SUM(total_kobo - amount_paid_kobo), 0) AS owed,
            count(*) FILTER (WHERE due_date < $2) AS overdue_count,
            COALESCE(SUM(total_kobo - amount_paid_kobo) FILTER (WHERE due_date < $2), 0) AS overdue
       FROM invoices WHERE workspace_id = $1 AND status IN ('sent', 'partly_paid')`,
    [workspaceId, today],
  );
  const r = rows[0]!;
  return { openCount: int(r.open_count), owedKobo: int(r.owed), overdueCount: int(r.overdue_count), overdueKobo: int(r.overdue) };
}

export interface OverdueRow {
  id: string;
  label: string;
  customerId: string;
  customerName: string;
  dueDate: string;
  daysOverdue: number;
  balanceKobo: number;
}

export async function overdueInvoices(db: Db, workspaceId: string, today: string, limit: number, minBalanceKobo = 0): Promise<OverdueRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT i.id, i.number, w.invoice_prefix, i.customer_id, c.name AS customer_name, i.due_date::text AS due_date,
            ($2::date - i.due_date) AS days_overdue, i.total_kobo - i.amount_paid_kobo AS balance
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
       JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.workspace_id = $1 AND i.status IN ('sent', 'partly_paid') AND i.due_date < $2
        AND i.total_kobo - i.amount_paid_kobo >= $4
      ORDER BY i.due_date, i.id LIMIT $3`,
    [workspaceId, today, limit, minBalanceKobo],
  );
  return rows.map((r) => ({
    id: String(r.id),
    label: invoiceLabel(String(r.invoice_prefix), int(r.number)),
    customerId: String(r.customer_id),
    customerName: String(r.customer_name),
    dueDate: String(r.due_date),
    daysOverdue: int(r.days_overdue),
    balanceKobo: int(r.balance),
  }));
}

export interface OwingCustomer {
  id: string;
  name: string;
  owedKobo: number;
  openInvoices: number;
  oldestDueDate: string;
}

export async function customersOwing(db: Db, workspaceId: string, minKobo: number, limit: number): Promise<OwingCustomer[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.name, SUM(i.total_kobo - i.amount_paid_kobo) AS owed, count(*) AS open_invoices, MIN(i.due_date)::text AS oldest
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
      WHERE i.workspace_id = $1 AND i.status IN ('sent', 'partly_paid')
      GROUP BY c.id, c.name
     HAVING SUM(i.total_kobo - i.amount_paid_kobo) >= $2
      ORDER BY owed DESC, c.name LIMIT $3`,
    [workspaceId, minKobo, limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    owedKobo: int(r.owed),
    openInvoices: int(r.open_invoices),
    oldestDueDate: String(r.oldest),
  }));
}

export interface TopProduct {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  salesKobo: number;
  profitKobo: number;
}

export async function topProducts(db: Db, workspaceId: string, from: string, to: string, limit: number): Promise<TopProduct[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT p.id, p.name, p.unit, SUM(it.quantity) AS quantity, SUM(it.line_total_kobo) AS sales,
            SUM(it.line_total_kobo - it.quantity * it.unit_cost_kobo) AS profit
       FROM invoice_items it
       JOIN invoices i ON i.id = it.invoice_id AND i.workspace_id = it.workspace_id
       JOIN products p ON p.id = it.product_id AND p.workspace_id = it.workspace_id
      WHERE i.workspace_id = $1 AND i.status IN ${SOLD} AND i.issue_date BETWEEN $2 AND $3
      GROUP BY p.id, p.name, p.unit
      ORDER BY sales DESC, p.name LIMIT $4`,
    [workspaceId, from, to, limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    unit: String(r.unit),
    quantity: int(r.quantity),
    salesKobo: int(r.sales),
    profitKobo: int(r.profit),
  }));
}

export interface TopCustomer {
  id: string;
  name: string;
  invoiceCount: number;
  salesKobo: number;
}

export async function topCustomers(db: Db, workspaceId: string, from: string, to: string, limit: number): Promise<TopCustomer[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT c.id, c.name, count(*) AS n, SUM(i.total_kobo) AS sales
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
      WHERE i.workspace_id = $1 AND i.status IN ${SOLD} AND i.issue_date BETWEEN $2 AND $3
      GROUP BY c.id, c.name ORDER BY sales DESC, c.name LIMIT $4`,
    [workspaceId, from, to, limit],
  );
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), invoiceCount: int(r.n), salesKobo: int(r.sales) }));
}

export interface LowStockRow {
  id: string;
  name: string;
  unit: string;
  stockQuantity: number;
  lowLevel: number;
}

export async function lowStock(db: Db, workspaceId: string, limit: number): Promise<LowStockRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT p.id, p.name, p.unit, p.stock_quantity, COALESCE(p.low_stock_level, w.low_stock_default) AS low_level
       FROM products p JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND ${LOW_STOCK_SQL}
      ORDER BY p.stock_quantity, lower(p.name) LIMIT $2`,
    [workspaceId, limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    unit: String(r.unit),
    stockQuantity: int(r.stock_quantity),
    lowLevel: int(r.low_level),
  }));
}

export interface DayPoint {
  date: string;
  salesKobo: number;
  paymentsKobo: number;
}

/** One row per day, including days with nothing (generate_series). */
export async function daily(db: Db, workspaceId: string, from: string, to: string): Promise<DayPoint[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT d::date::text AS day,
            COALESCE((SELECT SUM(total_kobo) FROM invoices WHERE workspace_id = $1 AND status IN ${SOLD} AND issue_date = d::date), 0) AS sales,
            COALESCE((SELECT SUM(amount_kobo) FROM payments
                       WHERE workspace_id = $1 AND (paid_at AT TIME ZONE 'Africa/Lagos')::date = d::date), 0) AS payments
       FROM generate_series($2::date, $3::date, interval '1 day') AS d ORDER BY d`,
    [workspaceId, from, to],
  );
  return rows.map((r) => ({ date: String(r.day), salesKobo: int(r.sales), paymentsKobo: int(r.payments) }));
}

export interface CategoryTotal {
  category: string;
  count: number;
  amountKobo: number;
}

export async function expenseBreakdown(db: Db, workspaceId: string, from: string, to: string): Promise<CategoryTotal[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT category, count(*) AS n, SUM(amount_kobo) AS amount FROM expenses
      WHERE workspace_id = $1 AND spent_on BETWEEN $2 AND $3
      GROUP BY category ORDER BY amount DESC`,
    [workspaceId, from, to],
  );
  return rows.map((r) => ({ category: String(r.category), count: int(r.n), amountKobo: int(r.amount) }));
}

/** Invoices in a range for CSV export. */
export async function invoiceRows(db: Db, workspaceId: string, from: string, to: string): Promise<Record<string, unknown>[]> {
  return db.query(
    `SELECT w.invoice_prefix || '-' || lpad(i.number::text, 4, '0') AS invoice, i.issue_date::text AS issue_date,
            i.due_date::text AS due_date, c.name AS customer, i.status, i.subtotal_kobo, i.discount_kobo,
            i.delivery_fee_kobo, i.total_kobo, i.amount_paid_kobo, i.total_kobo - i.amount_paid_kobo AS balance_kobo
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
       JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.workspace_id = $1 AND i.issue_date BETWEEN $2 AND $3
      ORDER BY i.issue_date, i.number`,
    [workspaceId, from, to],
  );
}
