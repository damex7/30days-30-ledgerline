import "server-only";
import { db } from "@/lib/db";
import { assertCan, can } from "@/lib/permissions";
import { ValidationError } from "@/lib/errors";
import { addDays, daysBetween, resolvePreset, todayInLagos, type DateRange } from "@/lib/dates";
import type { Ctx } from "@/lib/context";
import * as repo from "@/lib/repos/reports";

export type { Summary, Owed, OverdueRow, TopProduct, TopCustomer, LowStockRow, DayPoint, CategoryTotal, OwingCustomer } from "@/lib/repos/reports";

export const MAX_RANGE_DAYS = 366;

/** What a role may see of a summary: staff never get expenses or profit. */
export type VisibleSummary = Omit<repo.Summary, "expensesKobo" | "costOfGoodsKobo" | "estimatedProfitKobo"> & {
  expensesKobo: number | null;
  costOfGoodsKobo: number | null;
  estimatedProfitKobo: number | null;
};

function visible(ctx: Ctx, s: repo.Summary): VisibleSummary {
  if (can(ctx.role, "report.profit")) return s;
  return { ...s, expensesKobo: null, costOfGoodsKobo: null, estimatedProfitKobo: null };
}

export function checkRange(from: string, to: string): void {
  if (to < from) throw new ValidationError("The end date is before the start date.", { to: ["Must be on or after the start date."] });
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new ValidationError("Choose a range of at most a year.", { to: ["At most 366 days."] });
}

export async function dashboard(ctx: Ctx) {
  assertCan(ctx, "report.basic");
  const today = todayInLagos();
  const periods = (["today", "this_week", "this_month"] as const).map((p) => ({ key: p, range: resolvePreset(p, today) }));
  const month = resolvePreset("this_month", today);
  const chartFrom = addDays(today, -29);
  const [summaries, owed, overdue, low, topP, topC, days] = await Promise.all([
    Promise.all(periods.map((p) => repo.summary(db, ctx.workspaceId, p.range.from, p.range.to))),
    repo.owed(db, ctx.workspaceId, today),
    repo.overdueInvoices(db, ctx.workspaceId, today, 5),
    repo.lowStock(db, ctx.workspaceId, 6),
    repo.topProducts(db, ctx.workspaceId, month.from, month.to, 5),
    repo.topCustomers(db, ctx.workspaceId, month.from, month.to, 5),
    repo.daily(db, ctx.workspaceId, chartFrom, today),
  ]);
  const showProfit = can(ctx.role, "report.profit");
  return {
    today,
    periods: periods.map((p, i) => ({ key: p.key, range: p.range, summary: visible(ctx, summaries[i]!) })),
    owed,
    overdue,
    lowStock: low,
    month,
    topProducts: topP.map((t) => ({ ...t, profitKobo: showProfit ? t.profitKobo : null })),
    topCustomers: topC,
    days,
    showProfit,
  };
}

export async function report(ctx: Ctx, range: DateRange) {
  assertCan(ctx, "report.basic");
  checkRange(range.from, range.to);
  const showProfit = can(ctx.role, "report.profit");
  const [s, topP, topC, days, breakdown] = await Promise.all([
    repo.summary(db, ctx.workspaceId, range.from, range.to),
    repo.topProducts(db, ctx.workspaceId, range.from, range.to, 10),
    repo.topCustomers(db, ctx.workspaceId, range.from, range.to, 10),
    daysBetween(range.from, range.to) <= 92 ? repo.daily(db, ctx.workspaceId, range.from, range.to) : Promise.resolve([]),
    showProfit ? repo.expenseBreakdown(db, ctx.workspaceId, range.from, range.to) : Promise.resolve([]),
  ]);
  return {
    range,
    summary: visible(ctx, s),
    topProducts: topP.map((t) => ({ ...t, profitKobo: showProfit ? t.profitKobo : null })),
    topCustomers: topC,
    days,
    expenseBreakdown: breakdown,
    showProfit,
  };
}

/** Profit and loss for a range: managers and owners only. */
export async function profitSummary(ctx: Ctx, from: string, to: string): Promise<repo.Summary> {
  assertCan(ctx, "report.profit");
  checkRange(from, to);
  return repo.summary(db, ctx.workspaceId, from, to);
}

export async function exportInvoices(ctx: Ctx, from: string, to: string) {
  assertCan(ctx, "report.export");
  checkRange(from, to);
  return repo.invoiceRows(db, ctx.workspaceId, from, to);
}
