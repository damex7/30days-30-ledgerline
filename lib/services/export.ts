import "server-only";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import type { Ctx } from "@/lib/context";

// "Export all data": one CSV per table, owner only. The business owns its
// data and can take it elsewhere. Every query is scoped to the workspace.

export const DATASETS = {
  customers: `SELECT name, phone, whatsapp, email, notes, array_to_string(tags, '; ') AS tags, archived_at, created_at
                FROM customers WHERE workspace_id = $1 ORDER BY lower(name)`,
  products: `SELECT sku, name, unit, price_kobo, cost_kobo, stock_quantity, low_stock_level, archived_at, created_at
               FROM products WHERE workspace_id = $1 ORDER BY lower(name)`,
  invoices: `SELECT w.invoice_prefix || '-' || lpad(i.number::text, 4, '0') AS invoice, c.name AS customer, i.status,
                    i.issue_date, i.due_date, i.subtotal_kobo, i.discount_kobo, i.delivery_fee_kobo, i.total_kobo, i.amount_paid_kobo,
                    i.notes, i.sent_at, i.voided_at, i.void_reason
               FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN workspaces w ON w.id = i.workspace_id
              WHERE i.workspace_id = $1 ORDER BY i.number`,
  invoice_items: `SELECT w.invoice_prefix || '-' || lpad(i.number::text, 4, '0') AS invoice, it.position, it.description, p.sku,
                         it.quantity, it.unit_price_kobo, it.unit_cost_kobo, it.line_total_kobo
                    FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id JOIN workspaces w ON w.id = it.workspace_id
                    LEFT JOIN products p ON p.id = it.product_id
                   WHERE it.workspace_id = $1 ORDER BY i.number, it.position`,
  payments: `SELECT w.invoice_prefix || '-' || lpad(i.number::text, 4, '0') AS invoice, p.amount_kobo, p.method, p.paid_at, p.note,
                    p.reverses_payment_id IS NOT NULL AS is_reversal, p.created_at
               FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN workspaces w ON w.id = p.workspace_id
              WHERE p.workspace_id = $1 ORDER BY p.paid_at, p.created_at`,
  expenses: `SELECT category, amount_kobo, spent_on, note, receipt_ref, created_at FROM expenses WHERE workspace_id = $1 ORDER BY spent_on`,
  stock_movements: `SELECT p.sku, p.name AS product, m.quantity_delta, m.reason, m.note, m.created_at
                      FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE m.workspace_id = $1 ORDER BY m.created_at`,
} as const;

export type Dataset = keyof typeof DATASETS;

export function isDataset(value: string): value is Dataset {
  return Object.hasOwn(DATASETS, value);
}

export async function exportDataset(ctx: Ctx, dataset: Dataset): Promise<Record<string, unknown>[]> {
  assertCan(ctx, "workspace.export");
  return db.query(DATASETS[dataset], [ctx.workspaceId]);
}
