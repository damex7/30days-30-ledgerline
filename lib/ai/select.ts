import "server-only";
import { GeminiProvider } from "@/lib/ai/gemini";
import { MockProvider } from "@/lib/ai/mock";
import { providerConfig } from "@/lib/ai/config";
import { ProviderError, type AiProvider, type ChatRequest, type StreamChunk, type StructuredRequest, type StructuredResult } from "@/lib/ai/provider";
import { logInfo } from "@/lib/log";

// Picks the provider for one request and wraps it with the free-tier
// survival rules:
//   * a 429 / quota error is retried ONCE after a short backoff;
//   * if it fails again (or the provider can't be reached), the request is
//     answered by the mock instead, and the run is logged as fallback_mock
//     with a clear label in the UI;
//   * after a fallback, a 60-second breaker sends requests straight to the
//     mock instead of hammering a provider that just said "slow down".

let breakerUntil = 0;
const BACKOFF_MS = 900;

export interface ProviderSession {
  provider: AiProvider;
  /** What was configured. */
  configured: "gemini" | "mock";
  model: string;
  fastModel: string;
  /** True once this request had to fall back to the mock. */
  fellBack(): boolean;
  /** Provider and model that actually answered (for the run log). */
  actual(): { provider: string; model: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (e: unknown) => e instanceof ProviderError && (e.kind === "rate_limit" || e.kind === "unavailable");

class FallbackProvider implements AiProvider {
  readonly name = "gemini" as const;
  usedFallback = false;
  constructor(
    private readonly primary: AiProvider,
    private readonly backup: AiProvider,
  ) {}

  private fallBack(reason: string) {
    this.usedFallback = true;
    breakerUntil = Date.now() + 60_000;
    logInfo("ai fallback to mock", { reason });
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamChunk> {
    if (this.usedFallback || Date.now() < breakerUntil) {
      this.usedFallback = true;
      yield* this.backup.stream(req);
      return;
    }
    for (let attempt = 0; ; attempt++) {
      let started = false;
      try {
        for await (const chunk of this.primary.stream(req)) {
          started = true;
          yield chunk;
        }
        return;
      } catch (error) {
        // Mid-stream failures can't be replayed: the user already saw text.
        if (started || !retryable(error)) throw error;
        if (attempt === 0 && (error as ProviderError).kind === "rate_limit") {
          await sleep(BACKOFF_MS);
          continue;
        }
        this.fallBack((error as ProviderError).kind);
        yield* this.backup.stream(req);
        return;
      }
    }
  }

  async structured(req: StructuredRequest): Promise<StructuredResult> {
    if (this.usedFallback || Date.now() < breakerUntil) {
      this.usedFallback = true;
      return this.backup.structured(req);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.primary.structured(req);
      } catch (error) {
        if (!retryable(error)) throw error;
        if (attempt === 0 && (error as ProviderError).kind === "rate_limit") {
          await sleep(BACKOFF_MS);
          continue;
        }
        this.fallBack((error as ProviderError).kind);
        return this.backup.structured(req);
      }
    }
  }
}

/** One session per request. `primary` lets the check script inject a failing provider. */
export function openProviderSession(options: { primary?: AiProvider } = {}): ProviderSession {
  const config = providerConfig();
  const mock = new MockProvider();
  if (!options.primary && config.name === "mock") {
    return {
      provider: mock,
      configured: "mock",
      model: "mock-1",
      fastModel: "mock-1",
      fellBack: () => false,
      actual: () => ({ provider: "mock", model: "mock-1" }),
    };
  }
  const primary = options.primary ?? new GeminiProvider(process.env.GEMINI_API_KEY!);
  const wrapped = new FallbackProvider(primary, mock);
  const model = options.primary ? "gemini-3.5-flash-lite" : config.model;
  return {
    provider: wrapped,
    configured: "gemini",
    model,
    fastModel: options.primary ? model : config.fastModel,
    fellBack: () => wrapped.usedFallback,
    actual: () => (wrapped.usedFallback ? { provider: "mock", model: "mock-1" } : { provider: "gemini", model }),
  };
}

/** Test hook: the check script resets the breaker between scenarios. */
export function resetBreaker(): void {
  breakerUntil = 0;
}
