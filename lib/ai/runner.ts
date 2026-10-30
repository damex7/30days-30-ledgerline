import "server-only";
import { z } from "zod";
import { db, transaction } from "@/lib/db";
import { enforce } from "@/lib/rate-limit";
import { RateLimitedError } from "@/lib/errors";
import { todayInLagos } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/permissions";
import { logError } from "@/lib/log";
import type { Ctx } from "@/lib/context";
import { ProviderError, type AiMessage, type AiProvider, type ToolCall, type ToolResult } from "@/lib/ai/provider";
import { openProviderSession } from "@/lib/ai/select";
import { declarationsFor, findTool, toolLabel } from "@/lib/ai/tools";
import { roleAllows } from "@/lib/ai/tools/types";
import { askSystemPrompt, PROMPT_VERSION } from "@/lib/ai/prompts";
import { checkNumbers, namesIn, redact, wrapUntrusted } from "@/lib/ai/guardrails";
import { estimateCostMicroUsd } from "@/lib/ai/pricing";
import * as L from "@/lib/ai/limits";
import { findRunByRequest, finishRun, insertRun, saveAnswer, type RunKind, type RunStatus, type ToolCallLog } from "@/lib/repos/ai-runs";

// One "Ask Ledgerline" question, end to end (diagram in the README):
// input checks -> idempotency -> rate limits -> run logged as pending ->
// model call with the tool list -> for each requested tool: known? allowed
// for this role? arguments valid (Zod)? -> run it read-only, scoped to the
// session's workspace, row-limited -> result back as UNTRUSTED DATA ->
// repeat, at most 4 rounds -> stream the answer -> number check -> log.

export type AskEvent =
  | { type: "run"; runId: string; provider: string; replay: boolean }
  | { type: "tool"; name: string; label: string; outcome: ToolCallLog["outcome"] }
  | { type: "text"; text: string }
  | { type: "done"; runId: string; status: RunStatus; fellBack: boolean; toolsUsed: string[]; figures: string[]; unverified: string[] }
  | { type: "error"; status: RunStatus; message: string; retryAfterSeconds?: number };

export interface AskOptions {
  signal?: AbortSignal;
  businessName: string;
  /** Check script only: replace the real provider (e.g. one that always 429s). */
  primary?: AiProvider;
  /** Check script only: skip per-user/workspace caps. */
  skipLimits?: boolean;
}

const STATUS_MESSAGES: Partial<Record<RunStatus, string>> = {
  max_rounds: "I couldn't finish working that out in a few steps, so I stopped. Try asking something more specific.",
  timeout: "That took too long, so I stopped. Please try again.",
  refused: "I can't help with that one.",
  error: "Something went wrong while I was answering. Please try again.",
};

/** Daily and per-minute caps. Counted only for new questions (never replays). */
export async function enforceAiLimits(ctx: Ctx): Promise<void> {
  await enforce({ key: `ai:user:${ctx.userId}:minute`, max: L.USER_PER_MINUTE, windowSeconds: 60 }, "You're asking quickly; take a short breather.");
  await enforce({ key: `ai:user:${ctx.userId}:day`, max: L.USER_PER_DAY, windowSeconds: 86_400 }, "You've reached today's assistant limit.");
  await enforce({ key: `ai:ws:${ctx.workspaceId}:day`, max: L.WORKSPACE_PER_DAY, windowSeconds: 86_400 }, "This business has reached today's assistant limit.");
}

function shapeKeys(schema: z.ZodType): Set<string> | null {
  return schema instanceof z.ZodObject ? new Set(Object.keys(schema.shape)) : null;
}

/** Validated args for the log: free text (names) masked. */
function loggableArgs(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? (k === "name" ? "[name]" : redact(v)) : v]),
  );
}

/** Runs one requested tool through every check. Never throws. */
export async function executeToolCall(ctx: Ctx, call: ToolCall, today: string): Promise<{ log: ToolCallLog; result: ToolResult; data: unknown }> {
  const started = Date.now();
  const tool = findTool(call.name);
  const reply = (log: Omit<ToolCallLog, "ms">, payload: Record<string, unknown>) => ({
    log: { ...log, ms: Date.now() - started },
    result: { callId: call.id, name: call.name, content: wrapUntrusted(call.name, payload) },
    data: payload,
  });
  if (!tool) {
    return reply({ name: call.name.slice(0, 60), args: null, rows: 0, outcome: "unknown_tool" }, { error: `There is no tool called ${call.name.slice(0, 60)}. Use only the tools listed.` });
  }
  if (!roleAllows(ctx.role, tool.minRole)) {
    return reply({ name: tool.name, args: null, rows: 0, outcome: "not_allowed" }, { error: "This person's role is not allowed to see this information. Tell them politely." });
  }
  const parsed = tool.schema.safeParse(call.args ?? {});
  if (!parsed.success) {
    return reply(
      { name: tool.name, args: null, rows: 0, outcome: "invalid_args" },
      { error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}` },
    );
  }
  // Extra keys (say "workspace_id": "<another business>") are dropped by Zod
  // and noted in the log; the workspace always comes from ctx.
  const known = shapeKeys(tool.schema);
  const ignoredKeys = known && call.args && typeof call.args === "object" ? Object.keys(call.args).filter((k) => !known.has(k)) : [];
  try {
    const output = await transaction((tx) => tool.run({ ctx, db: tx, today }, parsed.data), { readOnly: true, statementTimeoutMs: L.TOOL_STATEMENT_TIMEOUT_MS });
    return reply(
      { name: tool.name, args: loggableArgs(parsed.data), rows: Math.min(output.rows, tool.maxRows), outcome: "ok", ...(ignoredKeys.length ? { ignoredKeys } : {}) },
      output.data,
    );
  } catch (error) {
    logError("ai tool failed", error, { tool: tool.name });
    return reply({ name: tool.name, args: loggableArgs(parsed.data), rows: 0, outcome: "error" }, { error: "This tool failed; tell the user the information isn't available right now." });
  }
}

export async function* ask(ctx: Ctx, input: { question: string; clientRequestId: string }, options: AskOptions): AsyncGenerator<AskEvent> {
  const started = Date.now();
  const today = todayInLagos();

  // Idempotency: the same request id never causes a second model call.
  const existing = await findRunByRequest(db, ctx.workspaceId, input.clientRequestId);
  if (existing) {
    yield { type: "run", runId: existing.id, provider: existing.provider, replay: true };
    if (existing.answer) yield { type: "text", text: existing.answer };
    yield {
      type: "done",
      runId: existing.id,
      status: existing.status,
      fellBack: existing.provider === "mock",
      toolsUsed: existing.toolsUsed,
      figures: [],
      unverified: existing.unverified,
    };
    return;
  }

  const session = openProviderSession(options.primary ? { primary: options.primary } : {});
  const base = {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    kind: "ask" as RunKind,
    questionRedacted: redact(input.question),
    promptVersion: PROMPT_VERSION,
    provider: session.configured,
    model: session.model,
    clientRequestId: input.clientRequestId,
  };

  if (!options.skipLimits) {
    try {
      await enforceAiLimits(ctx);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        await insertRun(db, { ...base, status: "rate_limited" });
        yield { type: "error", status: "rate_limited", message: `${error.message} Try again in ${error.retryAfterSeconds} seconds.`, retryAfterSeconds: error.retryAfterSeconds };
        return;
      }
      throw error;
    }
  }

  // The run is recorded BEFORE the model is called.
  const runId = await insertRun(db, base);
  if (!runId) {
    yield { type: "error", status: "error", message: "This question is already being answered." };
    return;
  }
  yield { type: "run", runId, provider: session.configured, replay: false };

  const timeout = AbortSignal.timeout(L.REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const messages: AiMessage[] = [{ role: "user", text: input.question }];
  const tools = declarationsFor(ctx.role);
  const system = askSystemPrompt({ businessName: options.businessName, today, role: ROLE_LABELS[ctx.role].toLowerCase() });
  const logs: ToolCallLog[] = [];
  const toolData: unknown[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let answer = "";
  let status: RunStatus = "ok";

  try {
    for (let round = 1; ; round++) {
      let text = "";
      const calls: ToolCall[] = [];
      for await (const chunk of session.provider.stream({ model: session.model, system, messages, tools, maxOutputTokens: L.MAX_OUTPUT_TOKENS, signal })) {
        if (chunk.type === "text") {
          text += chunk.text;
          yield { type: "text", text: chunk.text };
        } else if (chunk.type === "tool_call") calls.push(chunk.call);
        else {
          usage.inputTokens += chunk.usage.inputTokens;
          usage.outputTokens += chunk.usage.outputTokens;
        }
      }
      answer += text;
      if (calls.length === 0) break;
      // A model that keeps asking for tools is stopped after 4 rounds.
      if (round >= L.MAX_TOOL_ROUNDS) {
        status = "max_rounds";
        break;
      }
      messages.push({ role: "assistant", text, toolCalls: calls.slice(0, 5) });
      const results: ToolResult[] = [];
      for (const call of calls.slice(0, 5)) {
        const done = await executeToolCall(ctx, call, today);
        logs.push(done.log);
        toolData.push(done.data);
        results.push(done.result);
        yield { type: "tool", name: done.log.name, label: toolLabel(done.log.name), outcome: done.log.outcome };
      }
      messages.push({ role: "tool", results });
    }
  } catch (error) {
    if (options.signal?.aborted) status = "interrupted";
    else if (timeout.aborted || (error instanceof ProviderError && error.kind === "timeout")) status = "timeout";
    else if (error instanceof ProviderError && error.kind === "refused") status = "refused";
    else if (error instanceof ProviderError && error.kind === "rate_limit") status = "rate_limited";
    else {
      status = "error";
      logError("ai ask failed", error, { runId });
    }
  }

  if (status === "ok") {
    if (logs.some((l) => l.outcome === "not_allowed")) status = "refused";
    else if (logs.some((l) => l.outcome !== "ok")) status = "tool_error";
    else if (session.fellBack()) status = "fallback_mock";
  }
  const message = STATUS_MESSAGES[status];
  if (message && status !== "refused" && !answer.trim()) {
    answer = message;
    yield { type: "text", text: message };
  } else if (status === "max_rounds") {
    answer += `\n\n${message}`;
    yield { type: "text", text: `\n\n${message}` };
  }

  const figures = status === "ok" || status === "fallback_mock" || status === "tool_error" || status === "refused" || status === "interrupted" ? checkNumbers(answer, toolData, input.question) : [];
  const unverified = figures.filter((f) => !f.verified).map((f) => f.text);
  const actual = session.actual();
  const toolsUsed = logs.filter((l) => l.outcome === "ok").map((l) => l.name);
  const finishedQuestion = redact(input.question, namesIn(toolData));

  await finishRun(db, {
    id: runId,
    workspaceId: ctx.workspaceId,
    status,
    toolCalls: logs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: Date.now() - started,
    costMicroUsd: estimateCostMicroUsd(actual.model, usage.inputTokens, usage.outputTokens),
    provider: actual.provider,
    model: actual.model,
    questionRedacted: finishedQuestion,
  }).catch((error: unknown) => logError("ai run log failed", error, { runId }));
  if (answer.trim()) {
    await saveAnswer(db, {
      runId,
      workspaceId: ctx.workspaceId,
      question: input.question,
      answer,
      toolsUsed,
      figures: figures.filter((f) => f.verified).map((f) => f.text),
      unverified,
    }).catch((error: unknown) => logError("ai answer save failed", error, { runId }));
  }

  yield { type: "done", runId, status, fellBack: session.fellBack(), toolsUsed, figures: figures.filter((f) => f.verified).map((f) => f.text), unverified };
}
