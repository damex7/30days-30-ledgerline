// The provider interface: the ONLY shape the rest of the app knows. Messages,
// tool declarations, tool calls, tool results, structured-output requests,
// streamed chunks and token usage are all normalised here, so no file
// outside lib/ai/gemini.ts ever sees a vendor SDK type.
//
// Adding another provider (say an OpenAI-compatible one):
//   1. write lib/ai/<name>.ts implementing AiProvider (stream + structured),
//      translating these types to and from that vendor's SDK;
//   2. map its errors to ProviderError kinds (rate_limit, timeout, ...);
//   3. add a case in lib/ai/select.ts and a price row in lib/ai/pricing.ts.
// Nothing else changes: tools, guardrails, prompts and the UI stay the same.

export interface ToolCall {
  /** Provider's call id (or one we make up), echoed back with the result. */
  id: string;
  name: string;
  /** Raw arguments from the model: UNTRUSTED until a Zod schema accepts them. */
  args: unknown;
  /** Opaque provider data that must be sent back with this call (Gemini thought signatures). */
  signature?: string;
}

export interface ToolResult {
  callId: string;
  name: string;
  /** What the model sees; tool output is wrapped as UNTRUSTED DATA text. */
  content: string;
}

export type AiMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema generated from the tool's Zod schema. */
  parameters: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  tools: ToolDeclaration[];
  maxOutputTokens: number;
  signal?: AbortSignal | undefined;
}

export type StreamChunk = { type: "text"; text: string } | { type: "tool_call"; call: ToolCall } | { type: "usage"; usage: Usage };

export interface StructuredRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON Schema the output should follow (from a Zod schema). */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  signal?: AbortSignal | undefined;
}

export interface StructuredResult {
  /** Raw text, expected to be JSON: still UNTRUSTED, always Zod-validated by the caller. */
  text: string;
  usage: Usage;
}

export interface AiProvider {
  readonly name: "gemini" | "mock";
  stream(req: ChatRequest): AsyncIterable<StreamChunk>;
  structured(req: StructuredRequest): Promise<StructuredResult>;
}

export type ProviderErrorKind = "rate_limit" | "timeout" | "unavailable" | "refused" | "other";

export class ProviderError extends Error {
  override name = "ProviderError";
  readonly kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string = kind, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}
