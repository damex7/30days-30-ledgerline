import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { db, toDate } from "@/lib/db";
import { randomToken, tokenHashParam } from "@/lib/crypto";

// Sessions: the browser holds a random token in an httpOnly cookie; the
// database holds only SHA-256(token). Reading a session hashes the cookie and
// looks the hash up, so a leaked sessions table can't be replayed.
// Signing out deletes the row, which ends the session immediately everywhere
// it is checked (there is no signed token that stays valid until it expires).

export const SESSION_COOKIE = "ll_session";
export const SESSION_DAYS = 14;
const SLIDE_AFTER_MS = 60 * 60 * 1000; // extend at most once an hour

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  isDemo: boolean;
  activeWorkspaceId: string | null;
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true, // page JavaScript (and any injected script) can't read it
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: "lax" as const, // not sent on cross-site POSTs (CSRF), still sent on normal links
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Creates the row and returns the raw token (only ever sent to the browser). */
export async function createSession(userId: string, activeWorkspaceId: string | null): Promise<string> {
  const token = randomToken();
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, active_workspace_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, tokenHashParam(token), activeWorkspaceId, SESSION_DAYS],
  );
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86_400));
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
}

/** Looks a raw token up; also used by scripts that hold a token directly. */
export async function sessionFromToken(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const rows = await db.query<{
    id: string;
    user_id: string;
    email: string;
    name: string;
    is_demo: boolean;
    active_workspace_id: string | null;
    last_seen_at: unknown;
  }>(
    `SELECT s.id, s.user_id, u.email, u.name, u.is_demo, s.active_workspace_id, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHashParam(token)],
  );
  const row = rows[0];
  if (!row) return null;
  // Sliding expiry: an active user stays signed in; an idle one times out.
  if (Date.now() - toDate(row.last_seen_at).getTime() > SLIDE_AFTER_MS) {
    await db.query(
      "UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1",
      [row.id, SESSION_DAYS],
    );
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    isDemo: row.is_demo,
    activeWorkspaceId: row.active_workspace_id,
  };
}

/** The signed-in user for this request, or null. Cached per request only:
 *  revoking a session must take effect on the very next request. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sessionFromToken(token) : null;
});

export async function deleteSession(sessionId: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

export async function deleteOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [userId, keepSessionId]);
}

export async function setActiveWorkspace(sessionId: string, workspaceId: string | null): Promise<void> {
  await db.query("UPDATE sessions SET active_workspace_id = $2 WHERE id = $1", [sessionId, workspaceId]);
}
