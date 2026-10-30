import "server-only";
import { db, int, isUniqueViolation } from "@/lib/db";
import { todayInLagos } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { appUrl, deliverPending, queueEmail } from "@/lib/email";
import { logError, logInfo } from "@/lib/log";
import * as reports from "@/lib/repos/reports";

// The daily job. Run by Vercel Cron (/api/cron/daily) and also lazily when a
// dashboard loads, so it still happens on a laptop with no cron. Idempotent:
//   * cron_runs has one row per day; a second run the same day that finds
//     "ok" does nothing (a failed or stuck run may be retried);
//   * every step is safe to repeat on its own (deletes of old rows, updates
//     guarded by WHERE status = 'pending', emails deduplicated in the outbox).
//
// Overdue invoices are NOT "marked": overdue is derived from the due date
// when read, so it is never stale; the job only reports them.

const JOB = "daily";

export interface DailySummary {
  skipped?: boolean;
  demoWorkspacesDeleted?: number;
  demoUsersDeleted?: number;
  proposalsExpired?: number;
  invitationsExpired?: number;
  sessionsDeleted?: number;
  rateLimitRowsDeleted?: number;
  digestsQueued?: number;
  emailsSent?: number;
}

async function claim(day: string): Promise<boolean> {
  try {
    await db.query("INSERT INTO cron_runs (job, run_date, status) VALUES ($1, $2, 'running')", [JOB, day]);
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  // Already claimed today: retry only if it failed, or is stuck for 15 minutes.
  const rows = await db.query(
    `UPDATE cron_runs SET status = 'running', started_at = now(), finished_at = NULL
      WHERE job = $1 AND run_date = $2 AND (status = 'failed' OR (status = 'running' AND started_at < now() - interval '15 minutes'))
      RETURNING id`,
    [JOB, day],
  );
  return rows.length > 0;
}

export async function runDaily(options: { force?: boolean } = {}): Promise<DailySummary> {
  const day = todayInLagos();
  if (!(await claim(day)) && !options.force) return { skipped: true };
  const summary: DailySummary = {};
  try {
    // 1. Demo sandboxes older than 24 hours (workspace first, then its user).
    const ws = await db.query("DELETE FROM workspaces WHERE is_demo AND created_at < now() - interval '24 hours' RETURNING id");
    summary.demoWorkspacesDeleted = ws.length;
    const users = await db.query(
      `DELETE FROM users u WHERE u.is_demo AND u.created_at < now() - interval '24 hours'
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id) RETURNING id`,
    );
    summary.demoUsersDeleted = users.length;

    // 2. Expire stale proposals and invitations.
    summary.proposalsExpired = (await db.query("UPDATE ai_proposals SET status = 'expired', decided_at = now() WHERE status = 'pending' AND expires_at < now() RETURNING id")).length;
    summary.invitationsExpired = (
      await db.query("UPDATE invitations SET revoked_at = now() WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at < now() RETURNING id")
    ).length;

    // 3. Housekeeping.
    summary.sessionsDeleted = (await db.query("DELETE FROM sessions WHERE expires_at < now() RETURNING id")).length;
    summary.rateLimitRowsDeleted = (await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days' RETURNING key")).length;

    // 4. One digest per (real) workspace per day, queued with a dedupe key.
    summary.digestsQueued = await queueDigests(day);
    summary.emailsSent = (await deliverPending({ limit: 100 })).sent;

    await db.query("UPDATE cron_runs SET status = 'ok', finished_at = now(), summary = $3 WHERE job = $1 AND run_date = $2", [JOB, day, JSON.stringify(summary)]);
    logInfo("daily job ok", { ...summary });
    return summary;
  } catch (error) {
    logError("daily job failed", error);
    await db.query("UPDATE cron_runs SET status = 'failed', finished_at = now(), summary = $3 WHERE job = $1 AND run_date = $2", [
      JOB,
      day,
      JSON.stringify({ error: String(error).slice(0, 200) }),
    ]);
    throw error;
  }
}

async function queueDigests(day: string): Promise<number> {
  const workspaces = await db.query<{ id: string; name: string }>("SELECT id, name FROM workspaces WHERE NOT is_demo ORDER BY created_at");
  let queued = 0;
  for (const w of workspaces) {
    const [owed, low, owners] = await Promise.all([
      reports.owed(db, w.id, day),
      reports.lowStock(db, w.id, 10),
      db.query<{ email: string }>("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.role = 'owner' AND NOT u.is_demo", [w.id]),
    ]);
    if (owed.overdueCount === 0 && low.length === 0) continue;
    const text = [
      `Good morning from Ledgerline. Here's ${w.name} today (${day}):`,
      "",
      `Overdue invoices: ${owed.overdueCount}, totalling ${formatNaira(owed.overdueKobo)}.`,
      low.length ? `Running low:\n${low.map((p) => `  - ${p.name}: ${p.stockQuantity} ${p.unit} left`).join("\n")}` : "Stock levels look fine.",
      "",
      `Open the dashboard: ${appUrl()}/app`,
    ].join("\n");
    for (const owner of owners) {
      const added = await queueEmail({ workspaceId: w.id, dedupeKey: `digest:${w.id}:${owner.email}:${day}`, to: owner.email, subject: `${w.name}: ${owed.overdueCount} overdue, ${low.length} low on stock`, text });
      if (added) queued++;
    }
  }
  return queued;
}

/** Called from the dashboard: cheap check, runs at most once a day. */
export async function runDailyIfDue(): Promise<void> {
  const rows = await db.query<{ n: unknown }>("SELECT count(*) AS n FROM cron_runs WHERE job = $1 AND run_date = $2", [JOB, todayInLagos()]);
  if (int(rows[0]?.n ?? 0) > 0) return;
  await runDaily().catch(() => undefined);
}
