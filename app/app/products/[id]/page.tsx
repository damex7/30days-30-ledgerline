import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { getProduct, getStockLedger } from "@/lib/services/products";
import { getWorkspaceDetails } from "@/lib/services/workspaces";
import { can } from "@/lib/permissions";
import { formatNaira } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { decodeTimeCursor } from "@/lib/cursor";
import { invoiceLabel } from "@/lib/invoice-math";
import { idOr404, one, or404 } from "@/lib/page";
import { archiveProductAction } from "../actions";
import { ProductForm, StockAdjustForm } from "../product-forms";
import { EmptyState, InfoNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { StockBadge } from "@/components/ui/status";
import { Pager } from "@/components/app/pager";

export const metadata: Metadata = { title: "Product" };

const NOTICES: Record<string, string> = {
  saved: "Saved.",
  stock: "Stock change recorded in the ledger.",
  archived: "Product archived.",
  restored: "Product restored.",
};
const REASON_LABEL = { sale: "Sale", restock: "Restock", adjustment: "Adjustment", return: "Return" } as const;

async function Content({ params, searchParams }: PageProps<"/app/products/[id]">) {
  const ctx = await getContext();
  const id = idOr404((await params).id);
  const sp = await searchParams;
  const notice = NOTICES[one(sp.notice) ?? ""];
  const cursor = one(sp.cursor);
  const product = await or404(getProduct(ctx, id));
  const [{ movements, nextCursor }, details] = await Promise.all([getStockLedger(ctx, id, decodeTimeCursor(cursor)), getWorkspaceDetails(ctx)]);
  const manage = can(ctx.role, "product.manage");

  return (
    <>
      <PageHeader title={product.name} description={`${product.sku} · sold per ${product.unit}${product.archivedAt ? " · archived" : ""}`} />
      {notice ? (
        <div className="mb-4">
          <InfoNotice>{notice}</InfoNotice>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm font-semibold text-ink-2">In stock</p>
          <p className="mt-1 font-display text-3xl font-semibold">
            {product.stockQuantity.toLocaleString("en-NG")} <span className="font-sans text-base">{product.unit}</span>
          </p>
          <div className="mt-2">
            <StockBadge level={product.level} quantity={product.stockQuantity} unit={product.unit} />
          </div>
          <p className="mt-2 text-sm text-ink-2">Low at {product.effectiveLowStock} or fewer.</p>
        </div>
        <div className="card p-4">
          <p className="text-sm font-semibold text-ink-2">Selling price</p>
          <p className="mt-1 font-display text-3xl font-semibold">{formatNaira(product.priceKobo)}</p>
        </div>
        {can(ctx.role, "report.profit") ? (
          <div className="card p-4">
            <p className="text-sm font-semibold text-ink-2">Cost price</p>
            <p className="mt-1 font-display text-3xl font-semibold">{formatNaira(product.costKobo)}</p>
            <p className="mt-1 text-sm text-ink-2">Margin {formatNaira(product.priceKobo - product.costKobo)} per {product.unit}</p>
          </div>
        ) : null}
      </div>

      <section className="mt-8" aria-labelledby="ledger">
        <h2 id="ledger" className="mb-1 text-2xl">
          Stock ledger
        </h2>
        <p className="mb-3 text-ink-2">Every change, newest first. The stock count is always the sum of these lines.</p>
        {movements.length === 0 ? (
          <EmptyState title="No stock movements yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="stack-table w-full">
              <caption className="sr-only">Stock movements for {product.name}, newest first</caption>
              <thead className="border-b-2 border-ink text-left">
                <tr>
                  <th scope="col" className="py-2 pr-3">When</th>
                  <th scope="col" className="py-2 pr-3">Reason</th>
                  <th scope="col" className="py-2 pr-3">Details</th>
                  <th scope="col" className="py-2 pr-3">By</th>
                  <th scope="col" className="num py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-line">
                    <td data-label="When" className="py-2 pr-3">{formatDateTime(m.createdAt)}</td>
                    <td data-label="Reason" className="py-2 pr-3">{REASON_LABEL[m.reason]}</td>
                    <td data-label="Details" className="py-2 pr-3">
                      {m.invoiceId && m.invoiceNumber ? (
                        <Link href={`/app/invoices/${m.invoiceId}`}>{invoiceLabel(details.invoicePrefix, m.invoiceNumber)}</Link>
                      ) : null}
                      {m.note ? <span className="text-ink-2"> {m.note}</span> : null}
                    </td>
                    <td data-label="By" className="py-2 pr-3 text-ink-2">{m.createdByName ?? "Former member"}</td>
                    <td data-label="Change" className="num py-2 font-semibold">
                      {m.quantityDelta > 0 ? `+${m.quantityDelta}` : `−${Math.abs(m.quantityDelta)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager basePath={`/app/products/${id}`} params={{}} nextCursor={nextCursor} hasPrevious={Boolean(cursor)} />
      </section>

      {manage && !product.archivedAt ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="card p-4" aria-labelledby="adjust">
            <h2 id="adjust" className="mb-3 text-xl">
              Restock or adjust
            </h2>
            <StockAdjustForm productId={id} unit={product.unit} />
          </section>
          <section className="card p-4" aria-labelledby="edit">
            <h2 id="edit" className="mb-3 text-xl">
              Edit product
            </h2>
            <p className="mb-3 text-sm text-ink-2">Changing the price affects new invoices only; past invoices keep the price they were sold at.</p>
            <ProductForm defaults={product} workspaceLowStock={details.lowStockDefault} />
          </section>
        </div>
      ) : null}
      {manage ? (
        <form action={archiveProductAction} className="mt-8 border-t border-line pt-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="archived" value={product.archivedAt ? "false" : "true"} />
          <button type="submit" className="btn btn-secondary">
            {product.archivedAt ? "Restore product" : "Archive product"}
          </button>
        </form>
      ) : null}
    </>
  );
}

export default function ProductPage(props: PageProps<"/app/products/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading product" />}>
      <Content {...props} />
    </Suspense>
  );
}
