import Link from "next/link";
import { Wordmark } from "@/components/ui/mark";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-lg space-y-4 px-4 py-16">
      <Wordmark />
      <h1 className="text-4xl">Page not found</h1>
      <p className="text-ink-2">That link doesn&apos;t lead anywhere, or the thing it pointed to is no longer available.</p>
      <Link href="/" className="btn btn-primary">
        Go to the home page
      </Link>
    </main>
  );
}
