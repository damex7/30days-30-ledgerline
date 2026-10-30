import "server-only";
import { headers } from "next/headers";

/** The caller's IP for rate limiting (Vercel puts it first in x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || h.get("x-real-ip") || "local").slice(0, 64);
}
