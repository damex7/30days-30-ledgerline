import "server-only";
import type { Db } from "@/lib/db";
import type { Ctx } from "@/lib/context";

// The audit trail: who did what to which record, written in the SAME
// transaction as the change (so a rolled-back change leaves no event, and a
// committed one always has one). details holds ids, numbers, roles and
// counts only: never passwords, tokens, notes or customer contact details.

export type AuditDetails = Record<string, string | number | boolean | null>;

export async function audit(
  tx: Db,
  ctx: Pick<Ctx, "userId" | "workspaceId">,
  action: string,
  entityType: string,
  entityId: string | null,
  details: AuditDetails = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (workspace_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ctx.workspaceId, ctx.userId, action, entityType, entityId, details],
  );
}
