"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { HomeIcon, MenuIcon, PlusIcon, ReceiptIcon, SparkIcon } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
}

function isCurrent(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Sidebar links (desktop) with aria-current on the active page. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`block rounded-md px-3 py-2 no-underline ${
                current ? "bg-night-gold font-semibold text-on-gold" : "text-night-ink hover:bg-white/10"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Phone navigation: a bottom bar within thumb reach, with the most common
 * job ("New sale") in the middle, and "More" opening a sheet with the rest.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const tab = (href: string, label: string, icon: React.ReactNode) => {
    const current = isCurrent(pathname, href);
    return (
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs no-underline ${
          current ? "font-bold text-night-gold underline decoration-2 underline-offset-4" : "text-night-ink"
        }`}
      >
        {icon}
        {label}
      </Link>
    );
  };
  return (
    <>
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-night-line bg-night lg:hidden">
        <div className="mx-auto flex max-w-xl items-stretch px-1 pb-[env(safe-area-inset-bottom)]">
          {tab("/app", "Home", <HomeIcon />)}
          {tab("/app/invoices", "Invoices", <ReceiptIcon />)}
          <Link
            href="/app/invoices/new"
            className="mx-1 my-1.5 flex flex-1 flex-col items-center justify-center rounded-xl bg-night-gold text-xs font-bold text-on-gold no-underline"
          >
            <PlusIcon />
            New sale
          </Link>
          {tab("/app/assistant", "Ask", <SparkIcon />)}
          <button
            ref={opener}
            type="button"
            onClick={() => sheet.current?.showModal()}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-night-ink"
          >
            <MenuIcon />
            More
          </button>
        </div>
      </nav>
      <dialog
        ref={sheet}
        aria-label="All pages"
        onClose={() => opener.current?.focus()}
        className="mb-0 mt-auto w-full max-w-none rounded-t-2xl border-t-4 border-gold bg-night p-0 text-night-ink backdrop:bg-black/60 lg:hidden"
      >
        <div className="p-4 pb-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-xl">All pages</p>
            <button type="button" className="btn btn-ghost text-night-ink" onClick={() => sheet.current?.close()}>
              Close
            </button>
          </div>
          <div onClick={(e) => (e.target as HTMLElement).closest("a") && sheet.current?.close()}>
            <NavLinks items={items} />
          </div>
        </div>
      </dialog>
    </>
  );
}
