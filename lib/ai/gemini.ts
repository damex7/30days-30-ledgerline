import "server-only";
import { ApiError, GoogleGenAI, FunctionCallingConfigMode, type Content, type Part } from "@google/genai";
import {
  ProviderError,
  type AiMessage,
  type AiProvider,
  type ChatRequest,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from "@/lib/ai/provider";

// The ONLY file that imports the Gemini SDK. It translates our normalised
// messages into Gemini "contents", streams text and function calls back as
// StreamChunks, and maps SDK errors onto ProviderError kinds.
//
// Function calling: tools are declared with parametersJsonSchema (JSON Schema
// from our Zod schemas). We never let the SDK call functions automatically;
// it hands us the call and OUR runner decides whether to run it.
// Gemini 3 models attach a thoughtSignature to function-call parts that must
// be sent back unchanged on the next turn; ToolCall.signature carries it.
//
// Structured output: responseMimeType application/json + responseJsonSchema.
// Gemini constrains decoding to that shape, but the caller STILL validates
// with Zod (output can be cut off, and not every keyword is enforced).

function toContents(messages: AiMessage[]): Content[] {
  return messages.map((m): Content => {
    if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
    if (m.role === "assistant") {
      const parts: Part[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const call of m.toolCalls) {
        parts.push({
          functionCall: { id: call.id, name: call.name, args: (call.args ?? {}) as Record<string, unknown> },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        });
      }
      return { role: "model", parts };
    }
    return {
      role: "user",
      parts: m.results.map((r) => ({ functionResponse: { id: r.callId, name: r.name, response: { result: r.content } } })),
    };
  });
}

function withoutMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...schema };
  delete rest.$schema;
  return rest;
}

function normalise(error: unknown, signal: AbortSignal | undefined): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal?.aborted) return new ProviderError("timeout", "request aborted", { cause: error });
  if (error instanceof ApiError) {
    if (error.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(error.message)) return new ProviderError("rate_limit", "rate limited", { cause: error });
    if (error.status === 408 || error.status === 504) return new ProviderError("timeout", `http ${error.status}`, { cause: error });
    if (error.status === 503 || error.status === 500) return new ProviderError("unavailable", `http ${error.status}`, { cause: error });
    return new ProviderError("other", `http ${error.status}`, { cause: error });
  }
  if (error instanceof Error && /429|RESOURCE_EXHAUSTED/.test(error.message)) return new ProviderError("rate_limit", "rate limited", { cause: error });
  const code = (error as { cause?: { code?: unknown } })?.cause?.code;
  if (error instanceof TypeError || (typeof code === "string" && /^(ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR)/.test(code))) {
    return new ProviderError("unavailable", "network error", { cause: error });
  }
  return new ProviderError("other", "provider error", { cause: error });
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey }); // server-only; never sent to a browser
  }

  async *stream(req: ChatRequest): AsyncIterable<StreamChunk> {
    let response: AsyncGenerator<import("@google/genai").GenerateContentResponse>;
    try {
      response = await this.client.models.generateContentStream({
        model: req.model,
        contents: toContents(req.messages),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens,
          temperature: 0.2,
          abortSignal: req.signal,
          tools: req.tools.length
            ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: withoutMeta(t.parameters) })) }]
            : undefined,
          toolConfig: req.tools.length ? { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } : undefined,
          automaticFunctionCalling: { disable: true },
        },
      });
    } catch (error) {
      throw normalise(error, req.signal);
    }
    let usage = { inputTokens: 0, outputTokens: 0 };
    let blocked = false;
    let n = 0;
    try {
      for await (const chunk of response) {
        if (chunk.promptFeedback?.blockReason) blocked = true;
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought) continue; // never show internal reasoning
          if (part.functionCall?.name) {
            yield {
              type: "tool_call",
              call: {
                id: part.functionCall.id ?? `call_${++n}`,
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
                ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
              },
            };
          } else if (part.text) {
            yield { type: "text", text: part.text };
          }
        }
        const meta = chunk.usageMetadata;
        if (meta) {
          usage = {
            inputTokens: meta.promptTokenCount ?? usage.inputTokens,
            outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) || usage.outputTokens,
          };
        }
      }
    } catch (error) {
      throw normalise(error, req.signal);
    }
    if (blocked) throw new ProviderError("refused", "safety block");
    yield { type: "usage", usage };
  }

  async structured(req: StructuredRequest): Promise<StructuredResult> {
    try {
      const response = await this.client.models.generateContent({
        model: req.model,
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens,
          temperature: 0,
          abortSignal: req.signal,
          responseMimeType: "application/json",
          responseJsonSchema: withoutMeta(req.jsonSchema),
        },
      });
      if (response.promptFeedback?.blockReason) throw new ProviderError("refused", "safety block");
      const meta = response.usageMetadata;
      return {
        text: response.text ?? "",
        usage: { inputTokens: meta?.promptTokenCount ?? 0, outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0) },
      };
    } catch (error) {
      throw normalise(error, req.signal);
    }
  }
}
