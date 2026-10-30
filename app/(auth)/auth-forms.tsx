"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, signUpAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { Field } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";

export function SignInForm({ email, next }: { email?: string; next?: string }) {
  const [state, action] = useActionState(signInAction, IDLE);
  const values = state.status === "error" ? state.values : {};
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={{ email: "Email", password: "Password" }} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={values.email ?? email ?? ""}
        errors={errors.email}
      />
      <Field name="password" label="Password" type="password" autoComplete="current-password" required errors={errors.password} />
      <SubmitButton pendingText="Signing in…" className="btn btn-primary w-full">
        Sign in
      </SubmitButton>
      <p className="text-sm text-ink-2">
        New here?{" "}
        <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}>Create an account</Link>
      </p>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUpAction, IDLE);
  const values = state.status === "error" ? state.values : {};
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={{ name: "Your name", email: "Email", password: "Password" }} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field name="name" label="Your name" autoComplete="name" required defaultValue={values.name ?? ""} errors={errors.name} />
      <Field name="email" label="Email" type="email" autoComplete="email" required defaultValue={values.email ?? ""} errors={errors.email} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters. A short sentence works well."
        errors={errors.password}
      />
      <SubmitButton pendingText="Creating account…" className="btn btn-primary w-full">
        Create account
      </SubmitButton>
      <p className="text-sm text-ink-2">
        Already have an account? <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}>Sign in</Link>
      </p>
    </form>
  );
}
