import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { getCustomer } from "@/lib/services/customers";
import { listInvoices } from "@/lib/services/invoices";
import { paymentsForCustomer } from "@/lib/services/payments";
import { can } from "@/lib/permissions";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { idOr404, one, or404 } from "@/lib/page";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/business";
import { archiveCustomerAction } from "../actions";
import { InvoiceTable } from "@/components/app/invoice-table";
import { whatsappLink } from "@/components/app/whatsapp";
import { EmptyState, InfoNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Customer" };

const NOTICES: Record<string, string> = { saved: "Saved.", archived: "Customer archived.", restored: "Customer restored." };

async function Content({ params, searchParams }: PageProps<"/app/customers/[id]">) {
  const ctx = await getContext();
  const id = idOr404((await params).id);
  const notice = NOTICES[one((await searchParams).notice) ?? ""];
  const customer = await or404(getCustomer(ctx, id));
  const [{ invoices }, payments] = await Promise.all([listInvoices(ctx, { customerId: id }), paymentsForCustomer(ctx, id)]);
  const canEdit = can(ctx.role, "customer.edit_any") || (can(ctx.role, "customer.edit_own") && customer.createdBy === ctx.userId);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={customer.archivedAt ? "Archived customer" : customer.tags.length ? customer.tags.join(" · ") : undefined}
        actions={
          <>
            {canEdit ? (
              <Link href={`/app/customers/${id}/edit`} className="btn btn-secondary">
                Edit
              </Link>
            ) : null}
            {!customer.archivedAt ? (
              <Link href={`/app/invoices/new?customer=${id}`} className="btn btn-primary">
                New invoice
              </Link>
            ) : null}
          </>
        }
      />
      {notice ? (
        <div className="mb-4">
          <InfoNotice>{notice}</InfoNotice>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card p-4 md:col-span-1" aria-labelledby="owes">
          <h2 id="owes" className="text-lg">
            Owes you
          </h2>
          <p className="num mt-1 text-left font-display text-3xl font-semibold">{formatNaira(customer.balanceKobo)}</p>
          <p className="text-sm text-ink-2">Sum of what&apos;s left on sent and partly paid invoices.</p>
        </section>
        <section className="card p-4 md:col-span-2" aria-labelledby="contact">
          <h2 id="contact" className="text-lg">
            Contact
          </h2>
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold">Phone</dt>
            <dd>{customer.phone ? <a href={`tel:${customer.phone.replace(/\s/g, "")}`}>{customer.phone}</a> : "—"}</dd>
            <dt className="font-semibold">WhatsApp</dt>
            <dd>
              {customer.whatsapp ? (
                <a href={whatsappLink(customer.whatsapp, `Hello ${customer.name},`)} target="_blank" rel="noopener noreferrer">
                  {customer.whatsapp} (opens WhatsApp)
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt className="font-semibold">Email</dt>
            <dd className="break-all">{customer.email ?? "—"}</dd>
            <dt className="font-semibold">Notes</dt>
            <dd className="whitespace-pre-line">{customer.notes ?? "—"}</dd>
          </dl>
        </section>
      </div>

      <section className="mt-8" aria-labelledby="invoices">
        <h2 id="invoices" className="mb-3 text-2xl">
          Invoices
        </h2>
        {invoices.length ? (
          <InvoiceTable invoices={invoices} caption={`Invoices for ${customer.name}`} showCustomer={false} />
        ) : (
          <EmptyState title="No invoices yet" />
        )}
      </section>

      <section className="mt-8" aria-labelledby="payments">
        <h2 id="payments" className="mb-3 text-2xl">
          Payment history
        </h2>
        {payments.length ? (
          <div className="overflow-x-auto">
            <table className="stack-table w-full">
              <caption className="sr-only">Payments from {customer.name}, newest first</caption>
              <thead className="border-b-2 border-ink text-left">
                <tr>
                  <th scope="col" className="py-2 pr-3">When</th>
                  <th scope="col" className="py-2 pr-3">Invoice</th>
                  <th scope="col" className="py-2 pr-3">Method</th>
                  <th scope="col" className="num py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-line">
                    <td data-label="When" className="py-2 pr-3">{formatDateTime(p.paidAt)}</td>
                    <td data-label="Invoice" className="py-2 pr-3">
                      <Link href={`/app/invoices/${p.invoiceId}`}>{p.invoiceLabel}</Link>
                    </td>
                    <td data-label="Method" className="py-2 pr-3">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reversesPaymentId ? " · reversal" : p.reversedBy ? " · reversed" : ""}
                    </td>
                    <td data-label="Amount" className="num py-2">{formatNaira(p.amountKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No payments yet" />
        )}
      </section>

      {can(ctx.role, "customer.archive") ? (
        <form action={archiveCustomerAction} className="mt-10 border-t border-line pt-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="archived" value={customer.archivedAt ? "false" : "true"} />
          <p className="mb-2 text-sm text-ink-2">
            Customers with invoices are never deleted, so their history stays complete. Archiving hides them from pickers.
          </p>
          <button type="submit" className="btn btn-secondary">
            {customer.archivedAt ? "Restore customer" : "Archive customer"}
          </button>
        </form>
      ) : null}
    </>
  );
}

export default function CustomerPage(props: PageProps<"/app/customers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading customer" />}>
      <Content {...props} />
    </Suspense>
  );
}
