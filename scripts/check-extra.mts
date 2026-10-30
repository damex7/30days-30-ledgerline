// Checks for team, reports, AI and cron, run by check-ledgerline.mts.
import { randomToken, tokenHashParam } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { todayInLagos } from "@/lib/dates";
import { profitSummary, exportInvoices } from "@/lib/services/reports";
import { acceptInvitation, changeRole, previewInvitation, removeMember } from "@/lib/services/team";
import { assert, check, rejects, type World } from "./check-ledgerline.mts";
import { aiChecks } from "./check-ai.mts";
import { cronChecks } from "./check-cron.mts";

export async function extraChecks(world: World): Promise<void> {
  const { a } = world;
  const today = todayInLagos();

  await check("staff cannot see profit reports or export them", async () => {
    await rejects(() => profitSummary(a.staff, today, today), ForbiddenError, "profit Forbidden");
    await rejects(() => exportInvoices(a.staff, today, today), ForbiddenError, "export Forbidden");
    await profitSummary(a.manager, today, today);
  });

  await check("the last owner cannot be removed or demoted", async () => {
    await rejects(() => changeRole(a.owner, a.owner.userId, "manager"), ConflictError, "demote last owner");
    await rejects(() => removeMember(a.owner, a.owner.userId), ConflictError, "remove last owner");
    await rejects(() => changeRole(a.manager, a.owner.userId, "staff"), ForbiddenError, "manager can't change roles");
    // Even straight SQL can't leave the workspace without an owner (deferred trigger).
    try {
      await db.query("UPDATE memberships SET role = 'manager' WHERE workspace_id = $1 AND role = 'owner'", [a.workspaceId]);
    } catch {
      return;
    }
    throw new Error("the database allowed a workspace with no owner");
  });

  await check("an expired or revoked invitation returns not found", async () => {
    const email = (await db.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [a.staff.userId]))[0]!.email;
    const expired = randomToken();
    const revoked = randomToken();
    await db.query(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, expires_at, created_at)
       VALUES ($1, 'nobody-expired@example.com', 'staff', $2, now() - interval '1 day', now() - interval '8 days')`,
      [a.workspaceId, tokenHashParam(expired)],
    );
    await db.query(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, expires_at, revoked_at)
       VALUES ($1, $3, 'manager', $2, now() + interval '7 days', now())`,
      [a.workspaceId, tokenHashParam(revoked), email],
    );
    assert((await previewInvitation(expired)) === null, "expired invite still previews");
    assert((await previewInvitation(revoked)) === null, "revoked invite still previews");
    assert((await previewInvitation(randomToken())) === null, "made-up token previews");
    const session = { userId: a.staff.userId, email, sessionId: "00000000-0000-0000-0000-000000000000" };
    await rejects(() => acceptInvitation(session, revoked), NotFoundError, "revoked invite accept");
  });

  await aiChecks(world);
  await cronChecks(world);
}
