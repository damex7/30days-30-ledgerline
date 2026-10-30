import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { getContext } from "@/lib/context";
import { getInvoice } from "@/lib/services/invoices";
import { paymentsForInvoice } from "@/lib/services/payments";
import { getWorkspaceDetails } from "@/lib/services/workspaces";
import { can } from "@/lib/permissions";
import { formatNaira } from "@/lib/money";
import { formatDate, formatDateTime, todayInLagos } from "@/lib/dates";
import { idOr404, one, or404 } from "@/lib/page";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/business";
import { PaymentForm, PrintButton, ReverseForm, SendForm, VoidForm } from "./invoice-actions";
import { InfoNotice, PageSkeleton } from "@/components/ui/notice";
import { InvoiceStatusBadge } from "@/components/ui/status";
import { whatsappLink } from "@/components/app/whatsapp";
import { Mark } from "@/components/ui/mark";

export const metadata: Metadata = { title: "Invoice" };

const NOTICES: Record<string, string> = {
  saved: "Draft saved. No stock has moved yet.",
  sent: "Invoice sent: the items are now out of stock.",
  voided: "Invoice voided. Any stock it took is back.",
  paid: "Payment recorded.",
  reversed: "Payment reversed. The balance is back up.",
};

async function Content({ params, searchParams }: PageProps<"/app/invoices/[id]">) {
  const ctx = await getContext();
  const id = idOr404((await params).id);
  const notice = NOTICES[one((await searchParams).notice) ?? ""];
  // Someone else's invoice id (edited URL) -> the same 404 as a made-up one.
  const invoice = await or404(getInvoice(ctx, id));
  const [payments, business] = await Promise.all([paymentsForInvoice(ctx, id), getWorkspaceDetails(ctx)]);
  const today = todayInLagos();
  const open = invoice.status === "sent" || invoice.status === "partly_paid";
  const isOwn = invoice.createdBy === ctx.userId;
  const canEditDraft = invoice.status === "draft" && (can(ctx.role, "invoice.edit_any") || (can(ctx.role, "invoice.edit_own") && isOwn));

  const message = [
    `Hello ${invoice.customer.name},`,
    `here is invoice ${invoice.label} from ${business.name}.`,
    ...invoice.items.map((it) => `• ${it.quantity} × ${it.description}: ${formatNaira(it.lineTotalKobo)}`),
    invoice.discountKobo ? `Discount: −${formatNaira(invoice.discountKobo)}` : null,
    invoice.deliveryFeeKobo ? `Delivery: ${formatNaira(invoice.deliveryFeeKobo)}` : null,
    `Total: ${formatNaira(invoice.totalKobo)}`,
    invoice.amountPaidKobo ? `Paid so far: ${formatNaira(invoice.amountPaidKobo)}` : null,
    open ? `Balance: ${formatNaira(invoice.balanceKobo)}, due ${formatDate(invoice.dueDate)}.` : null,
    business.bankDetails ? `Pay to: ${business.bankDetails}` : null,
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      {notice ? (
        <div className="no-print mb-4">
          <InfoNotice>{notice}</InfoNotice>
        </div>
      ) : null}
      <div className="no-print mb-6 flex flex-wrap items-center gap-2">
        <Link href="/app/invoices" className="btn btn-ghost">
          ← All invoices
        </Link>
        <PrintButton />
        {invoice.status !== "void" ? (
          <a href={whatsappLink(invoice.customer.whatsapp ?? invoice.customer.phone, message)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
            Share on WhatsApp<span className="sr-only"> (opens WhatsApp with the message typed; you press send)</span>
          </a>
        ) : null}
        {canEditDraft ? (
          <Link href={`/app/invoices/${id}/edit`} className="btn btn-secondary">
            Edit draft
          </Link>
        ) : null}
        {canEditDraft ? <SendForm invoiceId={id} /> : null}
        {invoice.status !== "void" && can(ctx.role, "invoice.void") && invoice.amountPaidKobo === 0 ? (
          <VoidForm invoiceId={id} hasStock={invoice.status !== "draft" && invoice.items.some((i) => i.productId)} />
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The print view: plain, black on white, nothing interactive. */}
        <article className="rounded-xl border border-line bg-page p-5 print:border-0 print:p-0 sm:p-8" aria-labelledby="invoice-title">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
            <div>
              <p className="flex items-center gap-2 font-display text-2xl font-semibold">
                <Mark /> {business.name}
              </p>
              <address className="mt-1 whitespace-pre-line text-sm not-italic text-ink-2">
                {[business.businessAddress, business.businessPhone, business.businessEmail].filter(Boolean).join("\n")}
              </address>
            </div>
            <div className="text-right">
              <h1 id="invoice-title" className="text-3xl">
                {invoice.label}
              </h1>
              <div className="mt-1">
                <InvoiceStatusBadge status={invoice.displayStatus} />
              </div>
            </div>
          </header>
          <dl className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
            <dt className="font-semibold">Bill to</dt>
            <dd>
              <Link href={`/app/customers/${invoice.customerId}`} className="print:text-ink print:no-underline">
                {invoice.customer.name}
              </Link>
            </dd>
            <dt className="font-semibold">Issued</dt>
            <dd>{formatDate(invoice.issueDate)}</dd>
            <dt className="font-semibold">Phone</dt>
            <dd>{invoice.customer.phone ?? "—"}</dd>
            <dt className="font-semibold">Due</dt>
            <dd>{formatDate(invoice.dueDate)}</dd>
          </dl>

          <table className="mt-6 w-full text-sm">
            <caption className="sr-only">Items on {invoice.label}</caption>
            <thead>
              <tr className="bg-night text-left text-night-ink print:bg-black print:text-white">
                <th scope="col" className="px-2 py-2">Item</th>
                <th scope="col" className="num px-2 py-2">Qty</th>
                <th scope="col" className="num px-2 py-2">Unit price</th>
                <th scope="col" className="num px-2 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id} className="border-b border-line">
                  <td className="px-2 py-2">{it.description}</td>
                  <td className="num px-2 py-2">{it.quantity}</td>
                  <td className="num px-2 py-2">{formatNaira(it.unitPriceKobo)}</td>
                  <td className="num px-2 py-2">{formatNaira(it.lineTotalKobo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3} className="px-2 pt-3 text-right font-normal">Subtotal</th>
                <td className="num px-2 pt-3">{formatNaira(invoice.subtotalKobo)}</td>
              </tr>
              {invoice.discountKobo ? (
                <tr>
                  <th scope="row" colSpan={3} className="px-2 text-right font-normal">Discount</th>
                  <td className="num px-2">−{formatNaira(invoice.discountKobo)}</td>
                </tr>
              ) : null}
              {invoice.deliveryFeeKobo ? (
                <tr>
                  <th scope="row" colSpan={3} className="px-2 text-right font-normal">Delivery</th>
                  <td className="num px-2">{formatNaira(invoice.deliveryFeeKobo)}</td>
                </tr>
              ) : null}
              <tr className="text-base font-bold">
                <th scope="row" colSpan={3} className="border-t-2 border-ink px-2 pt-2 text-right">Total</th>
                <td className="num border-t-2 border-ink px-2 pt-2">{formatNaira(invoice.totalKobo)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} className="px-2 text-right font-normal">Paid</th>
                <td className="num px-2">{formatNaira(invoice.amountPaidKobo)}</td>
              </tr>
              <tr className="font-bold">
                <th scope="row" colSpan={3} className="px-2 text-right">Balance due</th>
                <td className="num px-2">{formatNaira(invoice.balanceKobo)}</td>
              </tr>
            </tfoot>
          </table>
          {invoice.notes ? <p className="mt-6 whitespace-pre-line text-sm">{invoice.notes}</p> : null}
          {business.bankDetails ? (
            <p className="mt-4 text-sm">
              <strong>Pay to:</strong> {business.bankDetails}
            </p>
          ) : null}
          {invoice.status === "void" ? (
            <p className="mt-4 border-[3px] border-double border-ink p-2 font-bold">
              VOID{invoice.voidReason ? `: ${invoice.voidReason}` : ""}
            </p>
          ) : null}
        </article>

        <aside className="no-print space-y-6">
          {open && can(ctx.role, "payment.record") ? (
            <section className="card p-4" aria-labelledby="pay">
              <h2 id="pay" className="mb-3 text-xl">
                Record a payment
              </h2>
              <PaymentForm invoiceId={id} balanceKobo={invoice.balanceKobo} today={today} requestId={randomUUID()} />
            </section>
          ) : null}
          <section className="card p-4" aria-labelledby="history">
            <h2 id="history" className="mb-3 text-xl">
              Payments
            </h2>
            {payments.length === 0 ? (
              <p className="text-ink-2">No payments yet.</p>
            ) : (
              <ul className="space-y-3">
                {payments.map((p) => (
                  <li key={p.id} className="border-b border-line pb-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={p.reversedBy ? "line-through" : undefined}>
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reversesPaymentId ? " · reversal" : ""}
                      </span>
                      <span className="num font-semibold">{formatNaira(p.amountKobo)}</span>
                    </div>
                    <p className="text-sm text-ink-2">
                      {formatDateTime(p.paidAt)} · {p.createdByName ?? "Former member"}
                      {p.reversedBy ? " · reversed" : ""}
                    </p>
                    {p.note ? <p className="text-sm text-ink-2">{p.note}</p> : null}
                    {p.amountKobo > 0 && !p.reversedBy && invoice.status !== "void" && can(ctx.role, "payment.reverse") ? (
                      <ReverseForm paymentId={p.id} invoiceId={id} requestId={randomUUID()} label={formatNaira(p.amountKobo)} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-sm text-ink-2">
            Created by {invoice.createdByName ?? "a former member"}
            {invoice.sentAt ? ` · sent ${formatDateTime(invoice.sentAt)}` : ""}
          </p>
        </aside>
      </div>
    </>
  );
}

export default function InvoicePage(props: PageProps<"/app/invoices/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading invoice" />}>
      <Content {...props} />
    </Suspense>
  );
}
