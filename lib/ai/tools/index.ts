import "server-only";
import type { Role } from "@/lib/permissions";
import type { ToolDeclaration } from "@/lib/ai/provider";
import { roleAllows, type Tool } from "@/lib/ai/tools/types";
import { comparePeriods, getExpenseBreakdown, getProfitSummary, getSalesSummary } from "@/lib/ai/tools/sales";
import { customersOwing, findCustomer, getInvoice, listLowStock, listOverdueInvoices, topCustomers, topProducts } from "@/lib/ai/tools/records";

// The complete, fixed list of things the assistant can do. Every one of them
// READS. There is no tool that writes, sends, deletes or runs code, so no
// prompt, however clever, can make the model change your books: it would
// need a tool that doesn't exist.

export const TOOLS: readonly Tool[] = [
  getSalesSummary,
  comparePeriods,
  listOverdueInvoices,
  customersOwing,
  listLowStock,
  topProducts,
  topCustomers,
  findCustomer,
  getInvoice,
  getProfitSummary,
  getExpenseBreakdown,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): Tool | undefined {
  return BY_NAME.get(name);
}

/** Only the tools this role may use are even offered to the model. */
export function toolsFor(role: Role): Tool[] {
  return TOOLS.filter((t) => roleAllows(role, t.minRole));
}

export function declarationsFor(role: Role): ToolDeclaration[] {
  return toolsFor(role).map((t) => ({ name: t.name, description: t.description, parameters: t.jsonSchema }));
}

export function toolLabel(name: string): string {
  return BY_NAME.get(name)?.label ?? `Tried an unknown tool (${name.slice(0, 40)})`;
}

export type { Tool } from "@/lib/ai/tools/types";
