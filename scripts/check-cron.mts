// Daily job checks: idempotent, and one digest per workspace owner per day.
import { db } from "@/lib/db";
import { addDays, todayInLagos } from "@/lib/dates";
import { createInvoice } from "@/lib/services/invoices";
import { runDaily } from "@/lib/services/daily";
import { assert, check, invoiceInput, type World } from "./check-ledgerline.mts";

export async function cronChecks(world: World): Promise<void> {
  await check("the daily cron is idempotent and queues one digest per workspace owner", async () => {
    const today = todayInLagos();
    // An overdue invoice so workspace A has something to report.
    await createInvoice(world.a.owner, invoiceInput(world.a.customerId, [{ description: "Old sale", quantity: 1, unitPrice: "5000" }], { issueDate: addDays(today, -10), dueDate: addDays(today, -3) }));
    await db.query("DELETE FROM cron_runs WHERE job = 'daily' AND run_date = $1", [today]);
    const first = await runDaily();
    const second = await runDaily();
    assert(!first.skipped && second.skipped === true, `first ${JSON.stringify(first)}, second ${JSON.stringify(second)}`);
    await runDaily({ force: true }); // even a forced re-run can't double-send
    const digests = await db.query<{ n: string }>("SELECT count(*) AS n FROM email_outbox WHERE dedupe_key LIKE $1", [`digest:${world.a.workspaceId}:%:${today}`]);
    assert(Number(digests[0]!.n) === 1, `${digests[0]!.n} digests for workspace A`);
  });
}
