import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { acceptInvitation, previewInvitation } from "@/lib/services/team";
import { ROLE_LABELS } from "@/lib/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { Wordmark } from "@/components/ui/mark";
import { ErrorNotice, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Accept invitation", robots: { index: false } };

async function acceptAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const user = await getSession();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/accept-invite/${token}`)}`);
  try {
    await acceptInvitation(user, token);
  } catch (error) {
    if (error instanceof NotFoundError) redirect(`/accept-invite/${token}`);
    if (error instanceof ForbiddenError) redirect(`/accept-invite/${token}?wrong=1`);
    throw error;
  }
  redirect("/app");
}

async function Content({ params, searchParams }: PageProps<"/accept-invite/[token]">) {
  const { token } = await params;
  const invite = await previewInvitation(token);
  // Unknown, revoked, used or expired: a plain 404 that says nothing more.
  if (!invite) notFound();
  const user = await getSession();
  const wrong = (await searchParams).wrong === "1" || (user && user.email !== invite.email);
  const next = encodeURIComponent(`/accept-invite/${token}`);
  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Join {invite.workspaceName}</h1>
      <p className="text-ink-2">
        You&apos;ve been invited as <strong className="text-ink">{ROLE_LABELS[invite.role]}</strong>. This invitation is for{" "}
        <strong className="break-all text-ink">{invite.email}</strong>.
      </p>
      {!user ? (
        <div className="flex flex-wrap gap-3">
          <Link href={`/sign-in?next=${next}&email=${encodeURIComponent(invite.email)}`} className="btn btn-primary">
            Sign in to accept
          </Link>
          <Link href={`/sign-up?next=${next}`} className="btn btn-secondary">
            Create an account
          </Link>
        </div>
      ) : wrong ? (
        <ErrorNotice title="You're signed in with a different email">
          You&apos;re signed in as {user.email}. Sign out and sign in as {invite.email} to accept.
        </ErrorNotice>
      ) : (
        <form action={acceptAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary">
            Accept and open {invite.workspaceName}
          </button>
        </form>
      )}
    </div>
  );
}

export default function AcceptInvitePage(props: PageProps<"/accept-invite/[token]">) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line px-4 py-3">
        <Wordmark />
      </header>
      <main id="main" className="mx-auto max-w-lg px-4 py-10">
        <Suspense fallback={<PageSkeleton />}>
          <Content {...props} />
        </Suspense>
      </main>
    </div>
  );
}
