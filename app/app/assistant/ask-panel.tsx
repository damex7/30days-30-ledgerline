"use client";

import { useRef, useState } from "react";
import { feedbackAction } from "./actions";
import { AlertIcon, CheckIcon, ThumbIcon, ToolIcon } from "@/components/ui/icons";

// The chat. Answers stream in as text, but screen readers are NOT read every
// token: a separate polite live region announces the answer once, when it is
// complete. Tool use is shown as text chips ("Checked overdue invoices").

type ToolChip = { name: string; label: string; outcome: string };

export interface Exchange {
  key: string;
  runId: string | null;
  question: string;
  answer: string;
  tools: ToolChip[];
  status: "streaming" | "done" | "error" | "stopped";
  runStatus?: string;
  unverified: string[];
  fellBack: boolean;
  rating: "up" | "down" | null;
}

const SUGGESTIONS = [
  "Who owes me more than 50k?",
  "Which products are almost finished?",
  "How did this month compare to last month?",
  "Wetin I sell this week?",
  "Which invoices are overdue?",
];

const OUTCOME_TEXT: Record<string, string> = {
  ok: "",
  unknown_tool: " (refused: unknown tool)",
  invalid_args: " (refused: invalid request)",
  not_allowed: " (refused: not allowed for your role)",
  error: " (failed)",
};

export function AskPanel({ initial, maxChars }: { initial: Exchange[]; maxChars: number }) {
  const [items, setItems] = useState<Exchange[]>(initial);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const update = (key: string, patch: Partial<Exchange> | ((e: Exchange) => Partial<Exchange>)) =>
    setItems((list) => list.map((e) => (e.key === key ? { ...e, ...(typeof patch === "function" ? patch(e) : patch) } : e)));

  async function submit(text: string) {
    const q = text.trim();
    if (q.length < 2) {
      setInputError("Type a question first.");
      input.current?.focus();
      return;
    }
    if (q.length > maxChars) {
      setInputError(`Keep it under ${maxChars} characters.`);
      return;
    }
    setInputError(null);
    const key = crypto.randomUUID();
    const entry: Exchange = { key, runId: null, question: q, answer: "", tools: [], status: "streaming", unverified: [], fellBack: false, rating: null };
    setItems((list) => [entry, ...list]);
    setBusy(true);
    setAnnounce("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, clientRequestId: key }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        update(key, { status: "error", answer: body.error ?? "The assistant couldn't be reached. Your question is still in the box." });
        setQuestion(q);
        setAnnounce(body.error ?? "The assistant couldn't be reached.");
        return;
      }
      setQuestion("");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalText = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as Record<string, unknown>;
          if (ev.type === "run") update(key, { runId: String(ev.runId) });
          else if (ev.type === "tool") update(key, (e) => ({ tools: [...e.tools, { name: String(ev.name), label: String(ev.label), outcome: String(ev.outcome) }] }));
          else if (ev.type === "text") {
            finalText += String(ev.text);
            update(key, (e) => ({ answer: e.answer + String(ev.text) }));
          } else if (ev.type === "done") {
            const unverified = (ev.unverified as string[]) ?? [];
            update(key, { status: "done", runStatus: String(ev.status), unverified, fellBack: Boolean(ev.fellBack) });
            setAnnounce(`Answer ready. ${finalText}${unverified.length ? ` Note: ${unverified.length} figure(s) could not be verified.` : ""}`);
          } else if (ev.type === "error") {
            update(key, { status: "error", answer: String(ev.message), runStatus: String(ev.status) });
            setQuestion(q);
            setAnnounce(String(ev.message));
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        update(key, { status: "stopped" });
        setAnnounce("Stopped.");
      } else {
        update(key, { status: "error", answer: "The connection dropped. Your question is back in the box; try again." });
        setQuestion(q);
        setAnnounce("The connection dropped.");
        console.error(error);
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <label htmlFor="question" className="block font-semibold">
          Ask about your business
        </label>
        <p id="question-hint" className="text-sm text-ink-2">
          English or Pidgin. I only read your records: I can&apos;t change anything or message customers.
        </p>
        <textarea
          ref={input}
          id="question"
          rows={2}
          className="field"
          value={question}
          maxLength={maxChars + 50}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void submit(question);
            }
          }}
          aria-describedby={`question-hint question-count${inputError ? " question-error" : ""}`}
          aria-invalid={inputError ? true : undefined}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="question-count" className="text-sm text-ink-2">
            {question.length}/{maxChars}
          </p>
          <div className="flex gap-2">
            {busy ? (
              <button type="button" className="btn btn-dark" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Thinking…" : "Ask"}
            </button>
          </div>
        </div>
        {inputError ? (
          <p id="question-error" className="font-semibold">
            ▲ {inputError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2" aria-label="Example questions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="btn btn-secondary min-h-9 px-3 py-1 text-sm" disabled={busy} onClick={() => void submit(s)}>
              {s}
            </button>
          ))}
        </div>
      </form>

      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      <ol className="space-y-4" aria-label="Answers, newest first">
        {items.map((e) => (
          <li key={e.key} className="card p-4">
            <p className="font-semibold">
              <span className="sr-only">You asked: </span>
              {e.question}
            </p>
            {e.tools.length ? (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="What the assistant checked">
                {e.tools.map((t, i) => (
                  <li key={i} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm ${t.outcome === "ok" ? "border-field" : "border-[3px] border-double border-ink"}`}>
                    {t.outcome === "ok" ? <ToolIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
                    {t.label}
                    {OUTCOME_TEXT[t.outcome] ?? ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 whitespace-pre-line" aria-busy={e.status === "streaming"}>
              {e.answer || (e.status === "streaming" ? <span className="text-ink-2">Checking your records…</span> : null)}
            </div>
            {e.status === "stopped" ? <p className="mt-2 text-sm text-ink-2">Stopped. The partial answer was saved as interrupted.</p> : null}
            {e.unverified.length ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border-[3px] border-ink p-2 text-sm" role="note">
                <AlertIcon className="mt-0.5 shrink-0" />
                <p>
                  <strong>Unverified figure{e.unverified.length > 1 ? "s" : ""}:</strong> {e.unverified.join(", ")}. These numbers don&apos;t appear in the records the
                  assistant checked. Treat them with care and check the reports.
                </p>
              </div>
            ) : null}
            {e.status === "done" ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-2">
                {e.fellBack ? <span className="rounded border border-dashed border-ink px-2 py-0.5">Answered by the built-in mock (the AI provider was busy or unreachable)</span> : null}
                {e.runId ? <Feedback runId={e.runId} initial={e.rating} /> : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Feedback({ runId, initial }: { runId: string; initial: "up" | "down" | null }) {
  const [rating, setRating] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const send = async (r: "up" | "down", why?: string) => {
    setRating(r);
    const res = await feedbackAction({ runId, rating: r, ...(why ? { reason: why } : {}) });
    setSaved(res.ok);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>Was this helpful?</span>
      <button type="button" aria-pressed={rating === "up"} className={`btn min-h-9 px-2 py-1 ${rating === "up" ? "btn-dark" : "btn-secondary"}`} onClick={() => void send("up")}>
        <ThumbIcon /> <span className="sr-only">Yes, helpful</span>
      </button>
      <button
        type="button"
        aria-pressed={rating === "down"}
        className={`btn min-h-9 px-2 py-1 ${rating === "down" ? "btn-dark" : "btn-secondary"}`}
        onClick={() => {
          setAsking(true);
          void send("down");
        }}
      >
        <ThumbIcon down /> <span className="sr-only">No, not helpful</span>
      </button>
      {asking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send("down", reason);
            setAsking(false);
          }}
        >
          <label htmlFor={`why-${runId}`} className="sr-only">
            What was wrong?
          </label>
          <input id={`why-${runId}`} className="field min-h-9 py-1" placeholder="What was wrong? (optional)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="btn btn-secondary min-h-9 py-1">
            Send
          </button>
        </form>
      ) : null}
      {saved ? (
        <span role="status" className="inline-flex items-center gap-1">
          <CheckIcon className="h-4 w-4" /> Thanks
        </span>
      ) : null}
    </div>
  );
}
