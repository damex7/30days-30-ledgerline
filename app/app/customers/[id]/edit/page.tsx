import type { Metadata } from "next";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { getCustomer } from "@/lib/services/customers";
import { can } from "@/lib/permissions";
import { idOr404, or404 } from "@/lib/page";
import { CustomerForm } from "../../customer-form";
import { ForbiddenNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Edit customer" };

async function Content({ params }: { params: PageProps<"/app/customers/[id]/edit">["params"] }) {
  const ctx = await getContext();
  const customer = await or404(getCustomer(ctx, idOr404((await params).id)));
  const canEdit = can(ctx.role, "customer.edit_any") || (can(ctx.role, "customer.edit_own") && customer.createdBy === ctx.userId);
  if (!canEdit) return <ForbiddenNotice what="to edit this customer" />;
  return (
    <>
      <PageHeader title={`Edit ${customer.name}`} />
      <CustomerForm defaults={customer} />
    </>
  );
}

export default function EditCustomerPage(props: PageProps<"/app/customers/[id]/edit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}
