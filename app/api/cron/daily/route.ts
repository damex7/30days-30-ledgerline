import { timingSafeEqual } from "node:crypto";
import { runDaily } from "@/lib/services/daily";
import { errorResponse } from "@/lib/http";

// GET /api/cron/daily, called by Vercel Cron (see vercel.json) with
// "Authorization: Bearer <CRON_SECRET>". This is the only system-level job:
// there is no platform admin who can read business data.

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: Request) {
  if (!authorised(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, summary: await runDaily() });
  } catch (error) {
    return errorResponse(error);
  }
}
