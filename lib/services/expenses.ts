import "server-only";
import { db, int, isUniqueViolation, toDate, transaction, type Param } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, assertCanEdit, can } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { encodeCursor, PAGE_SIZE } from "@/lib/cursor";
import type { Ctx } from "@/lib/context";
import type { ExpenseCategory, ExpenseInput } from "@/lib/validation/business";

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amountKobo: number;
  spentOn: string;
  note: string | null;
  receiptRef: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
}

type Row = Record<string, unknown>;

const SELECT = `SELECT e.id, e.category, e.amount_kobo, e.spent_on::text AS spent_on, e.note, e.receipt_ref, e.created_by,
  u.name AS created_by_name, e.created_at FROM expenses e LEFT JOIN users u ON u.id = e.created_by`;

function map(r: Row): Expense {
  return {
    id: String(r.id),
    category: r.category as ExpenseCategory,
    amountKobo: int(r.amount_kobo),
    spentOn: String(r.spent_on),
    note: (r.note as string | null) ?? null,
    receiptRef: (r.receipt_ref as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: toDate(r.created_at),
  };
}

/** Managers see every expense; staff see only the ones they recorded. */
export async function listExpenses(ctx: Ctx, after: { date: string; id: string } | null) {
  const params: Param[] = [ctx.workspaceId];
  const where = ["e.workspace_id = $1"];
  if (!can(ctx.role, "expense.view_all")) {
    params.push(ctx.userId);
    where.push(`e.created_by = $${params.length}`);
  }
  if (after) {
    params.push(after.date, after.id);
    where.push(`(e.spent_on, e.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  params.push(PAGE_SIZE + 1);
  const rows = await db.query<Row>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY e.spent_on DESC, e.id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, PAGE_SIZE).map(map);
  const last = page.at(-1);
  return { expenses: page, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.spentOn, last.id]) : null };
}

export async function getExpense(ctx: Ctx, id: string): Promise<Expense> {
  const rows = await db.query<Row>(`${SELECT} WHERE e.workspace_id = $1 AND e.id = $2`, [ctx.workspaceId, id]);
  const r = rows[0];
  // Staff asking for a colleague's expense: same "not found" as a wrong id.
  if (!r || (!can(ctx.role, "expense.view_all") && r.created_by !== ctx.userId)) throw new NotFoundError("Expense");
  return map(r);
}

async function byRequest(ctx: Ctx, clientRequestId: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>("SELECT id FROM expenses WHERE workspace_id = $1 AND client_request_id = $2", [
    ctx.workspaceId,
    clientRequestId,
  ]);
  return rows[0]?.id ?? null;
}

export async function createExpense(ctx: Ctx, input: ExpenseInput): Promise<{ id: string; created: boolean }> {
  assertCan(ctx, "expense.create");
  const existing = await byRequest(ctx, input.clientRequestId);
  if (existing) return { id: existing, created: false };
  try {
    return await transaction(async (tx) => {
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO expenses (workspace_id, category, amount_kobo, spent_on, note, receipt_ref, client_request_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [ctx.workspaceId, input.category, input.amount, input.spentOn, input.note, input.receiptRef, input.clientRequestId, ctx.userId],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("expense insert returned nothing");
      await audit(tx, ctx, "expense.create", "expense", id, { category: input.category, amountKobo: input.amount });
      return { id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, "expenses_request_per_workspace")) {
      const id = await byRequest(ctx, input.clientRequestId);
      if (id) return { id, created: false };
    }
    throw error;
  }
}

export async function updateExpense(ctx: Ctx, id: string, input: ExpenseInput): Promise<void> {
  const existing = await getExpense(ctx, id);
  assertCanEdit(ctx, existing, "expense.edit_own", "expense.edit_any");
  await transaction(async (tx) => {
    await tx.query(
      `UPDATE expenses SET category = $3, amount_kobo = $4, spent_on = $5, note = $6, receipt_ref = $7 WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, id, input.category, input.amount, input.spentOn, input.note, input.receiptRef],
    );
    await audit(tx, ctx, "expense.update", "expense", id, { amountKobo: input.amount });
  });
}

/** Expenses aren't a ledger other rows depend on, so managers may delete one. */
export async function deleteExpense(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, "expense.edit_any", "Only managers and owners can delete expenses.");
  await getExpense(ctx, id);
  await transaction(async (tx) => {
    await tx.query("DELETE FROM expenses WHERE workspace_id = $1 AND id = $2", [ctx.workspaceId, id]);
    await audit(tx, ctx, "expense.delete", "expense", id);
  });
}
