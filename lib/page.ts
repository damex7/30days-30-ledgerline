import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { NotFoundError } from "@/lib/errors";

/** A route id that isn't even a uuid is simply "not found". */
export function idOr404(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) notFound();
  return parsed.data;
}

/** Runs a loader; a NotFoundError (missing OR another workspace's) becomes the 404 page. */
export async function or404<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
