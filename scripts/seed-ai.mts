// A little assistant history and one pending proposal for the demo business.
// The seed never calls a real AI provider: it forces the built-in mock,
// which is deterministic local code (no network, no key).
import { randomUUID } from "node:crypto";
import type { Ctx } from "@/lib/context";
import { ask } from "@/lib/ai/runner";
import { draftInvoiceFromText } from "@/lib/services/assistant";

export async function seedAi(ctx: Ctx, _customers: string[], _products: { id: string }[]): Promise<void> {
  void _customers;
  void _products;
  const previous = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "mock";
  try {
    for (const question of ["Who owes me more than 50k?", "Which products are almost finished?", "How did this month compare to last month?", "What's the weather in Lagos?"]) {
      for await (const event of ask(ctx, { question, clientRequestId: randomUUID() }, { businessName: "Mama Ngozi Provisions", skipLimits: true })) {
        void event;
      }
    }
    const draft = await draftInvoiceFromText(
      ctx,
      { text: "Sell 3 bags of rice and 2 cartons of Indomie to Mama Chidi, delivery 2,000, due next Friday", clientRequestId: randomUUID() },
      { skipLimits: true },
    );
    console.log(`  assistant: 4 questions answered by the mock, ${draft.ok ? "1 pending proposal" : `no proposal (${draft.message})`}`);
  } finally {
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  }
}
