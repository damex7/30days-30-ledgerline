import "server-only";
import { db, transaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, assertCanEdit } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { encodeCursor, PAGE_SIZE } from "@/lib/cursor";
import type { Ctx } from "@/lib/context";
import type { CustomerInput } from "@/lib/validation/business";
import * as repo from "@/lib/repos/customers";

// Customers: rules on top of the SQL. Every function takes the acting
// context first and checks permission before touching anything.

export type { Customer } from "@/lib/repos/customers";

export async function listCustomers(ctx: Ctx, options: { q?: string; after?: { name: string; id: string } | null; archived?: boolean }) {
  assertCan(ctx, "customer.view");
  const rows = await repo.listCustomers(db, ctx.workspaceId, { ...options, limit: PAGE_SIZE + 1 });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    customers: page,
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.name.toLowerCase(), last.id]) : null,
  };
}

/** Not in this workspace = not found (404), exactly like "doesn't exist". */
export async function getCustomer(ctx: Ctx, id: string) {
  assertCan(ctx, "customer.view");
  const customer = await repo.findCustomer(db, ctx.workspaceId, id);
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}

export async function searchCustomers(ctx: Ctx, query: string, limit = 8) {
  assertCan(ctx, "customer.view");
  return repo.searchCustomers(db, ctx.workspaceId, query.slice(0, 80), Math.min(limit, 20));
}

export async function createCustomer(ctx: Ctx, input: CustomerInput): Promise<string> {
  assertCan(ctx, "customer.create");
  return transaction(async (tx) => {
    const id = await repo.insertCustomer(tx, ctx.workspaceId, ctx.userId, input);
    await audit(tx, ctx, "customer.create", "customer", id);
    return id;
  });
}

export async function updateCustomer(ctx: Ctx, id: string, input: CustomerInput): Promise<void> {
  const existing = await getCustomer(ctx, id);
  assertCanEdit(ctx, existing, "customer.edit_own", "customer.edit_any");
  await transaction(async (tx) => {
    await repo.updateCustomerRow(tx, ctx.workspaceId, id, input);
    await audit(tx, ctx, "customer.update", "customer", id);
  });
}

/** Customers with invoices can't be deleted (the FK refuses), so they're archived. */
export async function archiveCustomer(ctx: Ctx, id: string, archived: boolean): Promise<void> {
  assertCan(ctx, "customer.archive");
  await getCustomer(ctx, id);
  await transaction(async (tx) => {
    await repo.setCustomerArchived(tx, ctx.workspaceId, id, archived);
    await audit(tx, ctx, archived ? "customer.archive" : "customer.restore", "customer", id);
  });
}

/** All active customers for pickers (capped). */
export async function customerOptions(ctx: Ctx): Promise<{ id: string; name: string }[]> {
  assertCan(ctx, "customer.view");
  const rows = await db.query<{ id: string; name: string }>(
    "SELECT id, name FROM customers WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY lower(name) LIMIT 500",
    [ctx.workspaceId],
  );
  return rows;
}
