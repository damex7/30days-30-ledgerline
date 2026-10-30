import Link from "next/link";

/** "Next page" for keyset pagination; keeps the other filters in the URL. */
export function Pager({
  basePath,
  params,
  nextCursor,
  hasPrevious,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  nextCursor: string | null;
  hasPrevious: boolean;
}) {
  if (!nextCursor && !hasPrevious) return null;
  const query = (cursor: string | null) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "cursor") sp.set(k, v);
    if (cursor) sp.set("cursor", cursor);
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap gap-3">
      {hasPrevious ? (
        <Link href={query(null)} className="btn btn-secondary">
          Back to the first page
        </Link>
      ) : null}
      {nextCursor ? (
        <Link href={query(nextCursor)} className="btn btn-secondary">
          Next page
        </Link>
      ) : null}
    </nav>
  );
}
