import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { listProducts } from "@/lib/services/products";
import { can } from "@/lib/permissions";
import { decodeNameCursor } from "@/lib/cursor";
import { formatNaira } from "@/lib/money";
import { one } from "@/lib/page";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { StockBadge } from "@/components/ui/status";
import { Pager } from "@/components/app/pager";
import { SearchIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Products & stock" };

const FILTERS = [
  { key: undefined, label: "All" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
] as const;

async function Content({ searchParams }: { searchParams: PageProps<"/app/products">["searchParams"] }) {
  const ctx = await getContext();
  const sp = await searchParams;
  const q = one(sp.q)?.trim().slice(0, 80) || undefined;
  const levelParam = one(sp.level);
  const level = levelParam === "low" || levelParam === "out" ? levelParam : undefined;
  const cursor = one(sp.cursor);
  const { products, nextCursor } = await listProducts(ctx, { q, level, after: decodeNameCursor(cursor) });

  return (
    <>
      {can(ctx.role, "product.manage") ? (
        <div className="mb-4">
          <Link href="/app/products/new" className="btn btn-primary">
            Add product
          </Link>
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form role="search" className="flex min-w-0 flex-1 gap-2" action="/app/products">
          <label htmlFor="q" className="sr-only">
            Search products
          </label>
          <input id="q" name="q" defaultValue={q} placeholder="Search by name or SKU" className="field" />
          {level ? <input type="hidden" name="level" value={level} /> : null}
          <button type="submit" className="btn btn-dark">
            <SearchIcon />
            Search
          </button>
        </form>
        <nav aria-label="Stock filter" className="flex gap-2">
          {FILTERS.map((f) => {
            const current = f.key === level;
            const href = f.key ? `/app/products?level=${f.key}` : "/app/products";
            return (
              <Link
                key={f.label}
                href={href}
                aria-current={current ? "true" : undefined}
                className={`btn ${current ? "btn-dark" : "btn-secondary"} min-h-9 px-3 py-1 text-sm`}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {products.length === 0 ? (
        <EmptyState title={q || level ? "Nothing matches" : "No products yet"}>
          {q || level ? "Try another search or filter." : "Add the things you sell; stock changes are tracked line by line."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="stack-table w-full">
            <caption className="sr-only">Products with price and stock level</caption>
            <thead className="border-b-2 border-ink text-left">
              <tr>
                <th scope="col" className="py-2 pr-3">Product</th>
                <th scope="col" className="py-2 pr-3">SKU</th>
                <th scope="col" className="py-2 pr-3">Stock</th>
                <th scope="col" className="num py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <th scope="row" data-label="Product" className="py-2 pr-3 text-left font-normal">
                    <Link href={`/app/products/${p.id}`} className="font-semibold">
                      {p.name}
                    </Link>
                  </th>
                  <td data-label="SKU" className="py-2 pr-3 text-ink-2">{p.sku}</td>
                  <td data-label="Stock" className="py-2 pr-3">
                    <StockBadge level={p.level} quantity={p.stockQuantity} unit={p.unit} />
                  </td>
                  <td data-label="Price" className="num py-2">
                    {formatNaira(p.priceKobo)} <span className="text-ink-2">/ {p.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager basePath="/app/products" params={{ q, level }} nextCursor={nextCursor} hasPrevious={Boolean(cursor)} />
    </>
  );
}

export default function ProductsPage(props: PageProps<"/app/products">) {
  return (
    <>
      <PageHeader title="Products & stock" description="Every stock change is a line in the product's ledger." />
      <Suspense fallback={<PageSkeleton label="Loading products" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
