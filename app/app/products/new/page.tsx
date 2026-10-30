import type { Metadata } from "next";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { getWorkspaceDetails } from "@/lib/services/workspaces";
import { ProductForm } from "../product-forms";
import { ForbiddenNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Add product" };

async function Content() {
  const ctx = await getContext();
  if (!can(ctx.role, "product.manage")) return <ForbiddenNotice what="to add products" />;
  const details = await getWorkspaceDetails(ctx);
  return <ProductForm workspaceLowStock={details.lowStockDefault} />;
}

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="Add a product" />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}
