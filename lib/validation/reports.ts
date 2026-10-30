import { z } from "zod";
import { RANGE_PRESETS, resolvePreset, formatDate, type DateRange } from "@/lib/dates";
import { isoDate } from "@/lib/validation/common";

/** ?preset=this_month or ?from=…&to=… from the URL; defaults to this month. */
export const rangeParamsSchema = z.object({
  preset: z.enum(RANGE_PRESETS).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
});

export function rangeFromParams(raw: Record<string, string | string[] | undefined>): DateRange {
  const p = rangeParamsSchema.parse({
    preset: typeof raw.preset === "string" ? raw.preset : undefined,
    from: typeof raw.from === "string" && raw.from ? raw.from : undefined,
    to: typeof raw.to === "string" && raw.to ? raw.to : undefined,
  });
  if (p.from && p.to) return { from: p.from, to: p.to, label: `${formatDate(p.from)} – ${formatDate(p.to)}` };
  return resolvePreset(p.preset ?? "this_month");
}
