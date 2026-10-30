import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { MAX_DRAFT_CHARS, MAX_QUESTION_CHARS } from "@/lib/ai/limits";

// Schemas for everything that crosses the AI boundary: requests from the
// browser AND output from the model. Model output is untrusted input like
// any form: it is parsed with these schemas, retried once with a repair
// instruction if it fails, and never acted on if it still fails.

export const askRequestSchema = z.object({
  question: z.string().trim().min(2, "Ask a question.").max(MAX_QUESTION_CHARS, `Keep questions under ${MAX_QUESTION_CHARS} characters.`),
  clientRequestId: z.uuid(),
});

export const draftRequestSchema = z.object({
  text: z.string().trim().min(5, "Describe the sale.").max(MAX_DRAFT_CHARS, `Keep it under ${MAX_DRAFT_CHARS} characters.`),
  clientRequestId: z.uuid(),
});

export const TONES = ["polite", "firm", "final"] as const;
export const LANGUAGES = ["english", "pidgin"] as const;

export const reminderRequestSchema = z.object({
  invoiceId: z.uuid(),
  tone: z.enum(TONES),
  language: z.enum(LANGUAGES),
  clientRequestId: z.uuid(),
});

// ---- Model output: invoice draft. Note what's missing: totals. The model
// can't set them because the schema has nowhere to put them.
const positiveInt = z.number().int().positive();

export const invoiceDraftSchema = z.object({
  customer_query: z.string().trim().min(1).max(120),
  lines: z
    .array(
      z.object({
        product_query: z.string().trim().min(1).max(120),
        quantity: positiveInt.max(100_000),
        unit_price_kobo: positiveInt.max(1_000_000_000_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
  delivery_fee_kobo: z.number().int().min(0).max(1_000_000_000).default(0),
  discount_kobo: z.number().int().min(0).max(1_000_000_000).default(0),
  due_date: z.string().refine(isIsoDate, "Use YYYY-MM-DD").nullable().optional(),
});
export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

export const reminderOutputSchema = z.object({ message: z.string().trim().min(10).max(800) });
export const summaryOutputSchema = z.object({ narration: z.string().trim().min(20).max(1500) });

export const feedbackSchema = z.object({
  runId: z.uuid(),
  rating: z.enum(["up", "down"]),
  reason: z.string().trim().max(500).optional(),
});

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}

/** Parses model text as JSON + schema; returns readable issues on failure. */
export function parseModelJson<S extends z.ZodType>(schema: S, text: string): { ok: true; value: z.infer<S> } | { ok: false; issues: string } {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, issues: "not valid JSON" };
  }
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ") };
}
