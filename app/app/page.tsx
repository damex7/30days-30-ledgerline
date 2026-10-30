import type { Metadata } from "next";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Dashboard" };

async function Content() {
  const ctx = await getContext();
  return <PageHeader title="Dashboard" description={`Welcome to ${ctx.workspace.name}.`} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading dashboard" />}>
      <Content />
    </Suspense>
  );
}
