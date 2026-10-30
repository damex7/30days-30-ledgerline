import { InfoNotice } from "@/components/ui/notice";

const NOTICES: Record<string, string> = {
  "demo-limit": "You've opened several demo sandboxes already. Please try again in an hour, or sign in.",
  "demo-error": "We couldn't set up a demo sandbox just now. Please try again in a moment.",
};

export async function LandingNotice({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const notice = (await searchParams).notice;
  const text = typeof notice === "string" ? NOTICES[notice] : undefined;
  return text ? <div className="mt-4"><InfoNotice>{text}</InfoNotice></div> : null;
}
