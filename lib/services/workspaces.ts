import "server-only";
import { db, int, transaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { setActiveWorkspace } from "@/lib/auth/session";
import { assertCan, isRole, type Role } from "@/lib/permissions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Ctx } from "@/lib/context";
import type { WorkspaceDetailsInput } from "@/lib/validation/workspace";

export interface MyWorkspace {
  id: string;
  name: string;
  role: Role;
  isDemo: boolean;
  members: number;
}

export async function listMyWorkspaces(userId: string): Promise<MyWorkspace[]> {
  const rows = await db.query<{ id: string; name: string; role: string; is_demo: boolean; members: unknown }>(
    `SELECT w.id, w.name, m.role, w.is_demo,
            (SELECT count(*) FROM memberships x WHERE x.workspace_id = w.id) AS members
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1
      ORDER BY lower(w.name)`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, role: isRole(r.role) ? r.role : "staff", isDemo: r.is_demo, members: int(r.members) }));
}

/** The creator becomes the owner, in the same transaction. */
export async function createWorkspace(user: { userId: string; sessionId: string }, input: { name: string }): Promise<string> {
  const id = await transaction(async (tx) => {
    const rows = await tx.query<{ id: string }>("INSERT INTO workspaces (name) VALUES ($1) RETURNING id", [input.name]);
    const workspaceId = rows[0]?.id;
    if (!workspaceId) throw new Error("workspace insert returned nothing");
    await tx.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, user.userId]);
    await audit(tx, { userId: user.userId, workspaceId }, "workspace.create", "workspace", workspaceId);
    return workspaceId;
  });
  await setActiveWorkspace(user.sessionId, id);
  return id;
}

/** Switching stores the choice in the session row after checking membership. */
export async function switchWorkspace(user: { userId: string; sessionId: string }, workspaceId: string): Promise<void> {
  const rows = await db.query("SELECT 1 FROM memberships WHERE user_id = $1 AND workspace_id = $2", [user.userId, workspaceId]);
  if (rows.length === 0) throw new NotFoundError("Workspace");
  await setActiveWorkspace(user.sessionId, workspaceId);
}

export interface WorkspaceDetails extends WorkspaceDetailsInput {
  id: string;
  isDemo: boolean;
  nextInvoiceNumber: number;
}

export async function getWorkspaceDetails(ctx: Ctx): Promise<WorkspaceDetails> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, name, business_address, business_phone, business_email, bank_details, invoice_prefix,
            low_stock_default, next_invoice_number, is_demo
       FROM workspaces WHERE id = $1`,
    [ctx.workspaceId],
  );
  const r = rows[0];
  if (!r) throw new NotFoundError("Workspace");
  return {
    id: String(r.id),
    name: String(r.name),
    businessAddress: (r.business_address as string | null) ?? null,
    businessPhone: (r.business_phone as string | null) ?? null,
    businessEmail: (r.business_email as string | null) ?? null,
    bankDetails: (r.bank_details as string | null) ?? null,
    invoicePrefix: String(r.invoice_prefix),
    lowStockDefault: int(r.low_stock_default),
    nextInvoiceNumber: int(r.next_invoice_number),
    isDemo: Boolean(r.is_demo),
  };
}

export async function updateWorkspaceDetails(ctx: Ctx, input: WorkspaceDetailsInput): Promise<void> {
  assertCan(ctx, "workspace.edit_details");
  await transaction(async (tx) => {
    await tx.query(
      `UPDATE workspaces SET name = $2, business_address = $3, business_phone = $4, business_email = $5,
              bank_details = $6, invoice_prefix = $7, low_stock_default = $8
        WHERE id = $1`,
      [
        ctx.workspaceId,
        input.name,
        input.businessAddress,
        input.businessPhone,
        input.businessEmail,
        input.bankDetails,
        input.invoicePrefix,
        input.lowStockDefault,
      ],
    );
    await audit(tx, ctx, "workspace.update", "workspace", ctx.workspaceId);
  });
}

/** Owner only, and only after typing the exact business name. Cascades everything. */
export async function deleteWorkspace(ctx: Ctx, typedName: string): Promise<void> {
  assertCan(ctx, "workspace.delete");
  const details = await getWorkspaceDetails(ctx);
  if (typedName.trim() !== details.name) {
    throw new ValidationError("Type the business name exactly to confirm.", { confirmName: ["The name doesn't match."] });
  }
  await db.query("DELETE FROM workspaces WHERE id = $1", [ctx.workspaceId]);
}
