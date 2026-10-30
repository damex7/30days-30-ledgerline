import { getApiContext } from "@/lib/context";
import { exportInvoices } from "@/lib/services/reports";
import { rangeFromParams } from "@/lib/validation/reports";
import { csvResponse, toCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/http";

// GET /api/reports/csv?from=2026-10-01&to=2026-10-30: the invoices in a range.
export async function GET(request: Request) {
  try {
    const ctx = await getApiContext();
    const range = rangeFromParams(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await exportInvoices(ctx, range.from, range.to);
    return csvResponse(`invoices-${range.from}-to-${range.to}.csv`, toCsv(rows, [
      "invoice", "issue_date", "due_date", "customer", "status", "subtotal_kobo", "discount_kobo", "delivery_fee_kobo", "total_kobo", "amount_paid_kobo", "balance_kobo",
    ]));
  } catch (error) {
    return errorResponse(error);
  }
}
