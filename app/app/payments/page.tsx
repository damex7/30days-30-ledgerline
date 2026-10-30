import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { listPayments } from "@/lib/services/payments";
import { decodeTimeCursor } from "@/lib/cursor";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { one } from "@/lib/page";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/business";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { Pager } from "@/components/app/pager";

export const metadata: Metadata = { title: "Payments" };

async function Content({ searchParams }: { searchParams: PageProps<"/app/payments">["searchParams"] }) {
  const ctx = await getContext();
  const cursor = one((await searchParams).cursor);
  const { payments, nextCursor } = await listPayments(ctx, decodeTimeCursor(cursor));
  if (payments.length === 0) {
    return <EmptyState title="No payments yet">Payments are recorded from an invoice page.</EmptyState>;
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="stack-table w-full">
          <caption className="sr-only">Payments received, newest first. Reversals are negative lines.</caption>
          <thead className="border-b-2 border-ink text-left">
            <tr>
              <th scope="col" className="py-2 pr-3">When</th>
              <th scope="col" className="py-2 pr-3">Invoice</th>
              <th scope="col" className="py-2 pr-3">Customer</th>
              <th scope="col" className="py-2 pr-3">Method</th>
              <th scope="col" className="py-2 pr-3">Recorded by</th>
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
                <td data-label="Customer" className="py-2 pr-3">{p.customerName}</td>
                <td data-label="Method" className="py-2 pr-3">
                  <span className={p.reversedBy ? "line-through" : undefined}>{PAYMENT_METHOD_LABELS[p.method]}</span>
                  {p.reversesPaymentId ? " · reversal" : p.reversedBy ? " · reversed" : ""}
                </td>
                <td data-label="Recorded by" className="py-2 pr-3 text-ink-2">{p.createdByName ?? "Former member"}</td>
                <td data-label="Amount" className="num py-2 font-semibold">{formatNaira(p.amountKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager basePath="/app/payments" params={{}} nextCursor={nextCursor} hasPrevious={Boolean(cursor)} />
    </>
  );
}

export default function PaymentsPage(props: PageProps<"/app/payments">) {
  return (
    <>
      <PageHeader title="Payments" description="Append-only: a mistake is fixed with a reversal line, never by deleting." />
      <Suspense fallback={<PageSkeleton label="Loading payments" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
