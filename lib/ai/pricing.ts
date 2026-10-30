// What a run WOULD cost on a paid tier. The free tier costs nothing, but the
// settings page shows this so an owner knows what production would cost.
// Prices are integer micro-dollars (µ$, millionths of a US dollar) per
// million tokens: integers again, even for tiny amounts of money.
// Source: ai.google.dev/gemini-api/docs/pricing (standard tier, text),
// checked October 2026. Update this table when prices change.

export const PRICES_MICRO_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 300_000, output: 2_500_000 },
  "gemini-3.1-flash-lite": { input: 250_000, output: 1_500_000 },
  "mock-1": { input: 0, output: 0 },
};

/** Rounded up to a whole µ$, all in integers. */
export function estimateCostMicroUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_MICRO_USD_PER_MILLION[model];
  if (!price) return 0;
  const total = inputTokens * price.input + outputTokens * price.output;
  return Math.ceil(total / 1_000_000);
}

/** 1_234_567 µ$ -> "$1.2346" (display only). */
export function formatMicroUsd(micro: number): string {
  const dollars = Math.trunc(micro / 1_000_000);
  const fraction = String(micro % 1_000_000).padStart(6, "0").slice(0, 4);
  return `$${dollars}.${fraction}`;
}
