import { z } from "zod";
import { optionalEmail, optionalText, text } from "@/lib/validation/common";

export const createWorkspaceSchema = z.object({
  name: text(80, "Business name"),
});

export const workspaceDetailsSchema = z.object({
  name: text(80, "Business name"),
  businessAddress: optionalText(300, "Address"),
  businessPhone: optionalText(30, "Phone"),
  businessEmail: optionalEmail,
  bankDetails: optionalText(300, "Bank details"),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,8}$/, "Use 1–8 letters or digits, like INV or MN."),
  lowStockDefault: z.coerce.number().int().min(0).max(100_000),
});
export type WorkspaceDetailsInput = z.infer<typeof workspaceDetailsSchema>;
