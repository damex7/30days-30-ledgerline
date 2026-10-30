import type { Metadata } from "next";
import { Suspense } from "react";
import { SignUpForm } from "../auth-forms";
import { PageSkeleton } from "@/components/ui/notice";

export const metadata: Metadata = { title: "Create an account" };

async function Content({ searchParams }: { searchParams: PageProps<"/sign-up">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next.slice(0, 300) : undefined;
  return <SignUpForm next={next} />;
}

export default function SignUpPage(props: PageProps<"/sign-up">) {
  return (
    <>
      <h1 className="mb-2 text-4xl">Create an account</h1>
      <p className="mb-6 text-ink-2">One account can belong to several businesses. You&apos;ll create or join one next.</p>
      <Suspense fallback={<PageSkeleton label="Loading sign-up" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
