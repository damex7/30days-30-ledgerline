"use server";

import { redirect } from "next/navigation";
import { startDemo } from "@/lib/services/demo";
import { setSessionCookie } from "@/lib/auth/session";
import { clientIp } from "@/lib/request";
import { RateLimitedError } from "@/lib/errors";

export async function startDemoAction(): Promise<void> {
  let token: string;
  try {
    token = (await startDemo(await clientIp())).token;
  } catch (error) {
    if (error instanceof RateLimitedError) redirect("/?notice=demo-limit");
    redirect("/?notice=demo-error");
  }
  await setSessionCookie(token);
  redirect("/app");
}
