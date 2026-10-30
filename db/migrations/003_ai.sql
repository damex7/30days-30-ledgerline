-- 003: the AI assistant — run log, answers, proposals and feedback.
--
-- Two kinds of storage on purpose:
--   * ai_runs is the operational LOG of every model call (who, when, which
--     tools with which validated arguments, how many rows, tokens, latency,
--     cost, outcome). Logs get read by whoever operates the system, so it holds
--     no business data: no customer names, phone numbers, emails, amounts
--     from results, or secrets. The question is stored redacted.
--   * ai_answers and ai_proposals are BUSINESS DATA the user sees again
--     (their history, a draft invoice), like an invoice is. They live and die
--     with the workspace.

CREATE TABLE ai_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id                  uuid REFERENCES users (id) ON DELETE SET NULL,
  kind                     text NOT NULL CHECK (kind IN ('ask', 'invoice_draft', 'reminder', 'summary')),
  -- Emails, phone numbers, long digit strings and names seen in tool results
  -- are masked before this is written.
  question_text_redacted   text NOT NULL CHECK (length(question_text_redacted) <= 600),
  -- Which prompt version produced this run, so a change can be compared.
  prompt_version           text NOT NULL,
  -- [{ name, args (validated), rows, ms, outcome }]: never the returned rows.
  tool_calls               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'pending' is written BEFORE the model is called, so even a crash or a
  -- timeout leaves a trace; 'interrupted' is the Stop button.
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending', 'ok', 'invalid_output', 'refused', 'error', 'timeout',
                             'rate_limited', 'fallback_mock', 'tool_error', 'max_rounds', 'interrupted')),
  provider                 text NOT NULL,
  model                    text NOT NULL,
  input_tokens             integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens            integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  latency_ms               integer CHECK (latency_ms >= 0),
  -- What this run would cost on a paid tier, in millionths of a US dollar
  -- (integers again: no floats for money, even tiny money).
  estimated_cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_micro_usd >= 0),
  -- Idempotency: a double tap sends the same id and gets the same run back,
  -- never a second model call.
  client_request_id        uuid NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  UNIQUE (id, workspace_id),
  CONSTRAINT ai_runs_request_per_workspace UNIQUE (workspace_id, client_request_id)
);
-- History, usage per month and the settings page, newest first.
CREATE INDEX ai_runs_ws_created_idx ON ai_runs (workspace_id, created_at DESC, id DESC);

-- What the user saw: the answer text, the figures it was built from and any
-- figures the number check could not find in the tool results.
CREATE TABLE ai_answers (
  run_id       uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  question     text NOT NULL CHECK (length(question) <= 600),
  answer       text NOT NULL CHECK (length(answer) <= 8000),
  tools_used   text[] NOT NULL DEFAULT '{}',
  figures      jsonb NOT NULL DEFAULT '[]'::jsonb,
  unverified   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, workspace_id) REFERENCES ai_runs (id, workspace_id) ON DELETE CASCADE
);

-- "AI proposes, a person approves." A proposal is inert data: nothing in the
-- business tables changes until someone with permission approves it, and
-- approval re-validates everything through the normal invoice service.
CREATE TABLE ai_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id               uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('invoice')),
  -- The Zod-validated draft plus the server's match candidates.
  payload              jsonb NOT NULL,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_by           uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at           timestamptz,
  -- UNIQUE: one proposal can produce at most one invoice, ever.
  resulting_invoice_id uuid UNIQUE,
  expires_at           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, workspace_id) REFERENCES ai_runs (id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (resulting_invoice_id, workspace_id) REFERENCES invoices (id, workspace_id),
  CHECK ((status = 'approved') = (resulting_invoice_id IS NOT NULL)),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- The proposals panel and the cron's expiry sweep.
CREATE INDEX ai_proposals_ws_status_idx ON ai_proposals (workspace_id, status, created_at DESC);
CREATE TRIGGER ai_proposals_updated_at BEFORE UPDATE ON ai_proposals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Thumbs up/down; one vote per person per answer (changing your mind updates it).
CREATE TABLE ai_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  run_id       uuid NOT NULL,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating       text NOT NULL CHECK (rating IN ('up', 'down')),
  reason       text CHECK (length(reason) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, workspace_id) REFERENCES ai_runs (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT ai_feedback_one_per_user UNIQUE (run_id, user_id)
);
-- The owner's "thumbs-down reasons" list.
CREATE INDEX ai_feedback_ws_created_idx ON ai_feedback (workspace_id, created_at DESC) WHERE rating = 'down';
