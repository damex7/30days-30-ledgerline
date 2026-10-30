import type { Metadata } from "next";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { CustomerForm } from "../customer-form";
import { ForbiddenNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Add customer" };

async function Content() {
  const ctx = await getContext();
  if (!can(ctx.role, "customer.create")) return <ForbiddenNotice />;
  return <CustomerForm />;
}

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader title="Add a customer" />
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}
