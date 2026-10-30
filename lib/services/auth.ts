import "server-only";
import { db, isUniqueViolation } from "@/lib/db";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, deleteOtherSessions } from "@/lib/auth/session";
import { enforce, reset } from "@/lib/rate-limit";
import { byteaParam } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";

// Accounts. Error messages are generic on purpose: "email or password is
// wrong" and "if this email is new, your account is ready" read the same
// whether or not an account exists, so the forms can't be used to find out
// who has a Ledgerline account.

const GENERIC_SIGN_IN = "That email and password don't match an account.";

export async function signUp(input: { name: string; email: string; password: string }): Promise<void> {
  const { hash, salt } = await hashPassword(input.password);
  try {
    await db.query("INSERT INTO users (email, name, password_hash, password_salt) VALUES ($1, $2, $3, $4)", [
      input.email,
      input.name,
      byteaParam(hash),
      byteaParam(salt),
    ]);
  } catch (error) {
    // Already registered: say nothing different (see above).
    if (!isUniqueViolation(error, "users_email_key")) throw error;
  }
}

/**
 * Checks the password and opens a session. Rate limited per email (slow down
 * guessing one account) and per IP (slow down trying many accounts).
 * Returns the raw token for the cookie and where to go next.
 */
export async function signIn(
  input: { email: string; password: string },
  ip: string,
): Promise<{ token: string; userId: string; workspaceId: string | null }> {
  await enforce({ key: `signin:email:${input.email}`, max: 5, windowSeconds: 900 }, "Too many sign-in attempts for this email.");
  await enforce({ key: `signin:ip:${ip}`, max: 30, windowSeconds: 900 }, "Too many sign-in attempts from this network.");

  const rows = await db.query<{ id: string; password_hash: Buffer; password_salt: Buffer }>(
    "SELECT id, password_hash, password_salt FROM users WHERE email = $1",
    [input.email],
  );
  const user = rows[0];
  if (!user) {
    await burnPasswordCheck(input.password);
    throw new ValidationError(GENERIC_SIGN_IN);
  }
  if (!(await verifyPassword(input.password, toBuffer(user.password_hash), toBuffer(user.password_salt)))) {
    throw new ValidationError(GENERIC_SIGN_IN);
  }
  await reset(`signin:email:${input.email}`);

  // One workspace: go straight in. Several: let them choose.
  const memberships = await db.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 2",
    [user.id],
  );
  const workspaceId = memberships.length === 1 ? (memberships[0]?.workspace_id ?? null) : null;
  return { token: await createSession(user.id, workspaceId), userId: user.id, workspaceId };
}

/** Changing the password signs out every other session (a thief's included). */
export async function changePassword(
  user: { userId: string; sessionId: string },
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  await enforce({ key: `password:${user.userId}`, max: 5, windowSeconds: 900 }, "Too many attempts.");
  const rows = await db.query<{ password_hash: Buffer; password_salt: Buffer }>(
    "SELECT password_hash, password_salt FROM users WHERE id = $1",
    [user.userId],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(input.currentPassword, toBuffer(row.password_hash), toBuffer(row.password_salt)))) {
    throw new ValidationError("Your current password is not right.", { currentPassword: ["Your current password is not right."] });
  }
  const { hash, salt } = await hashPassword(input.newPassword);
  await db.query("UPDATE users SET password_hash = $2, password_salt = $3 WHERE id = $1", [
    user.userId,
    byteaParam(hash),
    byteaParam(salt),
  ]);
  await deleteOtherSessions(user.userId, user.sessionId);
}

/** bytea arrives as a Buffer from the WebSocket driver or "\x..." text over HTTP. */
export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  const text = String(value);
  return Buffer.from(text.startsWith("\\x") ? text.slice(2) : text, "hex");
}
