import Link from "next/link";
import { Wordmark } from "@/components/ui/mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProviderBadge } from "./provider-badge";
import { DemoButton } from "./demo-button";
import { Suspense } from "react";

const FEATURES = [
  {
    title: "Customers who owe, at a glance",
    body: "Balances are computed from invoices and payments, never typed, so they're always right.",
  },
  {
    title: "Stock you can explain",
    body: "Every bag sold, restocked or returned is a line in a ledger. Stock can't go below zero, even when two people sell the last carton at once.",
  },
  {
    title: "Invoices that stay honest",
    body: "Numbers run INV-0001, INV-0002 with no gaps. A sent invoice can't be quietly edited, only voided. Share it on WhatsApp in one tap.",
  },
  {
    title: "An assistant that only reads",
    body: "Ask “who owes me more than 50k?” in English or Pidgin. It answers from your own books through a few read-only tools, and anything that changes money waits for your approval.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-8">
        <Wordmark />
        <nav aria-label="Account" className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link href="/sign-in" className="btn btn-ghost">
            Sign in
          </Link>
          <Link href="/sign-up" className="btn btn-dark">
            Create account
          </Link>
        </nav>
      </header>
      <main id="main" className="flex-1">
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div>
            <p className="mb-3 inline-block border-b-2 border-gold pb-1 text-sm font-semibold uppercase tracking-wider">
              For shops, salons, caterers, tailors and small distributors
            </p>
            <h1 className="text-5xl sm:text-6xl">One calm place to run the business.</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-2">
              Customers, stock, invoices, payments and expenses, kept correct to the kobo, plus an assistant that answers questions
              about your own books and never changes anything without you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Suspense fallback={<span className="btn btn-primary">Try the demo</span>}>
                <DemoButton />
              </Suspense>
              <Link href="/sign-up" className="btn btn-secondary">
                Start your own workspace
              </Link>
            </div>
            <div className="mt-6">
              <ProviderBadge />
            </div>
          </div>
          <figure className="card self-start p-5" aria-label="A sample invoice">
            <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
              <span className="font-display text-2xl font-semibold">INV-0042</span>
              <span className="text-sm text-ink-2">Due 7 Nov 2026</span>
            </div>
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Sample invoice lines</caption>
              <thead>
                <tr className="text-left text-ink-2">
                  <th scope="col" className="py-1 font-semibold">
                    Item
                  </th>
                  <th scope="col" className="num py-1 font-semibold">
                    Qty
                  </th>
                  <th scope="col" className="num py-1 font-semibold">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="py-1.5">Rice, 50kg bag</td>
                  <td className="num">3</td>
                  <td className="num">₦246,000.00</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-1.5">Indomie, carton</td>
                  <td className="num">2</td>
                  <td className="num">₦19,600.00</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-1.5">Delivery</td>
                  <td className="num" />
                  <td className="num">₦2,000.00</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink font-bold">
                  <td className="py-2">Total</td>
                  <td />
                  <td className="num">₦267,600.00</td>
                </tr>
              </tfoot>
            </table>
          </figure>
        </section>
        <section aria-labelledby="what" className="border-t border-line bg-card">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
            <h2 id="what" className="mb-8 text-3xl">
              What Ledgerline does
            </h2>
            <ul className="grid gap-6 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.title} className="border-l-4 border-gold pl-4">
                  <h3 className="text-xl">{f.title}</h3>
                  <p className="mt-1 text-ink-2">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <footer className="bg-night px-4 py-6 text-sm text-night-ink sm:px-8">
        <p>Ledgerline: day 30 of a 30-day build challenge. Prices in naira; no real payments are processed.</p>
      </footer>
    </div>
  );
}
