import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Fraunces: a warm, slightly old-style serif for headings (a ledger-book
// feel). Inter: a very readable body face with true tabular figures, used
// for every money column. Both include the ₦ sign and the Yoruba letters
// (checked in the font files' character maps).
const fraunces = Fraunces({ subsets: ["latin", "latin-ext"], variable: "--font-fraunces", display: "swap" });
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Ledgerline", template: "%s · Ledgerline" },
  description: "A calm place to run a small Nigerian business: customers, stock, invoices, payments and an assistant that only reads your own books.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0b09" },
  ],
};

// Runs before first paint, so a saved light/dark choice never flashes the
// wrong theme. "system" (or nothing saved) leaves it to the media query.
const themeScript = `try{var t=localStorage.getItem("ll-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className={`${fraunces.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
