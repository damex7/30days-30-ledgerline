import Link from "next/link";

// Records from another workspace end up here too: "not found", never
// "forbidden", so nobody learns that the id exists somewhere else.
export default function NotFound() {
  return (
    <div className="card space-y-3 border-dashed p-6">
      <h1 className="text-3xl">Not found</h1>
      <p className="text-ink-2">We couldn&apos;t find that in this workspace. It may have been archived, or the link may be wrong.</p>
      <Link href="/app" className="btn btn-primary">
        Back to the dashboard
      </Link>
    </div>
  );
}
