import "server-only";
import { db, toDate, toDateOrNull, transaction, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, isRole, ROLE_LABELS, type Role } from "@/lib/permissions";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { randomToken, tokenHashParam } from "@/lib/crypto";
import { enforce } from "@/lib/rate-limit";
import { appUrl, deliverPending, queueEmail } from "@/lib/email";
import { setActiveWorkspace, type SessionUser } from "@/lib/auth/session";
import type { Ctx } from "@/lib/context";

// Members and invitations. Owner only. A workspace always keeps at least
// one owner: checked here with a clear message, and again at COMMIT by the
// deferred memberships_keep_an_owner trigger.

export const INVITE_DAYS = 7;

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

export async function listMembers(ctx: Ctx): Promise<Member[]> {
  assertCan(ctx, "team.manage");
  const rows = await db.query<Record<string, unknown>>(
    `SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, lower(u.name)`,
    [ctx.workspaceId],
  );
  return rows.map((r) => ({
    userId: String(r.id),
    name: String(r.name),
    email: String(r.email),
    role: isRole(r.role) ? r.role : "staff",
    joinedAt: toDate(r.created_at),
  }));
}

async function lockMembers(tx: Db, ctx: Ctx): Promise<{ user_id: string; role: string }[]> {
  // Locking every membership row of the workspace serialises role changes,
  // so two owners demoting each other at once can't leave zero owners.
  return tx.query<{ user_id: string; role: string }>("SELECT user_id, role FROM memberships WHERE workspace_id = $1 FOR UPDATE", [ctx.workspaceId]);
}

export async function changeRole(ctx: Ctx, userId: string, role: Role): Promise<void> {
  assertCan(ctx, "team.manage");
  await transaction(async (tx) => {
    const members = await lockMembers(tx, ctx);
    const target = members.find((m) => m.user_id === userId);
    if (!target) throw new NotFoundError("Member");
    if (target.role === role) return;
    const owners = members.filter((m) => m.role === "owner").length;
    if (target.role === "owner" && owners === 1) throw new ConflictError("This is the only owner. Make someone else an owner first.");
    await tx.query("UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [ctx.workspaceId, userId, role]);
    await audit(tx, ctx, "member.role_change", "user", userId, { from: target.role, to: role });
  });
}

export async function removeMember(ctx: Ctx, userId: string): Promise<void> {
  assertCan(ctx, "team.manage");
  await transaction(async (tx) => {
    const members = await lockMembers(tx, ctx);
    const target = members.find((m) => m.user_id === userId);
    if (!target) throw new NotFoundError("Member");
    if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) {
      throw new ConflictError("The last owner can't be removed. Make someone else an owner first.");
    }
    await tx.query("DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2", [ctx.workspaceId, userId]);
    // Their sessions stop pointing here; getContext() would refuse anyway.
    await tx.query("UPDATE sessions SET active_workspace_id = NULL WHERE user_id = $1 AND active_workspace_id = $2", [userId, ctx.workspaceId]);
    await audit(tx, ctx, "member.remove", "user", userId, { role: target.role });
  });
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  invitedByName: string | null;
  status: "open" | "expired";
}

export async function listInvitations(ctx: Ctx): Promise<Invitation[]> {
  assertCan(ctx, "team.manage");
  const rows = await db.query<Record<string, unknown>>(
    `SELECT i.id, i.email, i.role, i.expires_at, u.name AS invited_by_name, i.expires_at < now() AS expired
       FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.workspace_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ORDER BY i.created_at DESC`,
    [ctx.workspaceId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    role: isRole(r.role) ? r.role : "staff",
    expiresAt: toDate(r.expires_at),
    invitedByName: (r.invited_by_name as string | null) ?? null,
    status: r.expired ? "expired" : "open",
  }));
}

/** Returns the link so the owner can also share it by hand (shown once). */
export async function invite(ctx: Ctx, input: { email: string; role: Role }): Promise<{ link: string }> {
  assertCan(ctx, "team.manage");
  await enforce({ key: `invite:${ctx.workspaceId}`, max: 20, windowSeconds: 86_400 }, "That's a lot of invitations for one day.");
  const token = randomToken();
  const link = `${appUrl()}/accept-invite/${token}`;
  await transaction(async (tx) => {
    const member = await tx.query("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = $2", [
      ctx.workspaceId,
      input.email,
    ]);
    if (member.length) throw new ConflictError("That person is already a member.");
    // Re-inviting replaces the old link.
    await tx.query(
      "UPDATE invitations SET revoked_at = now() WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
      [ctx.workspaceId, input.email],
    );
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id`,
      [ctx.workspaceId, input.email, input.role, tokenHashParam(token), ctx.userId, INVITE_DAYS],
    );
    const id = rows[0]!.id;
    const ws = await tx.query<{ name: string }>("SELECT name FROM workspaces WHERE id = $1", [ctx.workspaceId]);
    await queueEmail(
      {
        workspaceId: ctx.workspaceId,
        dedupeKey: `invite:${id}`,
        to: input.email,
        subject: `You're invited to ${ws[0]?.name ?? "a business"} on Ledgerline`,
        text: `You've been invited to join ${ws[0]?.name ?? "a business"} on Ledgerline as ${ROLE_LABELS[input.role]}.\n\nOpen this link to accept (it works once and expires in ${INVITE_DAYS} days):\n${link}\n\nSign in or create an account with this email address (${input.email}) first.`,
      },
      tx,
    );
    await audit(tx, ctx, "member.invite", "invitation", id, { role: input.role });
    return id;
  });
  await deliverPending({ limit: 5 }).catch(() => undefined);
  return { link };
}

export async function revokeInvitation(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, "team.manage");
  await transaction(async (tx) => {
    const rows = await tx.query(
      "UPDATE invitations SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
      [ctx.workspaceId, id],
    );
    if (!rows.length) throw new NotFoundError("Invitation");
    await audit(tx, ctx, "member.invite_revoke", "invitation", id);
  });
}

export interface InvitePreview {
  workspaceName: string;
  email: string;
  role: Role;
  expiresAt: Date;
}

/** Unknown, used, revoked or expired all look the same: not found. */
export async function previewInvitation(token: string): Promise<InvitePreview | null> {
  if (!token || token.length > 100) return null;
  const rows = await db.query<Record<string, unknown>>(
    `SELECT w.name, i.email, i.role, i.expires_at FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [tokenHashParam(token)],
  );
  const r = rows[0];
  if (!r || !isRole(r.role)) return null;
  return { workspaceName: String(r.name), email: String(r.email), role: r.role, expiresAt: toDate(r.expires_at) };
}

/** Accepting requires being signed in AS the invited email. Single use. */
export async function acceptInvitation(user: Pick<SessionUser, "userId" | "email" | "sessionId">, token: string): Promise<string> {
  const workspaceId = await transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `SELECT id, workspace_id, email, role, expires_at, accepted_at, revoked_at FROM invitations WHERE token_hash = $1 FOR UPDATE`,
      [tokenHashParam(token)],
    );
    const inv = rows[0];
    if (!inv || inv.accepted_at || inv.revoked_at || toDateOrNull(inv.expires_at)!.getTime() < Date.now()) throw new NotFoundError("Invitation");
    if (String(inv.email) !== user.email) throw new ForbiddenError(`This invitation is for a different email address. Sign in as that address to accept it.`);
    const ws = String(inv.workspace_id);
    await tx.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [ws, user.userId, inv.role as string]);
    await tx.query("UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1", [inv.id as string, user.userId]);
    await audit(tx, { userId: user.userId, workspaceId: ws }, "member.join", "invitation", String(inv.id), { role: String(inv.role) });
    return ws;
  });
  await setActiveWorkspace(user.sessionId, workspaceId);
  return workspaceId;
}
