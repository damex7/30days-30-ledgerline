import type { Metadata } from "next";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { customerOptions } from "@/lib/services/customers";
import { productOptions } from "@/lib/services/products";
import { addDays, todayInLagos } from "@/lib/dates";
import { one } from "@/lib/page";
import { InvoiceForm } from "../invoice-form";
import { EmptyState, ForbiddenNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import Link from "next/link";

export const metadata: Metadata = { title: "New invoice" };

async function Content({ searchParams }: { searchParams: PageProps<"/app/invoices/new">["searchParams"] }) {
  const ctx = await getContext();
  if (!can(ctx.role, "invoice.create")) return <ForbiddenNotice what="to create invoices" />;
  const sp = await searchParams;
  const [customers, products] = await Promise.all([customerOptions(ctx), productOptions(ctx)]);
  if (customers.length === 0) {
    return (
      <EmptyState title="Add a customer first" action={<Link href="/app/customers/new" className="btn btn-primary">Add a customer</Link>}>
        Every invoice belongs to a customer, so their balance stays right.
      </EmptyState>
    );
  }
  const today = todayInLagos();
  const customerId = one(sp.customer);
  return (
    <InvoiceForm
      customers={customers}
      products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, priceKobo: p.priceKobo, stockQuantity: p.stockQuantity }))}
      defaults={{ issueDate: today, dueDate: addDays(today, 7), customerId: customers.some((c) => c.id === customerId) ? customerId : undefined }}
      // Idempotency key for this form: a double tap or retry sends it again
      // and gets the same invoice back instead of a second one.
      requestId={randomUUID()}
    />
  );
}

export default function NewInvoicePage(props: PageProps<"/app/invoices/new">) {
  return (
    <>
      <PageHeader title="New invoice" description="Numbers are assigned in order when you save: no gaps, no repeats." />
      <Suspense fallback={<PageSkeleton label="Loading the invoice form" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
