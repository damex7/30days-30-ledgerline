import Link from "next/link";
import { formatNaira } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { InvoiceStatusBadge } from "@/components/ui/status";
import type { InvoiceSummary } from "@/lib/services/invoices";

/** Invoice rows: a real table on wide screens, stacked cards on phones. */
export function InvoiceTable({ invoices, caption, showCustomer = true }: { invoices: InvoiceSummary[]; caption: string; showCustomer?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="stack-table w-full">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b-2 border-ink text-left">
          <tr>
            <th scope="col" className="py-2 pr-3">Invoice</th>
            {showCustomer ? <th scope="col" className="py-2 pr-3">Customer</th> : null}
            <th scope="col" className="py-2 pr-3">Status</th>
            <th scope="col" className="py-2 pr-3">Issued</th>
            <th scope="col" className="py-2 pr-3">Due</th>
            <th scope="col" className="num py-2 pr-3">Total</th>
            <th scope="col" className="num py-2">Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-line">
              <th scope="row" data-label="Invoice" className="py-2 pr-3 text-left font-normal">
                <Link href={`/app/invoices/${inv.id}`} className="font-semibold">
                  {inv.label}
                </Link>
              </th>
              {showCustomer ? (
                <td data-label="Customer" className="py-2 pr-3">
                  {inv.customerName}
                </td>
              ) : null}
              <td data-label="Status" className="py-2 pr-3">
                <InvoiceStatusBadge status={inv.displayStatus} />
              </td>
              <td data-label="Issued" className="py-2 pr-3 whitespace-nowrap">
                {formatDate(inv.issueDate)}
              </td>
              <td data-label="Due" className="py-2 pr-3 whitespace-nowrap">
                {formatDate(inv.dueDate)}
              </td>
              <td data-label="Total" className="num py-2 pr-3">
                {formatNaira(inv.totalKobo)}
              </td>
              <td data-label="Balance" className="num py-2 font-semibold">
                {inv.balanceKobo > 0 ? formatNaira(inv.balanceKobo) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
