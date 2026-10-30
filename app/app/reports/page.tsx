import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { report } from "@/lib/services/reports";
import { can } from "@/lib/permissions";
import { formatNaira } from "@/lib/money";
import { RANGE_PRESETS } from "@/lib/dates";
import { rangeFromParams } from "@/lib/validation/reports";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/validation/business";
import { ValidationError } from "@/lib/errors";
import { ErrorNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { BarChart } from "@/components/charts/bar-chart";
import { SalesLineChart } from "@/components/charts/line-chart";

export const metadata: Metadata = { title: "Reports" };

const PRESET_LABEL: Record<(typeof RANGE_PRESETS)[number], string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
};

async function Content({ searchParams }: { searchParams: PageProps<"/app/reports">["searchParams"] }) {
  const ctx = await getContext();
  const range = rangeFromParams(await searchParams);
  let r: Awaited<ReturnType<typeof report>>;
  try {
    r = await report(ctx, range);
  } catch (error) {
    if (error instanceof ValidationError) return <ErrorNotice title={error.message}>Pick a shorter range or swap the dates.</ErrorNotice>;
    throw error;
  }
  const s = r.summary;

  return (
    <>
      <nav aria-label="Quick ranges" className="mb-3 flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p) => (
          <Link key={p} href={`/app/reports?preset=${p}`} className="btn btn-secondary min-h-9 px-3 py-1 text-sm">
            {PRESET_LABEL[p]}
          </Link>
        ))}
      </nav>
      <form action="/app/reports" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="font-semibold">From</label>
          <input id="from" name="from" type="date" defaultValue={range.from} className="field" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="font-semibold">To</label>
          <input id="to" name="to" type="date" defaultValue={range.to} className="field" required />
        </div>
        <button type="submit" className="btn btn-dark">Show report</button>
        {can(ctx.role, "report.export") ? (
          <a href={`/api/reports/csv?from=${range.from}&to=${range.to}`} className="btn btn-secondary" download>
            Download invoices (CSV)
          </a>
        ) : null}
      </form>

      <h2 className="mb-3 text-2xl">{range.label}</h2>
      <div className="overflow-x-auto">
        <table className="w-full max-w-xl">
          <caption className="sr-only">Summary for {range.label}</caption>
          <tbody>
            <tr className="border-b border-line">
              <th scope="row" className="py-2 text-left font-normal">Sales ({s.invoiceCount} invoices sent)</th>
              <td className="num py-2 font-semibold">{formatNaira(s.salesKobo)}</td>
            </tr>
            <tr className="border-b border-line">
              <th scope="row" className="py-2 text-left font-normal">Payments received</th>
              <td className="num py-2 font-semibold">{formatNaira(s.paymentsKobo)}</td>
            </tr>
            {s.costOfGoodsKobo !== null ? (
              <tr className="border-b border-line">
                <th scope="row" className="py-2 text-left font-normal">Cost of goods sold</th>
                <td className="num py-2">−{formatNaira(s.costOfGoodsKobo)}</td>
              </tr>
            ) : null}
            {s.expensesKobo !== null ? (
              <tr className="border-b border-line">
                <th scope="row" className="py-2 text-left font-normal">Expenses</th>
                <td className="num py-2">−{formatNaira(s.expensesKobo)}</td>
              </tr>
            ) : null}
            {s.estimatedProfitKobo !== null ? (
              <tr className="border-t-2 border-ink">
                <th scope="row" className="py-2 text-left">Estimated profit</th>
                <td className="num py-2 font-bold">{formatNaira(s.estimatedProfitKobo)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!r.showProfit ? <p className="mt-2 text-sm text-ink-2">Profit and expenses are visible to managers and owners.</p> : null}

      {r.days.length ? (
        <section className="card mt-6 p-4" aria-labelledby="daily">
          <h2 id="daily" className="mb-3 text-xl">Day by day</h2>
          <SalesLineChart title={`Sales and payments per day, ${range.label}`} days={r.days} />
        </section>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="tp">
          <h2 id="tp" className="mb-3 text-xl">Top products</h2>
          <BarChart
            title={`Top products by sales, ${range.label}`}
            data={r.topProducts.map((t) => ({
              label: t.name,
              valueKobo: t.salesKobo,
              note: `${t.quantity} ${t.unit}${t.profitKobo !== null ? ` · margin ${formatNaira(t.profitKobo)}` : ""}`,
            }))}
            valueHeader="Sales"
          />
        </section>
        <section className="card p-4" aria-labelledby="tc">
          <h2 id="tc" className="mb-3 text-xl">Top customers</h2>
          <BarChart
            title={`Top customers by sales, ${range.label}`}
            data={r.topCustomers.map((t) => ({ label: t.name, valueKobo: t.salesKobo, note: `${t.invoiceCount} invoices` }))}
            valueHeader="Sales"
          />
        </section>
        {r.showProfit ? (
          <section className="card p-4 lg:col-span-2" aria-labelledby="eb">
            <h2 id="eb" className="mb-3 text-xl">Expenses by category</h2>
            <BarChart
              title={`Expenses by category, ${range.label}`}
              data={r.expenseBreakdown.map((e) => ({
                label: EXPENSE_CATEGORY_LABELS[e.category as ExpenseCategory] ?? e.category,
                valueKobo: e.amountKobo,
                note: `${e.count} entries`,
              }))}
            />
          </section>
        ) : null}
      </div>
    </>
  );
}

export default function ReportsPage(props: PageProps<"/app/reports">) {
  return (
    <>
      <PageHeader title="Reports" description="Every figure is computed in the database from your records." />
      <Suspense fallback={<PageSkeleton label="Loading report" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
