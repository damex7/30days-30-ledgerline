import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { listInvoices } from "@/lib/services/invoices";
import { customerOptions } from "@/lib/services/customers";
import { decodeDateCursor } from "@/lib/cursor";
import { invoiceFiltersSchema } from "@/lib/validation/business";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { InvoiceTable } from "@/components/app/invoice-table";
import { Pager } from "@/components/app/pager";

export const metadata: Metadata = { title: "Invoices" };

const STATUS_OPTIONS = [
  ["", "Any status"],
  ["open", "Open (sent or partly paid)"],
  ["overdue", "Overdue"],
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["partly_paid", "Partly paid"],
  ["paid", "Paid"],
  ["void", "Void"],
] as const;

async function Content({ searchParams }: { searchParams: PageProps<"/app/invoices">["searchParams"] }) {
  const ctx = await getContext();
  // Filters live in the URL (shareable, back-button friendly) and are
  // validated like any other input: a bad value is ignored, not trusted.
  const raw = await searchParams;
  const filters = invoiceFiltersSchema.parse({
    status: typeof raw.status === "string" && raw.status ? raw.status : undefined,
    customer: typeof raw.customer === "string" && raw.customer ? raw.customer : undefined,
    from: typeof raw.from === "string" && raw.from ? raw.from : undefined,
    to: typeof raw.to === "string" && raw.to ? raw.to : undefined,
    cursor: typeof raw.cursor === "string" ? raw.cursor : undefined,
  });
  const [{ invoices, nextCursor }, customers] = await Promise.all([
    listInvoices(ctx, {
      status: filters.status,
      customerId: filters.customer,
      from: filters.from,
      to: filters.to,
      after: decodeDateCursor(filters.cursor),
    }),
    customerOptions(ctx),
  ]);
  const filtered = Boolean(filters.status || filters.customer || filters.from || filters.to);

  return (
    <>
      <form className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" action="/app/invoices">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="font-semibold">Status</label>
          <select id="status" name="status" defaultValue={filters.status ?? ""} className="field">
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="customer" className="font-semibold">Customer</label>
          <select id="customer" name="customer" defaultValue={filters.customer ?? ""} className="field">
            <option value="">Any customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="font-semibold">Issued from</label>
          <input id="from" name="from" type="date" defaultValue={filters.from} className="field" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="font-semibold">Issued to</label>
          <input id="to" name="to" type="date" defaultValue={filters.to} className="field" />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-dark">Filter</button>
          {filtered ? <Link href="/app/invoices" className="btn btn-ghost">Clear</Link> : null}
        </div>
      </form>
      {invoices.length === 0 ? (
        <EmptyState
          title={filtered ? "No invoices match these filters" : "No invoices yet"}
          action={<Link href="/app/invoices/new" className="btn btn-primary">New invoice</Link>}
        />
      ) : (
        <InvoiceTable invoices={invoices} caption="Invoices, newest first" />
      )}
      <Pager
        basePath="/app/invoices"
        params={{ status: filters.status, customer: filters.customer, from: filters.from, to: filters.to }}
        nextCursor={nextCursor}
        hasPrevious={Boolean(filters.cursor)}
      />
    </>
  );
}

export default function InvoicesPage(props: PageProps<"/app/invoices">) {
  return (
    <>
      <PageHeader title="Invoices" actions={<Link href="/app/invoices/new" className="btn btn-primary">New invoice</Link>} />
      <Suspense fallback={<PageSkeleton label="Loading invoices" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
