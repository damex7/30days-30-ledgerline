import type { AiMessage, AiProvider, ChatRequest, StreamChunk, StructuredRequest, StructuredResult, ToolCall } from "@/lib/ai/provider";
import { INVOICE_DRAFT_SYSTEM, REMINDER_SYSTEM, SUMMARY_SYSTEM } from "@/lib/ai/prompts";
import { addDays } from "@/lib/dates";

// A deterministic stand-in for a real model, used when there is no
// GEMINI_API_KEY, when AI_PROVIDER=mock, by the check script, and as the
// fallback when the real provider keeps returning rate-limit errors.
// It plays by the same rules as a model: it can only ASK for tools (the
// runner validates and runs them), and it writes its answer only from the
// tool results it gets back. It recognises a handful of question patterns
// in English and Nigerian Pidgin; anything else gets an honest "I can't".

type Range = { preset: string };

function detectRange(q: string): Range {
  if (/\btoday\b|\btoday\b|for today|dis today/.test(q)) return { preset: "today" };
  if (/last month|month wey pass/.test(q)) return { preset: "last_month" };
  if (/this week|dis week|week/.test(q)) return { preset: "this_week" };
  if (/last 7 days|past week|last week/.test(q)) return { preset: "last_7_days" };
  if (/last 30 days/.test(q)) return { preset: "last_30_days" };
  return { preset: "this_month" };
}

/** "50k", "₦50,000", "50 thousand" -> 50000 naira. */
function detectAmount(q: string): number | undefined {
  const m = /(?:more than|above|over|pass|at least|>)\s*(?:₦|n)?\s*([\d,.]+)\s*(k|m|thousand|million)?/i.exec(q);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  const scale = { k: 1_000, thousand: 1_000, m: 1_000_000, million: 1_000_000 }[(m[2] ?? "").toLowerCase() as "k"] ?? 1;
  return Number.isFinite(n) ? Math.round(n * scale) : undefined;
}

function planTools(question: string, available: Set<string>): { calls: { name: string; args: Record<string, unknown> }[]; refusal?: string } {
  const q = question.toLowerCase();
  const range = detectRange(q);
  const want = (name: string, args: Record<string, unknown>) => ({ calls: [{ name, args }] });

  const invoiceNo = /(?:invoice|inv|mn|st)[\s#-]*0*(\d{1,7})\b/i.exec(question);
  if (invoiceNo) return want("get_invoice", { number: Number(invoiceNo[1]) });
  if (/profit|gain|margin|how much i make|wetin i gain/.test(q)) {
    if (!available.has("get_profit_summary")) return { calls: [], refusal: "Profit figures are only shown to managers and owners of this business, so I can't share them with your role." };
    return want("get_profit_summary", { range });
  }
  if (/expense|spend|spent|cost me/.test(q)) {
    if (!available.has("get_expense_breakdown")) return { calls: [], refusal: "Expense figures are only shown to managers and owners of this business." };
    return want("get_expense_breakdown", { range });
  }
  if (/compare|vs\.?|versus|than last month|compared/.test(q)) {
    return want("compare_periods", { current: { preset: "this_month" }, previous: { preset: "last_month" } });
  }
  if (/overdue|late|past due|never pay|don pass/.test(q)) {
    const min = detectAmount(q);
    return want("list_overdue_invoices", min ? { min_balance_naira: min } : {});
  }
  if (/owe|owing|debt|debtor|balance|get my money|dey owe/.test(q)) {
    const named = /(?:does|did|how much (?:does|do))\s+(.+?)\s+owe/i.exec(question) ?? /(?:balance (?:for|of))\s+(.+?)[?.]?$/i.exec(question);
    if (named?.[1] && !/^(i|we|people|customers|anybody|anyone)$/i.test(named[1])) return want("find_customer", { name: named[1] });
    const min = detectAmount(q);
    return want("customers_owing", min ? { min_balance_naira: min } : {});
  }
  if (/low stock|almost finish|nearly finish|running out|out of stock|don finish|restock|stock/.test(q)) return want("list_low_stock_products", {});
  if (/top customer|best customer|who buy pass|who bought the most|biggest customer/.test(q)) return want("top_customers", { range });
  if (/top product|best[- ]selling|sell pass|sell most|sold the most|popular/.test(q)) return want("top_products", { range });
  const who = /(?:find|look up|about|customer)\s+(?:customer\s+)?([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)*)/.exec(question);
  if (who?.[1]) return want("find_customer", { name: who[1] });
  if (/sales|sell|sold|revenue|money (?:come|came) in|payments?|how (?:far|business)|how did|how was|wetin i sell/.test(q)) return want("get_sales_summary", { range });
  return { calls: [] };
}

function unwrap(content: string): Record<string, unknown> {
  const body = content.split("\n").slice(1, -1).join("\n");
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type Money = { naira?: string };
const n = (v: unknown) => (v as Money | undefined)?.naira ?? "₦0.00";

/** Writes a short plain answer from one tool's result. */
function answerFrom(tool: string, data: Record<string, unknown>, pidgin: boolean): string {
  const period = (data.period as { label?: string } | undefined)?.label;
  if (data.error) return `I couldn't get that from your records (${String(data.error)}).`;
  switch (tool) {
    case "get_sales_summary": {
      const owed = data.owed_now as Money & { open_invoices?: number };
      return `For ${period}, you sent ${data.invoices_sent} invoices worth ${n(data.sales)} and received ${n(data.payments_received)} in payments. Right now customers owe ${n(owed)} on ${owed?.open_invoices ?? 0} open invoices.`;
    }
    case "compare_periods": {
      const c = data.current as Record<string, unknown>;
      const p = data.previous as Record<string, unknown>;
      const ch = data.change as Record<string, unknown>;
      const pct = ch.sales_percent === null ? "" : ` (${ch.sales_percent}%)`;
      return `Sales for ${(c.period as { label: string }).label} are ${n(c.sales)}, against ${n(p.sales)} for ${(p.period as { label: string }).label}: a change of ${n(ch.sales)}${pct}. Payments received: ${n(c.payments_received)} versus ${n(p.payments_received)}.`;
    }
    case "customers_owing": {
      const list = (data.customers as { customer: string; owes: Money; open_invoices: number }[]) ?? [];
      if (!list.length) return pidgin ? "Nobody dey owe you pass that amount now." : "No customer owes you that much right now.";
      const head = pidgin ? `${list.length} customers dey owe you:` : `${list.length} customers owe you${data.threshold ? ` at least ${n(data.threshold)}` : ""}:`;
      return [head, ...list.map((c) => `- ${c.customer}: ${n(c.owes)} on ${c.open_invoices} invoice(s)`)].join("\n");
    }
    case "list_overdue_invoices": {
      const list = (data.invoices as { invoice: string; customer: string; days_overdue: number; balance: Money }[]) ?? [];
      const total = data.overdue_total as Money & { invoices?: number };
      if (!list.length) return "Nothing is overdue right now.";
      return [
        `${total?.invoices ?? list.length} invoices are overdue, ${n(total)} in total, as of ${data.as_of}. The oldest:`,
        ...list.slice(0, 8).map((i) => `- ${i.invoice} · ${i.customer}: ${n(i.balance)}, ${i.days_overdue} days late`),
      ].join("\n");
    }
    case "list_low_stock_products": {
      const list = (data.products as { product: string; in_stock: number; unit: string; out_of_stock: boolean }[]) ?? [];
      if (!list.length) return "Nothing is running low.";
      return [
        pidgin ? "These ones don almost finish:" : "These products are almost finished:",
        ...list.map((p) => `- ${p.product}: ${p.out_of_stock ? "out of stock" : `${p.in_stock} ${p.unit} left`}`),
      ].join("\n");
    }
    case "top_products": {
      const list = (data.products as { product: string; quantity_sold: number; unit: string; sales: Money }[]) ?? [];
      if (!list.length) return `No product sales for ${period}.`;
      return [`Best sellers for ${period}:`, ...list.map((p) => `- ${p.product}: ${p.quantity_sold} ${p.unit}, ${n(p.sales)}`)].join("\n");
    }
    case "top_customers": {
      const list = (data.customers as { customer: string; invoices: number; sales: Money }[]) ?? [];
      if (!list.length) return `No sales for ${period}.`;
      return [`Top customers for ${period}:`, ...list.map((c) => `- ${c.customer}: ${n(c.sales)} across ${c.invoices} invoice(s)`)].join("\n");
    }
    case "find_customer": {
      const list = (data.matches as { customer: string; owes: Money }[]) ?? [];
      if (!list.length) return `I couldn't find a customer called "${String(data.query)}".`;
      // Notes are deliberately not repeated: they are data, and may contain anything.
      return list.length === 1
        ? `${list[0]!.customer} owes you ${n(list[0]!.owes)}.`
        : ["I found more than one match:", ...list.map((c) => `- ${c.customer}: owes ${n(c.owes)}`)].join("\n");
    }
    case "get_invoice": {
      if (!data.found) return `There's no invoice number ${String(data.number)} in this business.`;
      return `${data.invoice} for ${data.customer} is ${String(data.status).replace("_", " ")}: total ${n(data.total)}, paid ${n(data.paid)}, balance ${n(data.balance)}, due ${data.due_date}.`;
    }
    case "get_profit_summary":
      return `For ${period}: sales ${n(data.sales)}, cost of goods ${n(data.cost_of_goods_sold)}, expenses ${n(data.expenses)}, so estimated profit is ${n(data.estimated_profit)}.`;
    case "get_expense_breakdown": {
      const list = (data.categories as { category: string; amount: Money }[]) ?? [];
      return [`Expenses for ${period}: ${n(data.total)} in total.`, ...list.map((c) => `- ${c.category}: ${n(c.amount)}`)].join("\n");
    }
    default:
      return "I got a result I don't know how to describe.";
  }
}

function* words(text: string): Generator<StreamChunk> {
  for (const part of text.match(/\S+\s*/g) ?? []) yield { type: "text", text: part };
}

const CANT =
  "I can't answer that from your records. I can tell you about sales and payments, who owes you, overdue invoices, stock that's running low, your top products and customers, a single invoice, and (for managers) profit and expenses.";

export class MockProvider implements AiProvider {
  readonly name = "mock" as const;

  async *stream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const last = req.messages.at(-1);
    const question = [...req.messages].reverse().find((m): m is Extract<AiMessage, { role: "user" }> => m.role === "user")?.text ?? "";
    const pidgin = /\b(dey|wetin|abeg|una|don|wey|pass|na)\b/i.test(question);
    if (last?.role === "tool") {
      const text = last.results.map((r) => answerFrom(r.name, unwrap(r.content), pidgin)).join("\n\n");
      yield* words(text);
      yield { type: "usage", usage: { inputTokens: 0, outputTokens: 0 } };
      return;
    }
    const plan = planTools(question, new Set(req.tools.map((t) => t.name)));
    if (plan.calls.length === 0) {
      yield* words(plan.refusal ?? CANT);
    } else {
      for (const [i, c] of plan.calls.entries()) {
        const call: ToolCall = { id: `mock_${i + 1}`, name: c.name, args: c.args };
        yield { type: "tool_call", call };
      }
    }
    yield { type: "usage", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async structured(req: StructuredRequest): Promise<StructuredResult> {
    const usage = { inputTokens: 0, outputTokens: 0 };
    if (req.system === INVOICE_DRAFT_SYSTEM) return { text: JSON.stringify(parseSalesNote(req.prompt)), usage };
    const facts = extractJson(req.prompt);
    if (req.system === REMINDER_SYSTEM) return { text: JSON.stringify({ message: reminderText(facts) }), usage };
    if (req.system === SUMMARY_SYSTEM) return { text: JSON.stringify({ narration: summaryText(facts) }), usage };
    return { text: "{}", usage };
  }
}

function extractJson(prompt: string): Record<string, unknown> {
  const m = /<<<UNTRUSTED DATA[^\n]*\n([\s\S]*?)\n<<<END UNTRUSTED DATA>>>/.exec(prompt);
  try {
    return m ? (JSON.parse(m[1]!) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const UNITS = "bags?|cartons?|ctns?|packs?|tins?|crates?|kegs?|pieces?|pcs|yards?|sets?|buckets?|units?|pouch(?:es)?|spools?|bottles?";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function naira(text: string | undefined): number {
  if (!text) return 0;
  const m = /([\d,.]+)\s*(k)?/i.exec(text);
  if (!m) return 0;
  return Math.round(Number(m[1]!.replace(/,/g, "")) * (m[2] ? 1000 : 1) * 100);
}

/** "Sell 3 bags of rice and 2 cartons of Indomie to Mama Chidi, delivery 2,000, due next Friday" */
export function parseSalesNote(prompt: string): Record<string, unknown> {
  const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(prompt)?.[1] ?? new Date().toISOString().slice(0, 10);
  const note = /<<<NOTE\n([\s\S]*?)\nNOTE>>>/.exec(prompt)?.[1] ?? prompt;
  const customer = /\b(?:to|for)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*)/.exec(note)?.[1] ?? "";
  const itemsPart = note.split(/\b(?:to|for)\s+[A-Z]/)[0] ?? note;
  const lines: { product_query: string; quantity: number }[] = [];
  for (const m of itemsPart.matchAll(new RegExp(`(\\d+)\\s*(?:(?:${UNITS})\\s+)?(?:of\\s+)?([A-Za-z][A-Za-z' -]*?)(?=\\s*(?:,|\\band\\b|$|\\d))`, "gi"))) {
    const product = m[2]!.replace(/^(sell|sold)\s+/i, "").trim();
    if (product && !/^(delivery|discount|due)/i.test(product)) lines.push({ product_query: product, quantity: Number(m[1]) });
  }
  const delivery = /delivery(?:\s+fee)?\s*(?:of|is|:)?\s*(?:₦|n)?\s*([\d,.]+\s*k?)/i.exec(note)?.[1];
  const discount = /discount\s*(?:of|is|:)?\s*(?:₦|n)?\s*([\d,.]+\s*k?)/i.exec(note)?.[1];
  let due: string | null = null;
  const dueText = /due\s+(.+?)(?:[,.]|$)/i.exec(note)?.[1]?.toLowerCase().trim() ?? "";
  const dayIndex = DAYS.findIndex((d) => dueText.includes(d));
  const todayIndex = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (dueText === "today") due = today;
  else if (dueText === "tomorrow") due = addDays(today, 1);
  else if (/in (\d+) days?/.test(dueText)) due = addDays(today, Number(/in (\d+) days?/.exec(dueText)![1]));
  else if (/\d{4}-\d{2}-\d{2}/.test(dueText)) due = /\d{4}-\d{2}-\d{2}/.exec(dueText)![0];
  else if (dayIndex >= 0) {
    let ahead = (dayIndex - todayIndex + 7) % 7 || 7;
    if (dueText.startsWith("next") && ahead < 7) ahead += 7;
    due = addDays(today, ahead);
  }
  return { customer_query: customer, lines, delivery_fee_kobo: naira(delivery), discount_kobo: naira(discount), due_date: due };
}

function reminderText(f: Record<string, unknown>): string {
  const name = String(f.customer ?? "there");
  const inv = String(f.invoice ?? "your invoice");
  const bal = String((f.balance as Money | undefined)?.naira ?? "");
  const due = String(f.due_date ?? "");
  const biz = String(f.business ?? "us");
  const bank = f.bank_details ? ` You can pay to ${String(f.bank_details)}.` : "";
  const pidgin = f.language === "pidgin";
  switch (f.tone) {
    case "final":
      return pidgin
        ? `Good day ${name}. Na ${biz} again. ${inv} wey be ${bal} don pass due since ${due}. Abeg make you settle am this week so we fit close am.${bank}`
        : `Dear ${name}, this is a final reminder from ${biz} that ${inv} (${bal}) has been due since ${due}. Please settle it this week so we can close the account.${bank}`;
    case "firm":
      return pidgin
        ? `Hello ${name}, ${biz} dey remind you say ${inv} wey be ${bal} don pass due (${due}). Abeg pay am as soon as you fit.${bank}`
        : `Hello ${name}, a reminder from ${biz}: ${inv} for ${bal} was due on ${due} and is still unpaid. Please pay as soon as possible.${bank}`;
    default:
      return pidgin
        ? `Hello ${name}! Na ${biz}. Small reminder say ${inv} (${bal}) don reach due date ${due}. Thank you as you dey always support us.${bank}`
        : `Hello ${name}, hope you're well! A gentle reminder from ${biz} that ${inv} for ${bal} was due on ${due}. Thank you for your custom.${bank}`;
  }
}

function summaryText(f: Record<string, unknown>): string {
  const w = (f.this_week ?? {}) as Record<string, unknown>;
  const l = (f.last_week ?? {}) as Record<string, unknown>;
  const owed = (f.owed_now ?? {}) as Money & { open_invoices?: number };
  const overdue = (f.overdue_now ?? {}) as Money & { invoices?: number };
  const low = Number(f.low_stock_count ?? 0);
  const parts = [
    `This week you sent ${w.invoices_sent ?? 0} invoices worth ${n(w.sales)}, compared with ${n(l.sales)} last week.`,
    `Payments received came to ${n(w.payments_received)}.`,
    `Customers owe ${n(owed)} on ${owed.open_invoices ?? 0} open invoices, and ${n(overdue)} of that is overdue across ${overdue.invoices ?? 0} invoices.`,
    low ? `${low} products are running low, so check the stock page before the weekend.` : "Stock levels look fine.",
    overdue.invoices ? "A short, polite reminder to the oldest overdue customers could bring in money this week." : "Keep it up.",
  ];
  if (w.estimated_profit) parts.splice(2, 0, `Estimated profit for the week is ${n(w.estimated_profit)}.`);
  return parts.join(" ");
}
