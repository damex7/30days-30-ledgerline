import type { Metadata } from "next";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { getContext } from "@/lib/context";
import { listExpenses } from "@/lib/services/expenses";
import { can } from "@/lib/permissions";
import { decodeDateCursor } from "@/lib/cursor";
import { formatNaira } from "@/lib/money";
import { formatDate, todayInLagos } from "@/lib/dates";
import { one } from "@/lib/page";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/validation/business";
import { deleteExpenseAction } from "./actions";
import { ExpenseForm } from "./expense-form";
import { EmptyState, InfoNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { Pager } from "@/components/app/pager";

export const metadata: Metadata = { title: "Expenses" };

const NOTICES: Record<string, string> = { saved: "Expense recorded.", updated: "Expense updated.", deleted: "Expense deleted." };

async function Content({ searchParams }: { searchParams: PageProps<"/app/expenses">["searchParams"] }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const cursor = one(sp.cursor);
  const notice = NOTICES[one(sp.notice) ?? ""];
  const { expenses, nextCursor } = await listExpenses(ctx, decodeDateCursor(cursor));
  const seeAll = can(ctx.role, "expense.view_all");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="list">
        <h2 id="list" className="sr-only">
          Recorded expenses
        </h2>
        {notice ? (
          <div className="mb-4">
            <InfoNotice>{notice}</InfoNotice>
          </div>
        ) : null}
        {!seeAll ? <p className="mb-3 text-ink-2">You see the expenses you recorded.</p> : null}
        {expenses.length === 0 ? (
          <EmptyState title="No expenses yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="stack-table w-full">
              <caption className="sr-only">Expenses, newest first</caption>
              <thead className="border-b-2 border-ink text-left">
                <tr>
                  <th scope="col" className="py-2 pr-3">Date</th>
                  <th scope="col" className="py-2 pr-3">Category</th>
                  <th scope="col" className="py-2 pr-3">Note</th>
                  <th scope="col" className="num py-2 pr-3">Amount</th>
                  {can(ctx.role, "expense.edit_any") ? <th scope="col" className="py-2"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-line">
                    <td data-label="Date" className="py-2 pr-3 whitespace-nowrap">{formatDate(e.spentOn)}</td>
                    <td data-label="Category" className="py-2 pr-3">{EXPENSE_CATEGORY_LABELS[e.category]}</td>
                    <td data-label="Note" className="py-2 pr-3 text-ink-2">
                      {e.note ?? "—"}
                      {e.receiptRef ? ` · receipt: ${e.receiptRef}` : ""}
                      {seeAll && e.createdByName ? ` · ${e.createdByName}` : ""}
                    </td>
                    <td data-label="Amount" className="num py-2 pr-3 font-semibold">{formatNaira(e.amountKobo)}</td>
                    {can(ctx.role, "expense.edit_any") ? (
                      <td data-label="Actions" className="py-2">
                        <form action={deleteExpenseAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <button type="submit" className="btn btn-ghost min-h-9 px-2 py-1 text-sm underline">
                            Delete<span className="sr-only"> expense of {formatNaira(e.amountKobo)} on {formatDate(e.spentOn)}</span>
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager basePath="/app/expenses" params={{}} nextCursor={nextCursor} hasPrevious={Boolean(cursor)} />
      </section>
      <section className="card self-start p-4" aria-labelledby="new">
        <h2 id="new" className="mb-3 text-xl">
          Record an expense
        </h2>
        <ExpenseForm today={todayInLagos()} requestId={randomUUID()} />
      </section>
    </div>
  );
}

export default function ExpensesPage(props: PageProps<"/app/expenses">) {
  return (
    <>
      <PageHeader title="Expenses" />
      <Suspense fallback={<PageSkeleton label="Loading expenses" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
