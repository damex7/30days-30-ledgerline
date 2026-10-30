import "server-only";
import { db, int, isUniqueViolation, toDate, transaction, type Db, type Param } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { encodeCursor, PAGE_SIZE } from "@/lib/cursor";
import { formatNaira } from "@/lib/money";
import { invoiceLabel } from "@/lib/invoice-math";
import type { Ctx } from "@/lib/context";
import type { PaymentInput } from "@/lib/validation/business";

// Payments are append-only. Recording one locks the invoice row (FOR UPDATE)
// so two cashiers recording the last ₦5,000 at the same moment are handled
// one after the other: the second sees the new balance and is refused.
// The CHECK amount_paid_kobo <= total_kobo is the database's backstop.

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceLabel: string;
  customerName: string;
  amountKobo: number;
  method: "cash" | "transfer" | "pos";
  paidAt: Date;
  note: string | null;
  reversesPaymentId: string | null;
  reversedBy: string | null;
  createdBy: string | null;
  createdByName: string | null;
}

type Row = Record<string, unknown>;

const SELECT = `SELECT p.id, p.invoice_id, i.number, w.invoice_prefix, c.name AS customer_name, p.amount_kobo, p.method, p.paid_at,
       p.note, p.reverses_payment_id, r.id AS reversed_by, p.created_by, u.name AS created_by_name
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id AND i.workspace_id = p.workspace_id
  JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
  JOIN workspaces w ON w.id = p.workspace_id
  LEFT JOIN payments r ON r.reverses_payment_id = p.id
  LEFT JOIN users u ON u.id = p.created_by`;

function map(r: Row): Payment {
  return {
    id: String(r.id),
    invoiceId: String(r.invoice_id),
    invoiceLabel: invoiceLabel(String(r.invoice_prefix), int(r.number)),
    customerName: String(r.customer_name),
    amountKobo: int(r.amount_kobo),
    method: r.method as Payment["method"],
    paidAt: toDate(r.paid_at),
    note: (r.note as string | null) ?? null,
    reversesPaymentId: (r.reverses_payment_id as string | null) ?? null,
    reversedBy: (r.reversed_by as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
  };
}

export async function paymentsForInvoice(ctx: Ctx, invoiceId: string, client: Db = db): Promise<Payment[]> {
  assertCan(ctx, "invoice.view");
  const rows = await client.query<Row>(`${SELECT} WHERE p.workspace_id = $1 AND p.invoice_id = $2 ORDER BY p.paid_at, p.created_at`, [
    ctx.workspaceId,
    invoiceId,
  ]);
  return rows.map(map);
}

export async function paymentsForCustomer(ctx: Ctx, customerId: string): Promise<Payment[]> {
  assertCan(ctx, "customer.view");
  const rows = await db.query<Row>(`${SELECT} WHERE p.workspace_id = $1 AND i.customer_id = $2 ORDER BY p.paid_at DESC LIMIT 100`, [
    ctx.workspaceId,
    customerId,
  ]);
  return rows.map(map);
}

export async function listPayments(ctx: Ctx, after: { at: string; id: string } | null) {
  assertCan(ctx, "invoice.view");
  const params: Param[] = [ctx.workspaceId];
  let seek = "";
  if (after) {
    params.push(after.at, after.id);
    seek = "AND (p.paid_at, p.id) < ($2::timestamptz, $3::uuid)";
  }
  params.push(PAGE_SIZE + 1);
  const rows = await db.query<Row>(`${SELECT} WHERE p.workspace_id = $1 ${seek} ORDER BY p.paid_at DESC, p.id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, PAGE_SIZE).map(map);
  const last = page.at(-1);
  return { payments: page, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.paidAt.toISOString(), last.id]) : null };
}

async function existingByRequest(client: Db, ctx: Ctx, clientRequestId: string): Promise<string | null> {
  const rows = await client.query<{ id: string }>("SELECT id FROM payments WHERE workspace_id = $1 AND client_request_id = $2", [
    ctx.workspaceId,
    clientRequestId,
  ]);
  return rows[0]?.id ?? null;
}

interface LockedInvoice {
  id: string;
  number: number;
  status: string;
  totalKobo: number;
  amountPaidKobo: number;
}

async function lockInvoice(tx: Db, ctx: Ctx, invoiceId: string): Promise<LockedInvoice> {
  const rows = await tx.query<Row>(
    `SELECT id, number, status, total_kobo, amount_paid_kobo FROM invoices WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [ctx.workspaceId, invoiceId],
  );
  const r = rows[0];
  if (!r) throw new NotFoundError("Invoice");
  return { id: String(r.id), number: int(r.number), status: String(r.status), totalKobo: int(r.total_kobo), amountPaidKobo: int(r.amount_paid_kobo) };
}

/** Status follows the money: nothing paid = sent, some = partly paid, all = paid. */
function statusFor(paid: number, total: number): "sent" | "partly_paid" | "paid" {
  if (paid === 0) return "sent";
  return paid >= total ? "paid" : "partly_paid";
}

export async function recordPayment(ctx: Ctx, input: PaymentInput): Promise<{ id: string; created: boolean }> {
  assertCan(ctx, "payment.record");
  try {
    return await transaction(async (tx) => {
      const existing = await existingByRequest(tx, ctx, input.clientRequestId);
      if (existing) return { id: existing, created: false };

      const invoice = await lockInvoice(tx, ctx, input.invoiceId);
      if (invoice.status === "draft") throw new ConflictError("Send this invoice before recording a payment.");
      if (invoice.status === "void") throw new ConflictError("This invoice is void.");
      if (invoice.status === "paid") throw new ConflictError("This invoice is already fully paid.");
      const balance = invoice.totalKobo - invoice.amountPaidKobo;
      if (input.amount > balance) {
        throw new ValidationError(`That's more than the ${formatNaira(balance)} still owed.`, {
          amount: [`At most ${formatNaira(balance)}.`],
        });
      }

      // Midday Lagos time on the chosen date: stable whatever the server's zone.
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO payments (workspace_id, invoice_id, amount_kobo, method, paid_at, note, client_request_id, created_by)
         VALUES ($1, $2, $3, $4, ($5::date + time '12:00') AT TIME ZONE 'Africa/Lagos', $6, $7, $8) RETURNING id`,
        [ctx.workspaceId, invoice.id, input.amount, input.method, input.paidOn, input.note, input.clientRequestId, ctx.userId],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("payment insert returned nothing");
      const paid = invoice.amountPaidKobo + input.amount;
      await tx.query("UPDATE invoices SET amount_paid_kobo = $3, status = $4 WHERE workspace_id = $1 AND id = $2", [
        ctx.workspaceId,
        invoice.id,
        paid,
        statusFor(paid, invoice.totalKobo),
      ]);
      await audit(tx, ctx, "payment.record", "payment", id, { invoice: invoice.number, amountKobo: input.amount, method: input.method });
      return { id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, "payments_request_per_workspace")) {
      const id = await existingByRequest(db, ctx, input.clientRequestId);
      if (id) return { id, created: false };
    }
    throw error;
  }
}

/** A reversal is a new negative row pointing at the original; nothing is deleted. */
export async function reversePayment(
  ctx: Ctx,
  input: { paymentId: string; reason: string; clientRequestId: string },
): Promise<{ id: string; created: boolean }> {
  assertCan(ctx, "payment.reverse");
  try {
    return await transaction(async (tx) => {
      const existing = await existingByRequest(tx, ctx, input.clientRequestId);
      if (existing) return { id: existing, created: false };

      const found = await tx.query<Row>("SELECT id, invoice_id, amount_kobo, method FROM payments WHERE workspace_id = $1 AND id = $2", [
        ctx.workspaceId,
        input.paymentId,
      ]);
      const original = found[0];
      if (!original) throw new NotFoundError("Payment");
      const amount = int(original.amount_kobo);
      if (amount <= 0) throw new ConflictError("A reversal can't itself be reversed.");

      const invoice = await lockInvoice(tx, ctx, String(original.invoice_id));
      const already = await tx.query("SELECT 1 FROM payments WHERE reverses_payment_id = $1", [input.paymentId]);
      if (already.length > 0) throw new ConflictError("This payment has already been reversed.");

      const rows = await tx.query<{ id: string }>(
        `INSERT INTO payments (workspace_id, invoice_id, amount_kobo, method, note, reverses_payment_id, client_request_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [ctx.workspaceId, invoice.id, -amount, original.method as string, `Reversal: ${input.reason}`.slice(0, 300), input.paymentId, input.clientRequestId, ctx.userId],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("reversal insert returned nothing");
      const paid = invoice.amountPaidKobo - amount;
      await tx.query("UPDATE invoices SET amount_paid_kobo = $3, status = $4 WHERE workspace_id = $1 AND id = $2", [
        ctx.workspaceId,
        invoice.id,
        paid,
        statusFor(paid, invoice.totalKobo),
      ]);
      await audit(tx, ctx, "payment.reverse", "payment", input.paymentId, { invoice: invoice.number, amountKobo: amount });
      return { id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const id = await existingByRequest(db, ctx, input.clientRequestId);
      if (id) return { id, created: false };
      throw new ConflictError("This payment has already been reversed.");
    }
    throw error;
  }
}
