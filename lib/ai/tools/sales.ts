import "server-only";
import { z } from "zod";
import * as reports from "@/lib/repos/reports";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/validation/business";
import { defineTool, money, rangeArg, rangeInfo, resolveRange } from "@/lib/ai/tools/types";

export const getSalesSummary = defineTool({
  name: "get_sales_summary",
  label: "Checked sales and payments",
  description:
    "Sales (invoices sent), payments received and number of invoices for a period, plus how much customers owe right now. No profit figures.",
  minRole: "staff",
  maxRows: 1,
  args: z.object({ range: rangeArg.optional() }),
  async run({ ctx, db, today }, args) {
    const range = resolveRange(args.range, today);
    const [s, o] = await Promise.all([reports.summary(db, ctx.workspaceId, range.from, range.to), reports.owed(db, ctx.workspaceId, today)]);
    return {
      rows: 1,
      data: {
        period: rangeInfo(range),
        invoices_sent: s.invoiceCount,
        sales: money(s.salesKobo),
        payments_received: money(s.paymentsKobo),
        owed_now: { ...money(o.owedKobo), open_invoices: o.openCount },
        overdue_now: { ...money(o.overdueKobo), invoices: o.overdueCount },
      },
    };
  },
});

export const comparePeriods = defineTool({
  name: "compare_periods",
  label: "Compared two periods",
  description:
    "Compares sales, payments received and invoice count between two periods (for example this month vs last month). Differences are already computed.",
  minRole: "staff",
  maxRows: 2,
  args: z.object({ current: rangeArg, previous: rangeArg }),
  async run({ ctx, db, today }, args) {
    const a = resolveRange(args.current, today);
    const b = resolveRange(args.previous, today);
    const [x, y] = await Promise.all([reports.summary(db, ctx.workspaceId, a.from, a.to), reports.summary(db, ctx.workspaceId, b.from, b.to)]);
    const pct = (now: number, then: number) => (then === 0 ? null : Math.round(((now - then) * 1000) / then) / 10);
    return {
      rows: 2,
      data: {
        current: { period: rangeInfo(a), sales: money(x.salesKobo), payments_received: money(x.paymentsKobo), invoices_sent: x.invoiceCount },
        previous: { period: rangeInfo(b), sales: money(y.salesKobo), payments_received: money(y.paymentsKobo), invoices_sent: y.invoiceCount },
        change: {
          sales: money(x.salesKobo - y.salesKobo),
          sales_percent: pct(x.salesKobo, y.salesKobo),
          payments_received: money(x.paymentsKobo - y.paymentsKobo),
          invoices_sent: x.invoiceCount - y.invoiceCount,
        },
      },
    };
  },
});

export const getProfitSummary = defineTool({
  name: "get_profit_summary",
  label: "Checked estimated profit",
  description: "Estimated profit for a period: sales minus cost of goods sold minus expenses. Managers and owners only.",
  minRole: "manager",
  maxRows: 1,
  args: z.object({ range: rangeArg.optional() }),
  async run({ ctx, db, today }, args) {
    const range = resolveRange(args.range, today);
    const s = await reports.summary(db, ctx.workspaceId, range.from, range.to);
    return {
      rows: 1,
      data: {
        period: rangeInfo(range),
        sales: money(s.salesKobo),
        cost_of_goods_sold: money(s.costOfGoodsKobo),
        expenses: money(s.expensesKobo),
        estimated_profit: money(s.estimatedProfitKobo),
        note: "Estimated profit = sales − cost of goods sold − expenses.",
      },
    };
  },
});

export const getExpenseBreakdown = defineTool({
  name: "get_expense_breakdown",
  label: "Checked expenses by category",
  description: "Expenses for a period grouped by category, largest first. Managers and owners only.",
  minRole: "manager",
  maxRows: 10,
  args: z.object({ range: rangeArg.optional() }),
  async run({ ctx, db, today }, args) {
    const range = resolveRange(args.range, today);
    const rows = await reports.expenseBreakdown(db, ctx.workspaceId, range.from, range.to);
    const total = rows.reduce((s, r) => s + r.amountKobo, 0);
    return {
      rows: rows.length,
      data: {
        period: rangeInfo(range),
        total: money(total),
        categories: rows.slice(0, 10).map((r) => ({
          category: EXPENSE_CATEGORY_LABELS[r.category as ExpenseCategory] ?? r.category,
          entries: r.count,
          amount: money(r.amountKobo),
        })),
      },
    };
  },
});
