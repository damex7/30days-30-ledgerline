import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/context";
import { listMyWorkspaces } from "@/lib/services/workspaces";
import { ROLE_LABELS } from "@/lib/permissions";
import { switchWorkspaceAction } from "./actions";
import { CreateWorkspaceForm } from "./create-form";
import { Wordmark } from "@/components/ui/mark";
import { InfoNotice, PageSkeleton } from "@/components/ui/notice";
import { signOutAction } from "@/app/(auth)/actions";

export const metadata: Metadata = { title: "Your workspaces" };

const NOTICES: Record<string, string> = {
  removed: "You're no longer a member of that workspace. Choose another one.",
  "not-found": "That workspace wasn't found.",
  deleted: "The workspace and all its data were deleted.",
};

async function Content({ searchParams }: { searchParams: PageProps<"/workspaces">["searchParams"] }) {
  const user = await requireUser();
  const [workspaces, sp] = await Promise.all([listMyWorkspaces(user.userId), searchParams]);
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  return (
    <div className="space-y-8">
      <p className="text-ink-2">
        Signed in as <strong className="text-ink">{user.email}</strong>
      </p>
      {notice ? <InfoNotice>{notice}</InfoNotice> : null}
      <section aria-labelledby="mine">
        <h2 id="mine" className="mb-3 text-2xl">
          Choose a workspace
        </h2>
        {workspaces.length === 0 ? (
          <p className="text-ink-2">You aren&apos;t in any workspace yet. Create one below, or open the invitation link you were sent.</p>
        ) : (
          <ul className="space-y-3">
            {workspaces.map((w) => (
              <li key={w.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-display text-xl font-semibold">
                    {w.name}
                    {w.isDemo ? <span className="ml-2 font-sans text-sm font-normal text-ink-2">(demo)</span> : null}
                  </p>
                  <p className="text-sm text-ink-2">
                    {ROLE_LABELS[w.role]} · {w.members} {w.members === 1 ? "member" : "members"}
                    {user.activeWorkspaceId === w.id ? " · current" : ""}
                  </p>
                </div>
                <form action={switchWorkspaceAction}>
                  <input type="hidden" name="workspaceId" value={w.id} />
                  <button type="submit" className="btn btn-primary">
                    Open <span className="sr-only">{w.name}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="new" className="card p-5">
        <h2 id="new" className="mb-3 text-2xl">
          Create a business workspace
        </h2>
        <CreateWorkspaceForm />
      </section>
    </div>
  );
}

export default function WorkspacesPage(props: PageProps<"/workspaces">) {
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <Link href="/" className="text-ink no-underline" aria-label="Ledgerline home">
          <Wordmark />
        </Link>
        <form action={signOutAction}>
          <button className="btn btn-ghost" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-4 text-4xl">Your workspaces</h1>
        <Suspense fallback={<PageSkeleton label="Loading workspaces" />}>
          <Content searchParams={props.searchParams} />
        </Suspense>
      </main>
    </div>
  );
}
