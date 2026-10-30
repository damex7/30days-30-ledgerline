import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { dashboard } from "@/lib/services/reports";
import { formatNaira } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { StockBadge } from "@/components/ui/status";
import { ClockIcon } from "@/components/ui/icons";
import { BarChart } from "@/components/charts/bar-chart";
import { SalesLineChart } from "@/components/charts/line-chart";
import { DailyJobs } from "./daily-jobs";

export const metadata: Metadata = { title: "Dashboard" };

const PERIOD_LABEL = { today: "Today", this_week: "This week", this_month: "This month" } as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="whitespace-nowrap font-display text-xl font-semibold tabular-nums xl:text-2xl">{value}</dd>
      {hint ? <dd className="text-xs text-ink-2">{hint}</dd> : null}
    </div>
  );
}

async function Content() {
  const ctx = await getContext();
  const d = await dashboard(ctx);
  return (
    <>
      <PageHeader
        title={ctx.workspace.name}
        description={`Today is ${formatDate(d.today)}. Every number here is computed from your invoices, payments and expenses.`}
        actions={
          <>
            <Link href="/app/invoices/new" className="btn btn-primary">
              New sale
            </Link>
            <Link href="/app/assistant" className="btn btn-secondary">
              Ask Ledgerline
            </Link>
          </>
        }
      />

      <section aria-labelledby="periods" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <h2 id="periods" className="sr-only">
          Today, this week and this month
        </h2>
        {d.periods.map((p) => (
          <article key={p.key} className="card p-4 sm:last:col-span-2 xl:last:col-span-1" aria-labelledby={`p-${p.key}`}>
            <h3 id={`p-${p.key}`} className="mb-3 border-b border-line pb-2 text-lg">
              {PERIOD_LABEL[p.key]}
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="Sales" value={formatNaira(p.summary.salesKobo, { showKobo: false })} hint={`${p.summary.invoiceCount} invoices`} />
              <Stat label="Payments in" value={formatNaira(p.summary.paymentsKobo, { showKobo: false })} />
              {p.summary.expensesKobo !== null ? <Stat label="Expenses" value={formatNaira(p.summary.expensesKobo, { showKobo: false })} /> : null}
              {p.summary.estimatedProfitKobo !== null ? (
                <Stat label="Est. profit" value={formatNaira(p.summary.estimatedProfitKobo, { showKobo: false })} hint="Sales − cost of goods − expenses" />
              ) : null}
            </dl>
          </article>
        ))}
      </section>

      <section aria-labelledby="owed" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 id="owed" className="text-lg">
            Money owed to you
          </h2>
          <p className="mt-1 font-display text-4xl font-semibold tabular-nums">{formatNaira(d.owed.owedKobo)}</p>
          <p className="text-ink-2">
            on {d.owed.openCount} open invoices ·{" "}
            <Link href="/app/invoices?status=open">see them</Link>
          </p>
        </div>
        <div className="card border-[4px] border-double border-ink p-4">
          <h2 className="flex items-center gap-2 text-lg">
            <ClockIcon /> Overdue
          </h2>
          <p className="mt-1 font-display text-4xl font-semibold tabular-nums">{formatNaira(d.owed.overdueKobo)}</p>
          <p className="text-ink-2">
            {d.owed.overdueCount} invoices past their due date · <Link href="/app/invoices?status=overdue">see them</Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="trend" className="card mt-6 p-4">
        <h2 id="trend" className="mb-3 text-xl">
          Last 30 days
        </h2>
        <SalesLineChart title="Sales and payments received per day, last 30 days" days={d.days} />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="overdue-list" className="card p-4">
          <h2 id="overdue-list" className="mb-3 text-xl">
            Oldest overdue invoices
          </h2>
          {d.overdue.length === 0 ? (
            <p className="text-ink-2">Nothing overdue. Well done.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.overdue.map((o) => (
                <li key={o.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/app/invoices/${o.id}`} className="font-semibold">
                      {o.label}
                    </Link>{" "}
                    {o.customerName}
                    <span className="block text-sm text-ink-2">
                      {o.daysOverdue} {o.daysOverdue === 1 ? "day" : "days"} late
                    </span>
                  </span>
                  <span className="num font-semibold">{formatNaira(o.balanceKobo)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="low" className="card p-4">
          <h2 id="low" className="mb-3 text-xl">
            Almost finished
          </h2>
          {d.lowStock.length === 0 ? (
            <p className="text-ink-2">Every product is above its low-stock level.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.lowStock.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/app/products/${p.id}`}>{p.name}</Link>
                  <StockBadge level={p.stockQuantity === 0 ? "out" : "low"} quantity={p.stockQuantity} unit={p.unit} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="top-products" className="card p-4">
          <h2 id="top-products" className="mb-3 text-xl">
            Top products this month
          </h2>
          {d.topProducts.length ? (
            <BarChart
              title="Top products by sales this month"
              data={d.topProducts.map((t) => ({ label: t.name, valueKobo: t.salesKobo, note: `${t.quantity} ${t.unit}` }))}
              valueHeader="Sales"
            />
          ) : (
            <EmptyState title="No sales yet this month" />
          )}
        </section>
        <section aria-labelledby="top-customers" className="card p-4">
          <h2 id="top-customers" className="mb-3 text-xl">
            Top customers this month
          </h2>
          {d.topCustomers.length ? (
            <BarChart
              title="Top customers by sales this month"
              data={d.topCustomers.map((t) => ({ label: t.name, valueKobo: t.salesKobo, note: `${t.invoiceCount} invoices` }))}
              valueHeader="Sales"
            />
          ) : (
            <EmptyState title="No sales yet this month" />
          )}
        </section>
      </div>
      <Suspense fallback={null}>
        <DailyJobs />
      </Suspense>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading dashboard" />}>
      <Content />
    </Suspense>
  );
}
