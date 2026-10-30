-- 001: identity, tenancy and system tables.
--
-- Conventions used in every migration:
--   * uuid primary keys (gen_random_uuid is built in since Postgres 13), so ids
--     can't be guessed or counted the way 1, 2, 3 can.
--   * timestamptz everywhere: one instant, rendered in Africa/Lagos by the app.
--   * CHECK constraints repeat the most important service rules so a bug or a
--     hand-written query still can't store an impossible row.

-- Trigram similarity: lets "Indomi" find "Indomie" and "mama chid" find
-- "Mama Chidi" (used by the customer and product search indexes in 002).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Keeps updated_at honest without every UPDATE having to remember it.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- People who can sign in. A user exists on its own and joins workspaces
-- through memberships, so one person can work for several businesses.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lower-cased so "Ada@x.com" and "ada@x.com" are one account.
  email         text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254 AND position('@' IN email) > 1),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- scrypt output and the per-user random salt that went into it.
  password_hash bytea NOT NULL,
  password_salt bytea NOT NULL,
  -- Demo sandbox users are deleted by the daily cron after 24 hours.
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
-- The cron's "demo users older than 24h" sweep reads only demo rows.
CREATE INDEX users_demo_created_idx ON users (created_at) WHERE is_demo;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A business. Everything a business owns carries workspace_id (tenancy).
CREATE TABLE workspaces (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- Fixed to naira: multi-currency is out of scope, and a CHECK says so loudly.
  currency            text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  -- Printed on invoices.
  business_address    text CHECK (length(business_address) <= 300),
  business_phone      text CHECK (length(business_phone) <= 30),
  business_email      text CHECK (length(business_email) <= 254),
  bank_details        text CHECK (length(bank_details) <= 300),
  invoice_prefix      text NOT NULL DEFAULT 'INV' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  -- The gapless counter. It is bumped by UPDATE ... RETURNING inside the same
  -- transaction that inserts the invoice: if the insert fails, the bump rolls
  -- back with it, so numbers never skip. The row lock taken by the UPDATE
  -- makes concurrent creators queue, so numbers never repeat either.
  next_invoice_number integer NOT NULL DEFAULT 1 CHECK (next_invoice_number >= 1),
  -- Used when a product has no low-stock level of its own.
  low_stock_default   integer NOT NULL DEFAULT 5 CHECK (low_stock_default BETWEEN 0 AND 100000),
  is_demo             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_demo_created_idx ON workspaces (created_at) WHERE is_demo;
CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Signed-in browsers. Only a SHA-256 hash of the cookie token is stored: if
-- this table ever leaks, the hashes can't be replayed as cookies.
CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deleting a user signs them out everywhere.
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash          bytea NOT NULL UNIQUE,
  -- The workspace this browser is working in. Kept server-side (never trusted
  -- from the URL or a form) and re-checked against memberships every request.
  -- Deleting the workspace just clears it, sending the user to /workspaces.
  active_workspace_id uuid REFERENCES workspaces (id) ON DELETE SET NULL,
  expires_at          timestamptz NOT NULL,
  -- Sliding expiry: extended when seen, at most once an hour.
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- "Sign out my other sessions" after a password change.
CREATE INDEX sessions_user_idx ON sessions (user_id);
-- The cron's expired-session sweep.
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Who belongs to which workspace, and as what.
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- One role per person per workspace.
  PRIMARY KEY (workspace_id, user_id)
);
-- "Which workspaces am I in?" on /workspaces.
CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every workspace keeps at least one owner. The service refuses to remove or
-- demote the last owner; this deferred trigger is the backstop. It runs at
-- COMMIT (not per statement) so "promote Ada, then demote me" in one
-- transaction is fine. Deleting the whole workspace is allowed: by commit
-- time the workspace row is gone, so there is nothing left to protect.
CREATE FUNCTION memberships_keep_an_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
     AND NOT EXISTS (SELECT 1 FROM memberships WHERE workspace_id = OLD.workspace_id AND role = 'owner') THEN
    RAISE EXCEPTION 'a workspace must keep at least one owner' USING ERRCODE = '23514', CONSTRAINT = 'memberships_keep_an_owner';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER memberships_keep_an_owner
  AFTER UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.role = 'owner')
  EXECUTE FUNCTION memberships_keep_an_owner();

-- Invitations by email. The link carries a random token; only its hash is
-- stored. Single use (accepted_at), revocable (revoked_at), 7-day expiry.
CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  role         text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  token_hash   bytea NOT NULL UNIQUE,
  -- History survives the inviter leaving.
  invited_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- An invite ends exactly one way.
  CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);
-- At most one open invite per email per workspace (re-inviting revokes the old one).
CREATE UNIQUE INDEX invitations_one_open_per_email ON invitations (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Fixed-window rate limiter shared by every serverless instance. In-memory
-- counters reset whenever a new instance starts and aren't shared between
-- instances, so they can't limit anything on serverless; one atomic upsert
-- per hit on this table can.
CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL CHECK (count >= 0),
  PRIMARY KEY (key, window_start)
);
-- The cron deletes old windows.
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

-- Who did what to which record. No sensitive values in details: ids, numbers
-- of the invoice, roles and counts, never passwords, tokens or notes.
CREATE TABLE audit_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Deleting a workspace deletes its history with it (that's the point of
  -- deleting all business data).
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- The event stays when the actor leaves; it then shows "former member".
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type   text NOT NULL,
  entity_id     uuid,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- The audit page: newest first, keyset-paged with id as the tie-breaker.
CREATE INDEX audit_events_ws_created_idx ON audit_events (workspace_id, created_at DESC, id DESC);

-- One row per job per day: makes the daily cron idempotent (a second run the
-- same day sees "ok" and skips) and gives a history of what it did.
CREATE TABLE cron_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job         text NOT NULL,
  run_date    date NOT NULL,
  status      text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (job, run_date)
);

-- Every email is written here first with a dedupe key (for example
-- "digest:<workspace>:2026-10-30"). A retry finds the row already sent
-- instead of emailing the owner twice.
CREATE TABLE email_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  dedupe_key   text NOT NULL UNIQUE,
  to_email     text NOT NULL,
  subject      text NOT NULL,
  body_text    text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
-- The sender picks up unsent mail.
CREATE INDEX email_outbox_pending_idx ON email_outbox (created_at) WHERE status <> 'sent';
