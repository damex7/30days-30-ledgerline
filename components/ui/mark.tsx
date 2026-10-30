// The Ledgerline mark: three ruled ledger lines, the last one running on
// into a small gold spark. Drawn by hand as an SVG path, no icon pack.
export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className} fill="none">
      <path d="M4 9.5h17M4 16h13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M4 22.5c5.5-.3 10.6-.2 15.2-1.2 1.6-.3 2.9-.9 3.9-1.8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M25.6 12.2l1.1 3.1 3.1 1.1-3.1 1.1-1.1 3.1-1.1-3.1-3.1-1.1 3.1-1.1z"
        fill="var(--gold)"
        stroke="var(--gold)"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-semibold tracking-tight ${className}`}>
      <Mark />
      Ledgerline
    </span>
  );
}
