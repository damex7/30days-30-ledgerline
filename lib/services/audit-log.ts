import "server-only";
import { db, toDate, type Param } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { encodeCursor, PAGE_SIZE } from "@/lib/cursor";
import type { Ctx } from "@/lib/context";

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  actorName: string | null;
  createdAt: Date;
}

export async function listAuditEvents(ctx: Ctx, after: { at: string; id: string } | null, action?: string) {
  assertCan(ctx, "audit.view");
  const params: Param[] = [ctx.workspaceId];
  const where = ["a.workspace_id = $1"];
  if (action) {
    params.push(`${action}.%`);
    where.push(`a.action LIKE $${params.length}`);
  }
  if (after) {
    params.push(after.at, after.id);
    where.push(`(a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
  }
  params.push(PAGE_SIZE + 1);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.name AS actor_name
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`,
    params,
  );
  const events = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: String(r.id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: (r.entity_id as string | null) ?? null,
    details: (typeof r.details === "object" && r.details ? r.details : {}) as Record<string, unknown>,
    actorName: (r.actor_name as string | null) ?? null,
    createdAt: toDate(r.created_at),
  }));
  const last = events.at(-1);
  return { events, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null };
}
