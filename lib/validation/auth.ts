import { z } from "zod";
import { email, text } from "@/lib/validation/common";

export const password = z
  .string({ error: "Enter a password." })
  .min(10, "Use at least 10 characters.")
  .max(200, "That password is too long.");

export const signUpSchema = z.object({
  name: text(80, "Your name"),
  email,
  password,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(200),
  next: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "The passwords don't match." });

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}
