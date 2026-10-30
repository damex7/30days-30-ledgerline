import Link from "next/link";
import { Wordmark } from "@/components/ui/mark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line px-4 py-3">
        <Link href="/" className="text-ink no-underline" aria-label="Ledgerline home">
          <Wordmark />
        </Link>
      </header>
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        {children}
      </main>
    </div>
  );
}
