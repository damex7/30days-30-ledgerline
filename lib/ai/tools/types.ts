import "server-only";
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { ROLE_RANK, type Role } from "@/lib/permissions";
import { addDays, daysBetween, formatDate, isIsoDate, RANGE_PRESETS, resolvePreset, type DateRange } from "@/lib/dates";
import { formatNaira } from "@/lib/money";
import { MAX_TOOL_ROWS } from "@/lib/ai/limits";

// What every assistant tool looks like. A tool:
//   * has a plain-language description the model reads;
//   * declares its arguments as a Zod schema (also sent to the model as JSON
//     Schema) and NOTHING runs until that schema accepts the model's args;
//   * has a minimum role (staff can't reach profit tools);
//   * has a hard row limit;
//   * gets the workspace ONLY from the server-side context, never from the
//     model (the schemas don't even have a workspace field, and unknown
//     keys such as "workspace_id" are stripped by Zod);
//   * runs inside a READ ONLY transaction with a statement timeout, so even a
//     buggy tool can't write anything or run forever.

export interface ToolEnv {
  ctx: Ctx;
  db: Db;
  today: string;
}

export interface ToolOutput {
  /** Rows returned (logged; the rows themselves are not). */
  rows: number;
  /** What the model gets back (wrapped as untrusted data). */
  data: Record<string, unknown>;
}

export interface Tool {
  name: string;
  /** Shown in the UI while it runs: "Checked overdue invoices". */
  label: string;
  description: string;
  minRole: Role;
  maxRows: number;
  schema: z.ZodType;
  jsonSchema: Record<string, unknown>;
  run(env: ToolEnv, args: unknown): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodType>(def: {
  name: string;
  label: string;
  description: string;
  minRole: Role;
  maxRows?: number;
  args: S;
  run: (env: ToolEnv, args: z.infer<S>) => Promise<ToolOutput>;
}): Tool {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    minRole: def.minRole,
    maxRows: Math.min(def.maxRows ?? MAX_TOOL_ROWS, MAX_TOOL_ROWS),
    schema: def.args,
    jsonSchema: z.toJSONSchema(def.args, { io: "input", unrepresentable: "any" }) as Record<string, unknown>,
    run: (env, args) => def.run(env, args as z.infer<S>),
  };
}

export function roleAllows(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

// ------------------------------------------------------------ shared args
const isoDate = z.string().describe("A date as YYYY-MM-DD").refine(isIsoDate, "Use a YYYY-MM-DD date.");

export const rangeArg = z
  .object({
    preset: z.enum(RANGE_PRESETS).optional().describe("A named period. Use this when the question names one (today, this week, this month, last month...)."),
    from: isoDate.optional().describe("Start date for a custom period"),
    to: isoDate.optional().describe("End date for a custom period"),
  })
  .describe("The period to look at. Defaults to this month.");

/** The server decides the actual dates (Lagos time), and says which it used. */
export function resolveRange(arg: z.infer<typeof rangeArg> | undefined, today: string): DateRange {
  if (arg?.from && arg.to && arg.from <= arg.to && arg.to <= today && daysBetween(arg.from, arg.to) <= 366) {
    return { from: arg.from, to: arg.to, label: `${formatDate(arg.from)} – ${formatDate(arg.to)}` };
  }
  if (arg?.from && !arg.to && arg.from <= today && daysBetween(arg.from, today) <= 366) {
    return { from: arg.from, to: today, label: `${formatDate(arg.from)} – ${formatDate(today)}` };
  }
  return resolvePreset(arg?.preset ?? "this_month", today);
}

export const limitArg = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).optional().describe(`How many rows to return (at most ${max}).`).transform((v) => v ?? fallback);

/** Money for the model: exact kobo plus the formatted naira it should quote. */
export function money(kobo: number): { kobo: number; naira: string } {
  return { kobo, naira: formatNaira(kobo) };
}

export function rangeInfo(range: DateRange): { from: string; to: string; label: string } {
  return { from: range.from, to: range.to, label: range.label };
}

export { addDays };
