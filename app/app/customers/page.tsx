import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { listCustomers } from "@/lib/services/customers";
import { decodeNameCursor } from "@/lib/cursor";
import { formatNaira } from "@/lib/money";
import { one } from "@/lib/page";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { Pager } from "@/components/app/pager";
import { SearchIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Customers" };

async function Content({ searchParams }: { searchParams: PageProps<"/app/customers">["searchParams"] }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const q = one(sp.q)?.trim().slice(0, 80) || undefined;
  const cursor = one(sp.cursor);
  const archived = one(sp.archived) === "1";
  const { customers, nextCursor } = await listCustomers(ctx, { q, after: decodeNameCursor(cursor), archived });

  return (
    <>
      <form role="search" className="mb-4 flex max-w-xl gap-2" action="/app/customers">
        <label htmlFor="q" className="sr-only">
          Search customers
        </label>
        <input id="q" name="q" defaultValue={q} placeholder="Search by name or phone" className="field" />
        {archived ? <input type="hidden" name="archived" value="1" /> : null}
        <button type="submit" className="btn btn-dark">
          <SearchIcon />
          Search
        </button>
      </form>
      <p className="mb-4 text-sm">
        {archived ? <Link href="/app/customers">Show active customers</Link> : <Link href="/app/customers?archived=1">Show archived customers</Link>}
      </p>
      {customers.length === 0 ? (
        <EmptyState title={q ? `No customers match “${q}”` : "No customers yet"} action={<Link href="/app/customers/new" className="btn btn-primary">Add a customer</Link>}>
          {q ? "Similar spellings are matched too; try fewer letters." : "Customers appear here once you add them or create an invoice."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="stack-table w-full">
            <caption className="sr-only">Customers, alphabetical, with the balance each one owes</caption>
            <thead className="border-b-2 border-ink text-left">
              <tr>
                <th scope="col" className="py-2 pr-3">Name</th>
                <th scope="col" className="py-2 pr-3">Phone</th>
                <th scope="col" className="py-2 pr-3">Tags</th>
                <th scope="col" className="num py-2">Owes you</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-line">
                  <th scope="row" data-label="Name" className="py-2 pr-3 text-left font-normal">
                    <Link href={`/app/customers/${c.id}`} className="font-semibold">
                      {c.name}
                    </Link>
                  </th>
                  <td data-label="Phone" className="py-2 pr-3">{c.phone ?? "—"}</td>
                  <td data-label="Tags" className="py-2 pr-3 text-ink-2">{c.tags.length ? c.tags.join(", ") : "—"}</td>
                  <td data-label="Owes you" className="num py-2 font-semibold">{c.balanceKobo > 0 ? formatNaira(c.balanceKobo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager basePath="/app/customers" params={{ q, archived: archived ? "1" : undefined }} nextCursor={nextCursor} hasPrevious={Boolean(cursor)} />
    </>
  );
}

export default function CustomersPage(props: PageProps<"/app/customers">) {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Balances are computed from invoices and payments."
        actions={<Link href="/app/customers/new" className="btn btn-primary">Add customer</Link>}
      />
      <Suspense fallback={<PageSkeleton label="Loading customers" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
