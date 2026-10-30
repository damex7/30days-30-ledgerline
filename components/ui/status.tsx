import { CheckIcon, ClockIcon } from "@/components/ui/icons";

// States are told apart by their WORD and a distinct SHAPE (dashed, outline,
// half-filled, filled, double border, strikethrough), never by colour alone,
// so they read the same in light mode, dark mode, greyscale print and for
// people who don't see colour differences.

export type InvoiceDisplayStatus = "draft" | "sent" | "partly_paid" | "paid" | "overdue" | "void";

const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap";

function Dot({ fill }: { fill: "none" | "half" | "full" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.8" fill={fill === "full" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" />
      {fill === "half" ? <path d="M6 1.2a4.8 4.8 0 0 1 0 9.6z" fill="currentColor" /> : null}
    </svg>
  );
}

export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partly_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  const label = INVOICE_STATUS_LABEL[status];
  switch (status) {
    case "draft":
      return (
        <span className={`${base} border-[1.5px] border-dashed border-field text-ink-2`}>
          <Dot fill="none" />
          {label}
        </span>
      );
    case "sent":
      return (
        <span className={`${base} border-[1.5px] border-ink`}>
          <Dot fill="none" />
          {label}
        </span>
      );
    case "partly_paid":
      return (
        <span className={`${base} border-[1.5px] border-ink bg-[linear-gradient(90deg,var(--gold)_50%,transparent_50%)]`}>
          <Dot fill="half" />
          {label}
        </span>
      );
    case "paid":
      return (
        <span className={`${base} border-[1.5px] border-gold bg-gold text-on-gold`}>
          <CheckIcon className="h-3.5 w-3.5" />
          {label}
        </span>
      );
    case "overdue":
      return (
        <span className={`${base} border-[4px] border-double border-ink`}>
          <ClockIcon className="h-3.5 w-3.5" />
          {label}
        </span>
      );
    case "void":
      return <span className={`${base} border border-dotted border-field text-ink-2 line-through`}>{label}</span>;
  }
}

export type StockLevel = "ok" | "low" | "out";

export function StockBadge({ level, quantity, unit }: { level: StockLevel; quantity: number; unit?: string }) {
  const qty = `${quantity.toLocaleString("en-NG")}${unit ? ` ${unit}` : ""}`;
  if (level === "out") {
    return (
      <span className={`${base} border-[4px] border-double border-ink`}>
        <Dot fill="none" />
        Out of stock
      </span>
    );
  }
  if (level === "low") {
    return (
      <span className={`${base} border-[1.5px] border-ink bg-[linear-gradient(90deg,var(--gold)_50%,transparent_50%)]`}>
        <Dot fill="half" />
        Low · {qty}
      </span>
    );
  }
  return (
    <span className={`${base} border-[1.5px] border-field`}>
      <Dot fill="full" />
      In stock · {qty}
    </span>
  );
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired";

export function ProposalBadge({ status }: { status: ProposalStatus }) {
  switch (status) {
    case "pending":
      return (
        <span className={`${base} border-[1.5px] border-dashed border-ink`}>
          <Dot fill="none" />
          Waiting for approval
        </span>
      );
    case "approved":
      return (
        <span className={`${base} border-[1.5px] border-gold bg-gold text-on-gold`}>
          <CheckIcon className="h-3.5 w-3.5" />
          Approved
        </span>
      );
    case "rejected":
      return <span className={`${base} border border-field text-ink-2 line-through`}>Rejected</span>;
    case "expired":
      return <span className={`${base} border border-dotted border-field text-ink-2 line-through`}>Expired</span>;
  }
}
