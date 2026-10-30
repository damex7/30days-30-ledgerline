import type { Metadata } from "next";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { listInvitations, listMembers } from "@/lib/services/team";
import { formatDate, formatDateTime } from "@/lib/dates";
import { one } from "@/lib/page";
import { revokeInviteAction } from "./actions";
import { InviteForm, RemoveForm, RoleForm } from "./team-forms";
import { ForbiddenNotice, InfoNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Team" };

const NOTICES: Record<string, string> = { role: "Role changed.", removed: "Member removed.", revoked: "Invitation revoked: the link no longer works." };

async function Content({ searchParams }: { searchParams: PageProps<"/app/team">["searchParams"] }) {
  const ctx = await getContext();
  if (!can(ctx.role, "team.manage")) return <ForbiddenNotice what="to manage the team" />;
  const notice = NOTICES[one((await searchParams).notice) ?? ""];
  const [members, invites] = await Promise.all([listMembers(ctx), listInvitations(ctx)]);
  return (
    <div className="space-y-8">
      {notice ? <InfoNotice>{notice}</InfoNotice> : null}
      <section aria-labelledby="members">
        <h2 id="members" className="mb-3 text-2xl">Members</h2>
        <div className="overflow-x-auto">
          <table className="stack-table w-full">
            <caption className="sr-only">Members of {ctx.workspace.name} and their roles</caption>
            <thead className="border-b-2 border-ink text-left">
              <tr>
                <th scope="col" className="py-2 pr-3">Name</th>
                <th scope="col" className="py-2 pr-3">Role</th>
                <th scope="col" className="py-2 pr-3">Joined</th>
                <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b border-line align-top">
                  <th scope="row" data-label="Name" className="py-2 pr-3 text-left font-normal">
                    <span className="font-semibold">{m.name}</span>
                    {m.userId === ctx.userId ? " (you)" : ""}
                    <span className="block break-all text-sm text-ink-2">{m.email}</span>
                  </th>
                  <td data-label="Role" className="py-2 pr-3">
                    <span className="sr-only">{ROLE_LABELS[m.role]}. </span>
                    <RoleForm userId={m.userId} role={m.role} name={m.name} />
                  </td>
                  <td data-label="Joined" className="py-2 pr-3">{formatDateTime(m.joinedAt)}</td>
                  <td data-label="Actions" className="py-2">
                    <RemoveForm userId={m.userId} name={m.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-ink-2">A business always keeps at least one owner: the last owner can&apos;t be removed or demoted.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="invite" className="card p-4">
          <h2 id="invite" className="mb-3 text-xl">Invite someone</h2>
          <InviteForm />
        </section>
        <section aria-labelledby="pending" className="card p-4">
          <h2 id="pending" className="mb-3 text-xl">Pending invitations</h2>
          {invites.length === 0 ? (
            <p className="text-ink-2">None.</p>
          ) : (
            <ul className="divide-y divide-line">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 break-all">
                    {i.email} · {ROLE_LABELS[i.role]}
                    <span className="block text-sm text-ink-2">
                      {i.status === "expired" ? "Expired" : `Expires ${formatDate(i.expiresAt.toISOString().slice(0, 10))}`}
                    </span>
                  </span>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <button type="submit" className="btn btn-ghost min-h-9 py-1 underline">
                      Revoke<span className="sr-only"> invitation for {i.email}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default function TeamPage(props: PageProps<"/app/team">) {
  return (
    <>
      <PageHeader title="Team" description="Who can use this business, and what each person may do." />
      <Suspense fallback={<PageSkeleton label="Loading team" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
