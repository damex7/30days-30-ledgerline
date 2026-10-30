import "server-only";
import { Resend } from "resend";
import { db, type Db } from "@/lib/db";
import { logError, logInfo } from "@/lib/log";

// Email goes through an outbox. Queuing writes a row with a dedupe key
// ("digest:<workspace>:<date>", "invite:<id>"); a second queue with the same
// key does nothing, so a retried cron or a double click never emails twice.
// Delivery then sends each pending row once and marks it sent.
// Without RESEND_API_KEY, emails are printed to the terminal instead.

export interface OutgoingEmail {
  workspaceId: string | null;
  dedupeKey: string;
  to: string;
  subject: string;
  text: string;
}

/** Returns true if this call queued it, false if it was already queued. */
export async function queueEmail(email: OutgoingEmail, client: Db = db): Promise<boolean> {
  const rows = await client.query(
    `INSERT INTO email_outbox (workspace_id, dedupe_key, to_email, subject, body_text)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [email.workspaceId, email.dedupeKey, email.to, email.subject, email.text],
  );
  return rows.length > 0;
}

let resend: Resend | null = null;

async function send(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`\n--- email (RESEND_API_KEY not set, printed instead) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- end email ---\n`);
    return;
  }
  resend ??= new Resend(key);
  const { error } = await resend.emails.send({ from: process.env.EMAIL_FROM || "Ledgerline <onboarding@resend.dev>", to, subject, text });
  if (error) throw new Error(`Resend: ${error.message}`);
}

/** Sends pending emails (optionally one key). Each row is claimed with SKIP LOCKED. */
export async function deliverPending(options: { dedupeKey?: string; limit?: number } = {}): Promise<{ sent: number; failed: number }> {
  const rows = await db.query<{ id: string; to_email: string; subject: string; body_text: string }>(
    `UPDATE email_outbox SET attempts = attempts + 1
      WHERE id IN (SELECT id FROM email_outbox
                    WHERE status <> 'sent' AND attempts < 5 ${options.dedupeKey ? "AND dedupe_key = $2" : ""}
                    ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, to_email, subject, body_text`,
    options.dedupeKey ? [options.limit ?? 50, options.dedupeKey] : [options.limit ?? 50],
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await send(row.to_email, row.subject, row.body_text);
      await db.query("UPDATE email_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1", [row.id]);
      sent++;
    } catch (error) {
      failed++;
      logError("email failed", error, { outboxId: row.id });
      await db.query("UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = $1", [row.id, String(error).slice(0, 300)]);
    }
  }
  if (rows.length) logInfo("emails delivered", { sent, failed });
  return { sent, failed };
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3030").replace(/\/$/, "");
}
