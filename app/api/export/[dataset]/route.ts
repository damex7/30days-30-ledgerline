import { getApiContext } from "@/lib/context";
import { exportDataset, isDataset } from "@/lib/services/export";
import { csvResponse, toCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/http";
import { NotFoundError } from "@/lib/errors";
import { todayInLagos } from "@/lib/dates";

// GET /api/export/customers (etc.): one table of this workspace as CSV. Owner only.
export async function GET(_request: Request, { params }: RouteContext<"/api/export/[dataset]">) {
  try {
    const { dataset } = await params;
    if (!isDataset(dataset)) throw new NotFoundError("Dataset");
    const ctx = await getApiContext();
    const rows = await exportDataset(ctx, dataset);
    return csvResponse(`${dataset}-${todayInLagos()}.csv`, rows.length ? toCsv(rows) : "no rows\r\n");
  } catch (error) {
    return errorResponse(error);
  }
}
