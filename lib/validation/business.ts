import { z } from "zod";
import {
  clientRequestId,
  isoDate,
  nairaInput,
  optionalEmail,
  optionalNairaInput,
  optionalPhone,
  optionalText,
  quantity,
  text,
  uuid,
} from "@/lib/validation/common";

// Schemas for the business forms. Every one of them runs on the server;
// whatever the browser checked first is only for comfort.

const tags = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10),
  )
  .pipe(z.array(z.string().max(30, "Tags are at most 30 characters each.")));

export const customerSchema = z.object({
  name: text(120, "Name"),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  notes: optionalText(2000, "Notes"),
  tags,
});
export type CustomerInput = z.infer<typeof customerSchema>;

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,32}$/, "Use letters, digits and dashes, like RICE-50KG.");

const lowStockLevel = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? Number(v) : null))
  .pipe(z.number().int("Whole units only.").min(0).max(100_000).nullable());

export const productSchema = z.object({
  sku,
  name: text(120, "Name"),
  unit: text(20, "Unit"),
  price: nairaInput("Price"),
  cost: nairaInput("Cost"),
  lowStockLevel,
});
export type ProductInput = z.infer<typeof productSchema>;

export const newProductSchema = productSchema.extend({
  openingStock: z.coerce.number().int("Whole units only.").min(0).max(1_000_000),
});
export type NewProductInput = z.infer<typeof newProductSchema>;

export const stockAdjustmentSchema = z
  .object({
    reason: z.enum(["restock", "adjustment"]),
    quantityDelta: z.coerce
      .number({ error: "Enter a quantity." })
      .int("Whole units only.")
      .refine((n) => n !== 0, "Enter a quantity other than 0.")
      .refine((n) => Math.abs(n) <= 1_000_000, "That quantity is too large."),
    note: optionalText(300, "Note"),
  })
  .refine((v) => v.reason !== "restock" || v.quantityDelta > 0, {
    path: ["quantityDelta"],
    message: "A restock adds stock: enter a positive number.",
  });
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// ------------------------------------------------------------------ invoices
// A line is either a product (price defaults to the product's price) or free
// text with its own price. There is deliberately NO total field anywhere:
// subtotal, line totals and the invoice total are computed by the server.

export const invoiceLineSchema = z
  .object({
    productId: uuid.nullable().optional(),
    description: z.string().trim().max(200).optional(),
    quantity,
    /** Naira text; empty = use the product's price. Required for free-text lines. */
    unitPrice: z.string().max(30).optional(),
  })
  .refine((l) => l.productId || (l.description && l.description.length > 0), {
    path: ["description"],
    message: "Choose a product or describe the item.",
  });
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export const invoiceSchema = z
  .object({
    customerId: uuid,
    issueDate: isoDate,
    dueDate: isoDate,
    items: z.array(invoiceLineSchema).min(1, "Add at least one item.").max(50, "At most 50 items."),
    discount: optionalNairaInput("Discount"),
    deliveryFee: optionalNairaInput("Delivery fee"),
    notes: optionalText(1000, "Notes"),
    clientRequestId,
    send: z.boolean().default(false),
  })
  .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "The due date can't be before the issue date." });
export type InvoiceInput = z.infer<typeof invoiceSchema>;

export const voidSchema = z.object({
  reason: text(300, "Reason"),
});

// ------------------------------------------------------------------ payments
export const PAYMENT_METHODS = ["cash", "transfer", "pos"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  pos: "POS",
};

export const paymentSchema = z.object({
  invoiceId: uuid,
  amount: nairaInput("Amount").pipe(z.number().min(1, "Enter an amount above ₦0.")),
  method: z.enum(PAYMENT_METHODS, { error: "Choose how they paid." }),
  paidOn: isoDate,
  note: optionalText(300, "Note"),
  clientRequestId,
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const reversalSchema = z.object({
  paymentId: uuid,
  reason: text(300, "Reason"),
  clientRequestId,
});

// ------------------------------------------------------------------ expenses
export const EXPENSE_CATEGORIES = ["stock", "rent", "salaries", "transport", "utilities", "marketing", "equipment", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  stock: "Stock purchases",
  rent: "Rent",
  salaries: "Salaries & wages",
  transport: "Transport & delivery",
  utilities: "Power, fuel & data",
  marketing: "Marketing",
  equipment: "Equipment & repairs",
  other: "Other",
};

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { error: "Choose a category." }),
  amount: nairaInput("Amount").pipe(z.number().min(1, "Enter an amount above ₦0.")),
  spentOn: isoDate,
  note: optionalText(300, "Note"),
  receiptRef: optionalText(120, "Receipt reference"),
  clientRequestId,
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

// ------------------------------------------------------------------ list filters (search params)
export const INVOICE_FILTER_STATUSES = ["draft", "sent", "partly_paid", "paid", "overdue", "void", "open"] as const;

export const invoiceFiltersSchema = z.object({
  status: z.enum(INVOICE_FILTER_STATUSES).optional().catch(undefined),
  customer: uuid.optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>;
