import "server-only";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Passwords are hashed with scrypt, which is deliberately slow and
// memory-hungry so a stolen table can't be brute-forced quickly. Each user
// gets their own random salt, so two people with the same password have
// different hashes and one precomputed table can't crack everyone.

const KEY_LENGTH = 64;
const OPTIONS: ScryptOptions = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, OPTIONS, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<{ hash: Buffer; salt: Buffer }> {
  const salt = randomBytes(16);
  return { hash: await scrypt(password, salt), salt };
}

/** Constant-time comparison: how long it takes reveals nothing about the hash. */
export async function verifyPassword(password: string, hash: Buffer, salt: Buffer): Promise<boolean> {
  const candidate = await scrypt(password, salt);
  return candidate.length === hash.length && timingSafeEqual(candidate, hash);
}

// Used when the email doesn't exist, so "no such user" takes as long as
// "wrong password" and response times don't reveal which emails have accounts.
const DUMMY_SALT = randomBytes(16);
let dummyHash: Promise<Buffer> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= scrypt("not-a-real-password", DUMMY_SALT);
  const hash = await dummyHash;
  await verifyPassword(password, hash, DUMMY_SALT);
}
