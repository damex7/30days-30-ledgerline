import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { listAuditEvents } from "@/lib/services/audit-log";
import { decodeTimeCursor } from "@/lib/cursor";
import { formatDateTime } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { one } from "@/lib/page";
import { EmptyState, ForbiddenNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { Pager } from "@/components/app/pager";

export const metadata: Metadata = { title: "Audit log" };

const AREAS = ["invoice", "payment", "stock", "product", "customer", "expense", "member", "ai_proposal", "workspace"] as const;

const LINKS: Record<string, string> = { invoice: "/app/invoices/", customer: "/app/customers/", product: "/app/products/" };

function describe(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => (k.endsWith("Kobo") && typeof v === "number" ? `${k.replace(/Kobo$/, "")}: ${formatNaira(v)}` : `${k}: ${String(v)}`))
    .join(" · ");
}

async function Content({ searchParams }: { searchParams: PageProps<"/app/audit">["searchParams"] }) {
  const ctx = await getContext();
  if (!can(ctx.role, "audit.view")) return <ForbiddenNotice what="the audit log" />;
  const sp = await searchParams;
  const cursor = one(sp.cursor);
  const areaParam = one(sp.area);
  const area = AREAS.find((a) => a === areaParam);
  const { events, nextCursor } = await listAuditEvents(ctx, decodeTimeCursor(cursor), area);
  return (
    <>
      <nav aria-label="Filter by area" className="mb-4 flex flex-wrap gap-2">
        <Link href="/app/audit" aria-current={!area ? "true" : undefined} className={`btn ${!area ? "btn-dark" : "btn-secondary"} min-h-9 px-3 py-1 text-sm`}>
          All
        </Link>
        {AREAS.map((a) => (
          <Link key={a} href={`/app/audit?area=${a}`} aria-current={area === a ? "true" : undefined} className={`btn ${area === a ? "btn-dark" : "btn-secondary"} min-h-9 px-3 py-1 text-sm`}>
            {a.replace("_", " ")}
          </Link>
        ))}
      </nav>
      {events.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="stack-table w-full">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead className="border-b-2 border-ink text-left">
              <tr>
                <th scope="col" className="py-2 pr-3">When</th>
                <th scope="col" className="py-2 pr-3">Who</th>
                <th scope="col" className="py-2 pr-3">What</th>
                <th scope="col" className="py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const href = e.entityId && LINKS[e.entityType] ? `${LINKS[e.entityType]}${e.entityId}` : null;
                return (
                  <tr key={e.id} className="border-b border-line">
                    <td data-label="When" className="py-2 pr-3 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                    <td data-label="Who" className="py-2 pr-3">{e.actorName ?? "Former member"}</td>
                    <td data-label="What" className="py-2 pr-3">
                      {href ? <Link href={href}>{e.action}</Link> : e.action}
                    </td>
                    <td data-label="Details" className="py-2 text-sm text-ink-2">{describe(e.details) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager basePath="/app/audit" params={{ area }} nextCursor={nextCursor} hasPrevious={Boolean(cursor)} />
    </>
  );
}

export default function AuditPage(props: PageProps<"/app/audit">) {
  return (
    <>
      <PageHeader title="Audit log" description="Who did what, and when. Sensitive values are never recorded here." />
      <Suspense fallback={<PageSkeleton label="Loading audit log" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
