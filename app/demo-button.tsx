import Link from "next/link";

// Replaced in stage 5 by the real "open a sandbox" form.
export function DemoButton() {
  return (
    <Link href="/sign-in" className="btn btn-primary">
      Try the demo
    </Link>
  );
}
