import "server-only";
import { db, isCheckViolation, isUniqueViolation, transaction, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, assertCanEdit } from "@/lib/permissions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { encodeCursor, PAGE_SIZE } from "@/lib/cursor";
import { todayInLagos } from "@/lib/dates";
import { computeInvoice, type PricedProduct } from "@/lib/invoice-math";
import type { Ctx } from "@/lib/context";
import type { InvoiceInput } from "@/lib/validation/business";
import * as repo from "@/lib/repos/invoices";
import { findCustomer } from "@/lib/repos/customers";
import { findProducts, insertMovement } from "@/lib/repos/products";

export type { InvoiceSummary, InvoiceDetail, InvoiceStatus } from "@/lib/repos/invoices";

// Invoices: create (gapless number, server-computed totals, idempotent),
// edit while draft, send (reserves stock), void (restores stock).

export async function listInvoices(ctx: Ctx, query: Omit<repo.InvoiceQuery, "limit">) {
  assertCan(ctx, "invoice.view");
  const rows = await repo.listInvoices(db, ctx.workspaceId, todayInLagos(), { ...query, limit: PAGE_SIZE + 1 });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return { invoices: page, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.issueDate, last.id]) : null };
}

/** Another workspace's invoice id gives the same NotFoundError as a made-up one. */
export async function getInvoice(ctx: Ctx, id: string, client: Db = db) {
  assertCan(ctx, "invoice.view");
  const invoice = await repo.findInvoice(client, ctx.workspaceId, id, todayInLagos());
  if (!invoice) throw new NotFoundError("Invoice");
  return invoice;
}

async function priceBook(client: Db, ctx: Ctx, input: Pick<InvoiceInput, "items">): Promise<Map<string, PricedProduct>> {
  const ids = [...new Set(input.items.map((l) => l.productId).filter((id): id is string => Boolean(id)))];
  const products = await findProducts(client, ctx.workspaceId, ids);
  return new Map(
    products.map((p) => [
      p.id,
      { id: p.id, name: p.name, unit: p.unit, priceKobo: p.priceKobo, costKobo: p.costKobo, archived: p.archivedAt !== null },
    ]),
  );
}

async function assertCustomer(client: Db, ctx: Ctx, customerId: string) {
  const customer = await findCustomer(client, ctx.workspaceId, customerId);
  if (!customer || customer.archivedAt) {
    throw new ValidationError("Choose a customer from this business.", { customerId: ["Choose a customer."] });
  }
}

/**
 * Creates an invoice inside an open transaction. Used by the form AND by
 * AI-proposal approval, so both go through exactly the same checks.
 * Idempotent on clientRequestId: a repeat returns the first invoice.
 */
export async function createInvoiceTx(tx: Db, ctx: Ctx, input: InvoiceInput): Promise<{ id: string; created: boolean }> {
  assertCan(ctx, "invoice.create");
  const existing = await repo.findByRequestId(tx, ctx.workspaceId, input.clientRequestId);
  if (existing) return { id: existing, created: false };

  await assertCustomer(tx, ctx, input.customerId);
  // Totals come from here and only here: nothing the client sent is a total.
  const computed = computeInvoice(input.items, await priceBook(tx, ctx, input), input.discount, input.deliveryFee);

  const number = await repo.takeInvoiceNumber(tx, ctx.workspaceId);
  const id = await repo.insertInvoice(tx, {
    workspaceId: ctx.workspaceId,
    number,
    customerId: input.customerId,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    computed,
    notes: input.notes,
    clientRequestId: input.clientRequestId,
    userId: ctx.userId,
  });
  await audit(tx, ctx, "invoice.create", "invoice", id, { number, totalKobo: computed.totalKobo, lines: computed.lines.length });
  if (input.send) await sendInvoiceTx(tx, ctx, id);
  return { id, created: true };
}

export async function createInvoice(ctx: Ctx, input: InvoiceInput): Promise<{ id: string; created: boolean }> {
  try {
    return await transaction((tx) => createInvoiceTx(tx, ctx, input));
  } catch (error) {
    // Two identical requests raced past the first check: the loser's whole
    // transaction (number bump included) rolled back; return the winner's.
    if (isUniqueViolation(error, "invoices_request_per_workspace")) {
      const id = await repo.findByRequestId(db, ctx.workspaceId, input.clientRequestId);
      if (id) return { id, created: false };
    }
    throw error;
  }
}

export async function updateDraft(ctx: Ctx, id: string, input: InvoiceInput): Promise<void> {
  await transaction(async (tx) => {
    const invoice = await repo.findInvoice(tx, ctx.workspaceId, id, todayInLagos(), true);
    if (!invoice) throw new NotFoundError("Invoice");
    assertCanEdit(ctx, invoice, "invoice.edit_own", "invoice.edit_any");
    if (invoice.status !== "draft") throw new ConflictError("A sent invoice can't be edited. Void it and create a new one.");
    await assertCustomer(tx, ctx, input.customerId);
    const computed = computeInvoice(input.items, await priceBook(tx, ctx, input), input.discount, input.deliveryFee);
    await repo.replaceDraft(tx, {
      workspaceId: ctx.workspaceId,
      id,
      customerId: input.customerId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      computed,
      notes: input.notes,
    });
    await audit(tx, ctx, "invoice.update", "invoice", id, { totalKobo: computed.totalKobo });
    if (input.send) await sendInvoiceTx(tx, ctx, id);
  });
}

/**
 * Sending reserves stock: one "sale" movement per product line. Movements
 * are inserted in product-id order so two invoices touching the same
 * products always lock them in the same order (no deadlocks). If any product
 * would go below zero, the CHECK fails and the whole send rolls back.
 */
export async function sendInvoiceTx(tx: Db, ctx: Ctx, id: string): Promise<void> {
  const invoice = await repo.findInvoice(tx, ctx.workspaceId, id, todayInLagos(), true);
  if (!invoice) throw new NotFoundError("Invoice");
  assertCanEdit(ctx, invoice, "invoice.edit_own", "invoice.edit_any");
  if (invoice.status !== "draft") throw new ConflictError("This invoice has already been sent.");

  const lines = invoice.items.filter((l) => l.productId).sort((a, b) => (a.productId! < b.productId! ? -1 : 1));
  for (const line of lines) {
    try {
      await insertMovement(tx, {
        workspaceId: ctx.workspaceId,
        productId: line.productId!,
        quantityDelta: -line.quantity,
        reason: "sale",
        invoiceId: id,
        note: null,
        userId: ctx.userId,
      });
    } catch (error) {
      if (isCheckViolation(error, "products_stock_not_negative")) {
        throw new ValidationError(`Not enough stock for “${line.description}”. Restock it or reduce the quantity.`, {
          items: [`Not enough stock for ${line.description}.`],
        });
      }
      throw error;
    }
  }
  await tx.query("UPDATE invoices SET status = 'sent', sent_at = now() WHERE workspace_id = $1 AND id = $2", [ctx.workspaceId, id]);
  await audit(tx, ctx, "invoice.send", "invoice", id, { number: invoice.number });
}

export async function sendInvoice(ctx: Ctx, id: string): Promise<void> {
  await transaction((tx) => sendInvoiceTx(tx, ctx, id));
}

/**
 * Voiding: managers only, never twice, and only with nothing paid (reverse
 * payments first, so the money trail stays complete). A sent invoice gets
 * its stock back as "return" movements.
 */
export async function voidInvoice(ctx: Ctx, id: string, reason: string): Promise<void> {
  assertCan(ctx, "invoice.void");
  await transaction(async (tx) => {
    const invoice = await repo.findInvoice(tx, ctx.workspaceId, id, todayInLagos(), true);
    if (!invoice) throw new NotFoundError("Invoice");
    if (invoice.status === "void") throw new ConflictError("This invoice is already void.");
    if (invoice.amountPaidKobo > 0) throw new ConflictError("Reverse the payments on this invoice before voiding it.");
    if (invoice.status !== "draft") {
      const lines = invoice.items.filter((l) => l.productId).sort((a, b) => (a.productId! < b.productId! ? -1 : 1));
      for (const line of lines) {
        await insertMovement(tx, {
          workspaceId: ctx.workspaceId,
          productId: line.productId!,
          quantityDelta: line.quantity,
          reason: "return",
          invoiceId: id,
          note: "Invoice voided",
          userId: ctx.userId,
        });
      }
    }
    await tx.query(
      "UPDATE invoices SET status = 'void', voided_at = now(), voided_by = $3, void_reason = $4 WHERE workspace_id = $1 AND id = $2",
      [ctx.workspaceId, id, ctx.userId, reason],
    );
    await audit(tx, ctx, "invoice.void", "invoice", id, { number: invoice.number, restoredStock: invoice.status !== "draft" });
  });
}
