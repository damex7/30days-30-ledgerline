import { runDailyIfDue } from "@/lib/services/daily";

// Renders nothing. When the dashboard loads, runs the daily job if it
// hasn't run today, so local setups without a cron still get it.
export async function DailyJobs() {
  await runDailyIfDue().catch(() => undefined);
  return null;
}
