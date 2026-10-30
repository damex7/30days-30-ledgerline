import type { Metadata } from "next";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { getWorkspaceDetails } from "@/lib/services/workspaces";
import { feedbackCounts, thumbsDown } from "@/lib/services/assistant";
import { usageSince } from "@/lib/repos/ai-runs";
import { DATASETS } from "@/lib/services/export";
import { formatMicroUsd } from "@/lib/ai/pricing";
import { providerConfig, providerLabel } from "@/lib/ai/config";
import * as L from "@/lib/ai/limits";
import { formatDateTime, startOfMonth, todayInLagos } from "@/lib/dates";
import { DeleteWorkspaceForm, DetailsForm, PasswordForm } from "./settings-forms";
import { PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Settings" };

async function AiUsage({ workspaceId }: { workspaceId: string }) {
  const ctx = await getContext();
  const [rows, down, counts] = await Promise.all([usageSince(workspaceId, startOfMonth(todayInLagos())), thumbsDown(ctx), feedbackCounts(ctx)]);
  const total = rows.reduce(
    (t, r) => ({ runs: t.runs + r.runs, i: t.i + r.inputTokens, o: t.o + r.outputTokens, c: t.c + r.costMicroUsd }),
    { runs: 0, i: 0, o: 0, c: 0 },
  );
  return (
    <div className="space-y-4">
      <p>
        Provider: <strong>{providerLabel(providerConfig())}</strong>. On the free tier the real cost is ₦0; the estimate below is what the same tokens would
        cost on a paid plan.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt className="text-sm text-ink-2">Runs this month</dt><dd className="font-display text-2xl font-semibold">{total.runs}</dd></div>
        <div><dt className="text-sm text-ink-2">Input tokens</dt><dd className="font-display text-2xl font-semibold tabular-nums">{total.i.toLocaleString("en-NG")}</dd></div>
        <div><dt className="text-sm text-ink-2">Output tokens</dt><dd className="font-display text-2xl font-semibold tabular-nums">{total.o.toLocaleString("en-NG")}</dd></div>
        <div><dt className="text-sm text-ink-2">Est. paid cost</dt><dd className="font-display text-2xl font-semibold tabular-nums">{formatMicroUsd(total.c)}</dd></div>
      </dl>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="stack-table w-full text-sm">
            <caption className="sr-only">Assistant runs this month by kind, outcome and provider</caption>
            <thead className="border-b-2 border-ink text-left">
              <tr>
                <th scope="col" className="py-1 pr-3">Kind</th>
                <th scope="col" className="py-1 pr-3">Outcome</th>
                <th scope="col" className="py-1 pr-3">Provider</th>
                <th scope="col" className="num py-1 pr-3">Runs</th>
                <th scope="col" className="num py-1 pr-3">Avg time</th>
                <th scope="col" className="num py-1">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.status}-${r.provider}`} className="border-b border-line">
                  <td data-label="Kind" className="py-1 pr-3">{r.kind.replace("_", " ")}</td>
                  <td data-label="Outcome" className="py-1 pr-3">{r.status.replace("_", " ")}</td>
                  <td data-label="Provider" className="py-1 pr-3">{r.provider}</td>
                  <td data-label="Runs" className="num py-1 pr-3">{r.runs}</td>
                  <td data-label="Avg time" className="num py-1 pr-3">{r.avgLatencyMs !== null ? `${(r.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</td>
                  <td data-label="Est. cost" className="num py-1">{formatMicroUsd(r.costMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-sm text-ink-2">
        Limits: {L.USER_PER_MINUTE} questions a minute and {L.USER_PER_DAY} a day per person, {L.WORKSPACE_PER_DAY} a day per business, {L.MAX_TOOL_ROUNDS} tool
        rounds and {L.MAX_TOOL_ROWS} rows per tool.
      </p>
      <section aria-labelledby="down">
        <h3 id="down" className="text-lg">
          Feedback: {counts.up} helpful, {counts.down} not helpful
        </h3>
        {down.length === 0 ? (
          <p className="text-ink-2">No thumbs-down yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {down.map((d, i) => (
              <li key={i} className="py-2">
                <p>{d.reason ?? <span className="text-ink-2">No reason given</span>}</p>
                <p className="text-sm text-ink-2">
                  {d.by} · {d.kind.replace("_", " ")} · “{d.question}” · {formatDateTime(d.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function Content() {
  const ctx = await getContext();
  const owner = can(ctx.role, "workspace.edit_details");
  const details = owner ? await getWorkspaceDetails(ctx) : null;
  return (
    <div className="space-y-8">
      {details ? (
        <section aria-labelledby="details" className="card p-4">
          <h2 id="details" className="mb-3 text-2xl">Business details</h2>
          <DetailsForm defaults={details} />
          <p className="mt-3 text-sm text-ink-2">Next invoice number: {details.nextInvoiceNumber}. Numbers never skip or repeat.</p>
        </section>
      ) : null}
      {can(ctx.role, "ai.usage") ? (
        <section aria-labelledby="ai" className="card p-4">
          <h2 id="ai" className="mb-3 text-2xl">Assistant usage and estimated cost</h2>
          <Suspense fallback={<PageSkeleton label="Loading usage" />}>
            <AiUsage workspaceId={ctx.workspaceId} />
          </Suspense>
        </section>
      ) : null}
      {can(ctx.role, "workspace.export") ? (
        <section aria-labelledby="export" className="card p-4">
          <h2 id="export" className="mb-3 text-2xl">Export all data</h2>
          <p className="mb-3 text-ink-2">One CSV file per table. Money columns are in naira with two decimals.</p>
          <ul className="flex flex-wrap gap-2">
            {Object.keys(DATASETS).map((d) => (
              <li key={d}>
                <a href={`/api/export/${d}`} download className="btn btn-secondary">
                  {d.replace("_", " ")}.csv
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="password" className="card p-4">
        <h2 id="password" className="mb-3 text-2xl">Your password</h2>
        {ctx.user.isDemo ? <p className="text-ink-2">Demo accounts don&apos;t have a password to change.</p> : <PasswordForm />}
      </section>
      {can(ctx.role, "workspace.delete") ? (
        <section aria-labelledby="danger" className="rounded-xl border-[3px] border-ink p-4">
          <h2 id="danger" className="mb-3 text-2xl">Delete this workspace</h2>
          <DeleteWorkspaceForm name={ctx.workspace.name} />
        </section>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Suspense fallback={<PageSkeleton label="Loading settings" />}>
        <Content />
      </Suspense>
    </>
  );
}
