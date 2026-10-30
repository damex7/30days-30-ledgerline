import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes as URL-safe text: unguessable session and invite tokens. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Tokens are stored only as SHA-256 hashes. A database leak then reveals
 * hashes, which can't be turned back into a working cookie or invite link.
 * A fast hash is fine here (unlike passwords) because the token is 256 random
 * bits: there is nothing to guess.
 */
export function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/** Bytes as a bytea parameter ('\x...' hex text, which Postgres accepts). */
export function byteaParam(bytes: Buffer): string {
  return "\\x" + bytes.toString("hex");
}

/** The token's hash as a bytea parameter. */
export function tokenHashParam(token: string): string {
  return byteaParam(sha256(token));
}
