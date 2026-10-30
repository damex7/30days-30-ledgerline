import "server-only";
import { db, int, intOrNull, toDate, type Db } from "@/lib/db";

export type RunKind = "ask" | "invoice_draft" | "reminder" | "summary";
export type RunStatus =
  | "pending"
  | "ok"
  | "invalid_output"
  | "refused"
  | "error"
  | "timeout"
  | "rate_limited"
  | "fallback_mock"
  | "tool_error"
  | "max_rounds"
  | "interrupted";

/** What is logged per tool call. NEVER the rows the tool returned. */
export interface ToolCallLog {
  name: string;
  args: unknown;
  rows: number;
  ms: number;
  outcome: "ok" | "unknown_tool" | "invalid_args" | "not_allowed" | "error";
  ignoredKeys?: string[];
}

export async function findRunByRequest(client: Db, workspaceId: string, clientRequestId: string) {
  const rows = await client.query<Record<string, unknown>>(
    `SELECT r.id, r.status, r.kind, r.provider, a.answer, a.tools_used, a.unverified
       FROM ai_runs r LEFT JOIN ai_answers a ON a.run_id = r.id
      WHERE r.workspace_id = $1 AND r.client_request_id = $2`,
    [workspaceId, clientRequestId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    status: r.status as RunStatus,
    kind: r.kind as RunKind,
    provider: String(r.provider),
    answer: (r.answer as string | null) ?? null,
    toolsUsed: (r.tools_used as string[] | null) ?? [],
    unverified: (r.unverified as string[] | null) ?? [],
  };
}

/** Written BEFORE the model is called; null if this request id already exists. */
export async function insertRun(
  client: Db,
  v: { workspaceId: string; userId: string; kind: RunKind; questionRedacted: string; promptVersion: string; provider: string; model: string; clientRequestId: string; status?: RunStatus },
): Promise<string | null> {
  const rows = await client.query<{ id: string }>(
    `INSERT INTO ai_runs (workspace_id, user_id, kind, question_text_redacted, prompt_version, provider, model, client_request_id, status, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9 = 'pending' THEN NULL ELSE now() END)
     ON CONFLICT ON CONSTRAINT ai_runs_request_per_workspace DO NOTHING RETURNING id`,
    [v.workspaceId, v.userId, v.kind, v.questionRedacted, v.promptVersion, v.provider, v.model, v.clientRequestId, v.status ?? "pending"],
  );
  return rows[0]?.id ?? null;
}

export async function finishRun(
  client: Db,
  v: {
    id: string;
    workspaceId: string;
    status: RunStatus;
    toolCalls: ToolCallLog[];
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    costMicroUsd: number;
    provider: string;
    model: string;
    questionRedacted: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE ai_runs SET status = $3, tool_calls = $4, input_tokens = $5, output_tokens = $6, latency_ms = $7,
            estimated_cost_micro_usd = $8, provider = $9, model = $10, question_text_redacted = $11, finished_at = now()
      WHERE id = $1 AND workspace_id = $2`,
    [v.id, v.workspaceId, v.status, JSON.stringify(v.toolCalls), v.inputTokens, v.outputTokens, v.latencyMs, v.costMicroUsd, v.provider, v.model, v.questionRedacted],
  );
}

export async function saveAnswer(
  client: Db,
  v: { runId: string; workspaceId: string; question: string; answer: string; toolsUsed: string[]; figures: string[]; unverified: string[] },
): Promise<void> {
  await client.query(
    `INSERT INTO ai_answers (run_id, workspace_id, question, answer, tools_used, figures, unverified)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (run_id) DO NOTHING`,
    [v.runId, v.workspaceId, v.question.slice(0, 600), v.answer.slice(0, 8000), v.toolsUsed, JSON.stringify(v.figures), JSON.stringify(v.unverified)],
  );
}

export interface HistoryItem {
  runId: string;
  kind: RunKind;
  status: RunStatus;
  provider: string;
  question: string;
  answer: string;
  toolsUsed: string[];
  unverified: string[];
  createdAt: Date;
  myRating: "up" | "down" | null;
}

export async function history(workspaceId: string, userId: string, limit: number): Promise<HistoryItem[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT r.id, r.kind, r.status, r.provider, a.question, a.answer, a.tools_used, a.unverified, r.created_at, f.rating
       FROM ai_runs r JOIN ai_answers a ON a.run_id = r.id
       LEFT JOIN ai_feedback f ON f.run_id = r.id AND f.user_id = $2
      WHERE r.workspace_id = $1 AND r.user_id = $2 AND r.kind = 'ask'
      ORDER BY r.created_at DESC, r.id DESC LIMIT $3`,
    [workspaceId, userId, limit],
  );
  return rows.map((r) => ({
    runId: String(r.id),
    kind: r.kind as RunKind,
    status: r.status as RunStatus,
    provider: String(r.provider),
    question: String(r.question),
    answer: String(r.answer),
    toolsUsed: (r.tools_used as string[]) ?? [],
    unverified: (r.unverified as string[]) ?? [],
    createdAt: toDate(r.created_at),
    myRating: (r.rating as "up" | "down" | null) ?? null,
  }));
}

export interface UsageRow {
  kind: RunKind;
  status: RunStatus;
  provider: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  avgLatencyMs: number | null;
}

export async function usageSince(workspaceId: string, since: string): Promise<UsageRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT kind, status, provider, count(*) AS runs, COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o,
            COALESCE(SUM(estimated_cost_micro_usd), 0) AS c, round(avg(latency_ms)) AS l
       FROM ai_runs WHERE workspace_id = $1 AND created_at >= $2::date
      GROUP BY kind, status, provider ORDER BY runs DESC`,
    [workspaceId, since],
  );
  return rows.map((r) => ({
    kind: r.kind as RunKind,
    status: r.status as RunStatus,
    provider: String(r.provider),
    runs: int(r.runs),
    inputTokens: int(r.i),
    outputTokens: int(r.o),
    costMicroUsd: int(r.c),
    avgLatencyMs: intOrNull(r.l),
  }));
}
