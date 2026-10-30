import "server-only";

// Which AI provider is configured. 'mock' when asked for, or when there is
// no GEMINI_API_KEY (so the app always works, even with no key at all).
// At runtime the Gemini provider may still fall back to the mock after
// rate-limit errors; each answer is labelled with what actually answered.

export type ProviderName = "gemini" | "mock";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  fastModel: string;
  reason: string;
}

export function providerConfig(): ProviderConfig {
  const wanted = process.env.AI_PROVIDER === "mock" ? "mock" : "gemini";
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const model = process.env.AI_MODEL || "gemini-3.5-flash-lite";
  const fastModel = process.env.AI_FAST_MODEL || "gemini-3.1-flash-lite";
  if (wanted === "mock") return { name: "mock", model: "mock-1", fastModel: "mock-1", reason: "AI_PROVIDER is set to mock" };
  if (!hasKey) return { name: "mock", model: "mock-1", fastModel: "mock-1", reason: "no GEMINI_API_KEY is set" };
  return { name: "gemini", model, fastModel, reason: "Google Gemini (free tier)" };
}

export function providerLabel(config: ProviderConfig = providerConfig()): string {
  return config.name === "gemini" ? `Google Gemini · ${config.model}` : `Built-in mock assistant (${config.reason})`;
}
