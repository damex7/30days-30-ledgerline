import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/permissions";
import { BottomNav, NavLinks, type NavItem } from "./nav";
import { Mark } from "@/components/ui/mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Skeleton } from "@/components/ui/notice";
import { signOutAction } from "@/app/(auth)/actions";

// The app shell. Everything that depends on who is signed in (workspace
// name, role, which links to show) streams in behind Suspense, so the frame
// paints immediately. Hidden links are a convenience only; every page and
// service checks permissions again.

async function navItems(): Promise<NavItem[]> {
  const ctx = await getContext();
  const items: NavItem[] = [
    { href: "/app", label: "Dashboard" },
    { href: "/app/invoices", label: "Invoices" },
    { href: "/app/customers", label: "Customers" },
    { href: "/app/products", label: "Products & stock" },
    { href: "/app/payments", label: "Payments" },
    { href: "/app/expenses", label: "Expenses" },
    { href: "/app/reports", label: "Reports" },
    { href: "/app/assistant", label: "Ask Ledgerline" },
  ];
  if (can(ctx.role, "team.manage")) items.push({ href: "/app/team", label: "Team" });
  if (can(ctx.role, "audit.view")) items.push({ href: "/app/audit", label: "Audit log" });
  if (can(ctx.role, "workspace.edit_details")) items.push({ href: "/app/settings", label: "Settings" });
  else items.push({ href: "/app/settings", label: "My account" });
  return items;
}

async function Sidebar() {
  const ctx = await getContext();
  const items = await navItems();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/app" className="flex items-center gap-2 font-display text-xl font-semibold text-night-ink no-underline">
        <Mark className="text-night-ink" />
        Ledgerline
      </Link>
      <div className="rounded-lg border border-night-line p-3">
        <p className="text-xs uppercase tracking-wider text-night-ink/80">Workspace</p>
        <p className="font-semibold text-night-ink">{ctx.workspace.name}</p>
        <p className="text-sm text-night-ink/80">
          {ROLE_LABELS[ctx.role]}
          {ctx.workspace.isDemo ? " · demo" : ""}
        </p>
        <Link href="/workspaces" className="mt-1 inline-block text-sm text-night-gold">
          Switch workspace
        </Link>
      </div>
      <nav aria-label="Main">
        <NavLinks items={items} />
      </nav>
      <div className="mt-auto space-y-3 border-t border-night-line pt-4 text-night-ink">
        <p className="text-sm">
          {ctx.user.name}
          <span className="block text-night-ink/80">{ctx.user.email}</span>
        </p>
        <ThemeToggle />
        <form action={signOutAction}>
          <button type="submit" className="btn btn-ghost w-full justify-start px-2 text-night-ink hover:bg-white/10">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

async function MobileTop() {
  const ctx = await getContext();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 lg:hidden">
      <Link href="/app" className="flex min-w-0 items-center gap-2 text-ink no-underline">
        <Mark />
        <span className="truncate font-semibold">{ctx.workspace.name}</span>
      </Link>
      <Link href="/workspaces" className="shrink-0 text-sm">
        Switch
      </Link>
    </div>
  );
}

async function MobileNav() {
  return <BottomNav items={await navItems()} />;
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only z-50 bg-gold p-3 text-on-gold focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <aside className="no-print hidden bg-night lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto">
        <Suspense
          fallback={
            <div className="space-y-3 p-4">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-20 w-full" />
            </div>
          }
        >
          <Sidebar />
        </Suspense>
      </aside>
      <div className="min-w-0">
        <div className="no-print">
          <Suspense fallback={<div className="h-11 border-b border-line lg:hidden" />}>
            <MobileTop />
          </Suspense>
        </div>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
    </div>
  );
}
