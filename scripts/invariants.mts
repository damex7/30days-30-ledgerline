// Business invariants, checked straight against the tables. The seed runs
// these at the end, and the check script runs them after its own tests.
// Every query returns the rows that BREAK a rule, so "0 rows" means it holds.

import { db } from "@/lib/db";

const CHECKS: { name: string; sql: string }[] = [
  {
    name: "stock_quantity equals the sum of the stock ledger",
    sql: `SELECT p.id FROM products p
            LEFT JOIN (SELECT product_id, SUM(quantity_delta) AS s FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
           WHERE p.workspace_id = ANY($1::uuid[]) AND p.stock_quantity <> COALESCE(m.s, 0)`,
  },
  {
    name: "no product has negative stock",
    sql: `SELECT id FROM products WHERE workspace_id = ANY($1::uuid[]) AND stock_quantity < 0`,
  },
  {
    name: "invoice subtotal equals the sum of its lines",
    sql: `SELECT i.id FROM invoices i
            LEFT JOIN (SELECT invoice_id, SUM(line_total_kobo) AS s FROM invoice_items GROUP BY invoice_id) t ON t.invoice_id = i.id
           WHERE i.workspace_id = ANY($1::uuid[]) AND i.subtotal_kobo <> COALESCE(t.s, 0)`,
  },
  {
    name: "invoice total equals subtotal − discount + delivery",
    sql: `SELECT id FROM invoices WHERE workspace_id = ANY($1::uuid[]) AND total_kobo <> subtotal_kobo - discount_kobo + delivery_fee_kobo`,
  },
  {
    name: "amount paid equals the sum of payments and never exceeds the total",
    sql: `SELECT i.id FROM invoices i
            LEFT JOIN (SELECT invoice_id, SUM(amount_kobo) AS s FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
           WHERE i.workspace_id = ANY($1::uuid[]) AND (i.amount_paid_kobo <> COALESCE(p.s, 0) OR i.amount_paid_kobo > i.total_kobo)`,
  },
  {
    name: "status matches the money (paid = fully paid, partly paid in between)",
    sql: `SELECT id FROM invoices WHERE workspace_id = ANY($1::uuid[]) AND NOT (
            (status IN ('draft','sent') AND amount_paid_kobo = 0) OR
            (status = 'partly_paid' AND amount_paid_kobo > 0 AND amount_paid_kobo < total_kobo) OR
            (status = 'paid' AND amount_paid_kobo = total_kobo) OR (status = 'void' AND amount_paid_kobo = 0))`,
  },
  {
    name: "sent invoices took exactly their quantities out of stock; drafts and voids net to zero",
    sql: `WITH sold AS (
            SELECT i.id, i.status, i.sent_at,
                   COALESCE((SELECT SUM(quantity) FROM invoice_items it WHERE it.invoice_id = i.id AND it.product_id IS NOT NULL), 0) AS qty,
                   COALESCE((SELECT -SUM(quantity_delta) FROM stock_movements m WHERE m.invoice_id = i.id), 0) AS moved
              FROM invoices i WHERE i.workspace_id = ANY($1::uuid[]))
          SELECT id FROM sold
           WHERE (status IN ('sent','partly_paid','paid') AND moved <> qty)
              OR (status IN ('draft','void') AND moved <> 0)`,
  },
  {
    name: "invoice numbers are gapless per workspace (1..n) and the counter is next",
    sql: `SELECT w.id FROM workspaces w
            LEFT JOIN (SELECT workspace_id, COUNT(*) AS n, MAX(number) AS mx FROM invoices GROUP BY workspace_id) s ON s.workspace_id = w.id
           WHERE w.id = ANY($1::uuid[]) AND (COALESCE(s.n, 0) <> COALESCE(s.mx, 0) OR w.next_invoice_number <> COALESCE(s.mx, 0) + 1)`,
  },
  {
    name: "every child row belongs to the same workspace as its parent",
    sql: `SELECT i.id FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.workspace_id = ANY($1::uuid[]) AND c.workspace_id <> i.workspace_id
          UNION ALL
          SELECT it.id FROM invoice_items it JOIN products p ON p.id = it.product_id WHERE it.workspace_id = ANY($1::uuid[]) AND p.workspace_id <> it.workspace_id
          UNION ALL
          SELECT pm.id FROM payments pm JOIN invoices i ON i.id = pm.invoice_id WHERE pm.workspace_id = ANY($1::uuid[]) AND i.workspace_id <> pm.workspace_id`,
  },
];

export async function verifyInvariants(workspaceIds: string[], quiet = false): Promise<boolean> {
  let ok = true;
  if (!quiet) console.log("\nConsistency check:");
  for (const check of CHECKS) {
    const bad = await db.query(check.sql, [workspaceIds]);
    if (bad.length) ok = false;
    if (!quiet || bad.length) console.log(`  ${bad.length ? "FAIL" : "PASS"}  ${check.name}${bad.length ? ` (${bad.length} rows)` : ""}`);
  }
  return ok;
}
