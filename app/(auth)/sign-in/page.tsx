import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "../auth-forms";
import { InfoNotice, PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  created: "If this email is new, your account is ready. Sign in to continue.",
  "signed-out": "You're signed out.",
  expired: "Your session ended. Please sign in again.",
};

async function Content({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  const email = typeof sp.email === "string" ? sp.email.slice(0, 254) : undefined;
  const next = typeof sp.next === "string" ? sp.next.slice(0, 300) : undefined;
  return (
    <div className="space-y-6">
      {notice ? <InfoNotice>{notice}</InfoNotice> : null}
      <SignInForm email={email} next={next} />
    </div>
  );
}

export default function SignInPage(props: PageProps<"/sign-in">) {
  return (
    <>
      <h1 className="mb-6 text-4xl">Sign in</h1>
      <Suspense fallback={<PageSkeleton label="Loading sign-in" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
