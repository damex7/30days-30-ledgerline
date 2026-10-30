import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { todayInLagos, formatDateTime } from "@/lib/dates";
import { one } from "@/lib/page";
import { history } from "@/lib/repos/ai-runs";
import { overdueInvoices } from "@/lib/repos/reports";
import { listProposals } from "@/lib/services/assistant";
import { providerConfig, providerLabel } from "@/lib/ai/config";
import { MAX_DRAFT_CHARS, MAX_QUESTION_CHARS, USER_PER_DAY } from "@/lib/ai/limits";
import { peek } from "@/lib/rate-limit";
import { AskPanel, type Exchange } from "./ask-panel";
import { DraftInvoiceForm, ReminderForm, SummaryPanel } from "./tools-panels";
import { InfoNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { ProposalBadge } from "@/components/ui/status";
import { SparkIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Ask Ledgerline" };

async function Content({ searchParams }: { searchParams: PageProps<"/app/assistant">["searchParams"] }) {
  const ctx = await getContext();
  const notice = one((await searchParams).notice);
  const [past, proposals, overdue, usedToday] = await Promise.all([
    history(ctx.workspaceId, ctx.userId, 8),
    listProposals(ctx, 6),
    overdueInvoices(db, ctx.workspaceId, todayInLagos(), 20),
    peek(`ai:user:${ctx.userId}:day`, 86_400),
  ]);
  const config = providerConfig();
  const initial: Exchange[] = past.map((h) => ({
    key: h.runId,
    runId: h.runId,
    question: h.question,
    answer: h.answer,
    tools: h.toolsUsed.map((t) => ({ name: t, label: t.replace(/_/g, " "), outcome: "ok" })),
    status: "done",
    runStatus: h.status,
    unverified: h.unverified,
    fellBack: h.provider === "mock" && config.name === "gemini",
    rating: h.myRating,
  }));

  return (
    <div className="space-y-8">
      <InfoNotice title="Before you rely on an answer">
        <p>
          The assistant reads only this business&apos;s records, through a few read-only tools, and can be wrong. Check anything that affects money before you
          act on it. {config.name === "gemini" ? "It uses a free AI tier: providers may use free-tier prompts to improve their products, so don't type private details you wouldn't share." : null}
        </p>
        <p className="mt-1 inline-flex items-center gap-1.5">
          <SparkIcon className="h-4 w-4" /> Active: <strong>{providerLabel(config)}</strong> · {usedToday}/{USER_PER_DAY} questions used today
        </p>
      </InfoNotice>
      {notice === "rejected" ? <InfoNotice>Proposal rejected. Nothing was created.</InfoNotice> : null}

      <section aria-labelledby="ask">
        <h2 id="ask" className="sr-only">
          Ask a question
        </h2>
        <AskPanel initial={initial} maxChars={MAX_QUESTION_CHARS} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {can(ctx.role, "invoice.create") ? (
          <section aria-labelledby="draft" className="card p-4">
            <h2 id="draft" className="mb-1 text-xl">
              Draft an invoice from text
            </h2>
            <p className="mb-3 text-sm text-ink-2">The AI proposes; you check, edit and approve. Totals are always computed by Ledgerline.</p>
            <DraftInvoiceForm requestId={randomUUID()} maxChars={MAX_DRAFT_CHARS} />
          </section>
        ) : null}
        <section aria-labelledby="proposals" className="card p-4">
          <h2 id="proposals" className="mb-3 text-xl">
            Proposals
          </h2>
          {proposals.length === 0 ? (
            <p className="text-ink-2">No proposals yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {proposals.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <Link href={`/app/assistant/proposals/${p.id}`} className="font-semibold">
                      Invoice for {p.payload.customer.selected?.name ?? `“${p.payload.customer.query}”`}
                    </Link>
                    <span className="block text-sm text-ink-2">
                      {p.payload.lines.length} item(s) · {formatDateTime(p.createdAt)}
                    </span>
                  </span>
                  <ProposalBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="remind" className="card p-4">
          <h2 id="remind" className="mb-1 text-xl">
            Payment reminders
          </h2>
          <p className="mb-3 text-sm text-ink-2">Drafts a message you copy or open in WhatsApp. Nothing is sent automatically.</p>
          <ReminderForm invoices={overdue.map((o) => ({ id: o.id, label: `${o.label} · ${o.customerName} · ${o.daysOverdue} days late` }))} firstRequestId={randomUUID()} />
        </section>
        <section aria-labelledby="summary" className="card p-4">
          <h2 id="summary" className="mb-1 text-xl">
            Weekly summary
          </h2>
          <p className="mb-3 text-sm text-ink-2">Ledgerline computes the numbers; the assistant only puts them into words, and shows the numbers it used.</p>
          <SummaryPanel firstRequestId={randomUUID()} />
        </section>
      </div>
    </div>
  );
}

export default function AssistantPage(props: PageProps<"/app/assistant">) {
  return (
    <>
      <PageHeader title="Ask Ledgerline" description="Answers come only from your own records, computed by the database." />
      <Suspense fallback={<PageSkeleton label="Loading the assistant" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
