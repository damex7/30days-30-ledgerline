import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import { isRole, type Role } from "@/lib/permissions";
import { getSession, setActiveWorkspace, type SessionUser } from "@/lib/auth/session";

// The acting context: WHO is acting, in WHICH workspace, AS WHAT. Every
// service function takes it as its first argument and enforces its rules
// against it.
//
// The workspace id comes from the session row, never from the URL, a form
// field or the AI model. The role is read from memberships on every request
// instead of being remembered in the cookie: removing someone from a
// workspace, or demoting them, takes effect on their very next click, on
// every device they are signed in on.

export interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  isDemo: boolean;
  invoicePrefix: string;
}

export interface PageContext extends Ctx {
  user: SessionUser;
  workspace: WorkspaceSummary;
}

interface MembershipRow {
  role: string;
  id: string;
  name: string;
  is_demo: boolean;
  invoice_prefix: string;
}

async function loadMembership(userId: string, workspaceId: string): Promise<MembershipRow | null> {
  const rows = await db.query<MembershipRow>(
    `SELECT m.role, w.id, w.name, w.is_demo, w.invoice_prefix
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.workspace_id = $2`,
    [userId, workspaceId],
  );
  return rows[0] ?? null;
}

function toContext(user: SessionUser, row: MembershipRow): PageContext {
  if (!isRole(row.role)) throw new Error(`Unknown role ${row.role}`);
  return {
    userId: user.userId,
    workspaceId: row.id,
    role: row.role,
    user,
    workspace: { id: row.id, name: row.name, isDemo: row.is_demo, invoicePrefix: row.invoice_prefix },
  };
}

/** Pages: the signed-in user, or a redirect to /sign-in. */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const user = await getSession();
  if (!user) redirect("/sign-in");
  return user;
});

/**
 * Pages under /app: user + workspace + role, verified against memberships.
 * No active workspace, or no longer a member of it: off to /workspaces.
 */
export const getContext = cache(async (): Promise<PageContext> => {
  const user = await requireUser();
  if (!user.activeWorkspaceId) redirect("/workspaces");
  const row = await loadMembership(user.userId, user.activeWorkspaceId);
  if (!row) {
    await setActiveWorkspace(user.sessionId, null);
    redirect("/workspaces?notice=removed");
  }
  return toContext(user, row);
});

/** Route handlers: same checks, but errors instead of redirects. */
export async function getApiContext(): Promise<PageContext> {
  const user = await getSession();
  if (!user) throw new UnauthenticatedError();
  if (!user.activeWorkspaceId) throw new NotFoundError("Workspace");
  const row = await loadMembership(user.userId, user.activeWorkspaceId);
  if (!row) throw new NotFoundError("Workspace");
  return toContext(user, row);
}

/** Scripts and the cron: build a context from ids, still verified. */
export async function contextFor(userId: string, workspaceId: string): Promise<Ctx> {
  const rows = await db.query<{ role: string }>("SELECT role FROM memberships WHERE user_id = $1 AND workspace_id = $2", [
    userId,
    workspaceId,
  ]);
  const role = rows[0]?.role;
  if (!isRole(role)) throw new NotFoundError("Workspace");
  return { userId, workspaceId, role };
}
