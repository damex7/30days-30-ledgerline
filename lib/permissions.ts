import { ForbiddenError } from "@/lib/errors";

// The one permission table. Services call assertCan() before doing anything
// (that is the security), and pages call can() to decide which buttons to
// show (that is only convenience). Hiding a button is not security: anyone
// can replay a request with curl or the browser's dev tools, so every
// service re-checks the role it was given, which came from the database.

export const ROLES = ["owner", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Role[] = ROLES;
const MANAGERS: readonly Role[] = ["owner", "manager"];
const OWNER: readonly Role[] = ["owner"];

export const PERMISSIONS = {
  // Customers: everyone sells, so everyone can add a customer; only
  // managers edit or archive other people's.
  "customer.view": ALL,
  "customer.create": ALL,
  "customer.edit_own": ALL,
  "customer.edit_any": MANAGERS,
  "customer.archive": MANAGERS,
  // Products and stock: staff can look, not change prices or stock counts.
  "product.view": ALL,
  "product.manage": MANAGERS,
  "stock.adjust": MANAGERS,
  // Invoices and payments.
  "invoice.view": ALL,
  "invoice.create": ALL,
  "invoice.edit_own": ALL, // own drafts
  "invoice.edit_any": MANAGERS,
  "invoice.void": MANAGERS,
  "payment.record": ALL,
  "payment.reverse": MANAGERS,
  // Expenses: staff record theirs and see only theirs.
  "expense.create": ALL,
  "expense.edit_own": ALL,
  "expense.edit_any": MANAGERS,
  "expense.view_all": MANAGERS,
  // Reports: staff see sales and money owed, never profit or expenses.
  "report.basic": ALL,
  "report.profit": MANAGERS,
  "report.export": MANAGERS,
  "audit.view": MANAGERS,
  // The assistant: profit tools follow the same rule as profit reports.
  "ai.ask": ALL,
  "ai.profit_tools": MANAGERS,
  "ai.usage": OWNER,
  // The business itself.
  "team.manage": OWNER,
  "workspace.edit_details": OWNER,
  "workspace.export": OWNER,
  "workspace.delete": OWNER,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export function can(role: Role, action: Action): boolean {
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

/** Rank for "at least manager" comparisons (used by AI tool minimum roles). */
export const ROLE_RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

/** Throws ForbiddenError unless ctx.role may do action. Services call this first. */
export function assertCan(ctx: { role: Role }, action: Action, message?: string): void {
  if (!can(ctx.role, action)) throw new ForbiddenError(message);
}

/**
 * Editing a record: "any" permission, or the "own" one and you created it.
 * Staff can fix their own draft invoice or expense, not a colleague's.
 */
export function assertCanEdit(
  ctx: { role: Role; userId: string },
  record: { createdBy: string | null },
  own: Action,
  any: Action,
): void {
  if (can(ctx.role, any)) return;
  if (can(ctx.role, own) && record.createdBy === ctx.userId) return;
  throw new ForbiddenError("You can only change records you created.");
}
