import type { Metadata } from "next";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { getInvoice } from "@/lib/services/invoices";
import { customerOptions } from "@/lib/services/customers";
import { productOptions } from "@/lib/services/products";
import { koboToInput } from "@/lib/money";
import { idOr404, or404 } from "@/lib/page";
import { InvoiceForm } from "../../invoice-form";
import { ErrorNotice, ForbiddenNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Edit draft" };

async function Content({ params }: { params: PageProps<"/app/invoices/[id]/edit">["params"] }) {
  const ctx = await getContext();
  const invoice = await or404(getInvoice(ctx, idOr404((await params).id)));
  const allowed = can(ctx.role, "invoice.edit_any") || (can(ctx.role, "invoice.edit_own") && invoice.createdBy === ctx.userId);
  if (!allowed) return <ForbiddenNotice what="to edit this invoice" />;
  if (invoice.status !== "draft") {
    return <ErrorNotice title="Only drafts can be edited">A sent invoice can only be voided, so its history stays honest.</ErrorNotice>;
  }
  const [customers, products] = await Promise.all([customerOptions(ctx), productOptions(ctx)]);
  return (
    <>
      <PageHeader title={`Edit ${invoice.label}`} description="Draft: not yet sent, so no stock has moved." />
      <InvoiceForm
        customers={customers}
        products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, priceKobo: p.priceKobo, stockQuantity: p.stockQuantity }))}
        requestId={randomUUID()}
        defaults={{
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          discount: invoice.discountKobo ? koboToInput(invoice.discountKobo) : "",
          deliveryFee: invoice.deliveryFeeKobo ? koboToInput(invoice.deliveryFeeKobo) : "",
          notes: invoice.notes ?? "",
          lines: invoice.items.map((it) => ({
            key: it.id,
            productId: it.productId ?? "",
            description: it.description,
            quantity: String(it.quantity),
            unitPrice: koboToInput(it.unitPriceKobo),
          })),
        }}
      />
    </>
  );
}

export default function EditInvoicePage(props: PageProps<"/app/invoices/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}
