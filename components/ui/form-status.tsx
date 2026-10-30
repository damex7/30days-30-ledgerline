"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/forms";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";

/**
 * Error summary at the top of a form. When a submit fails it takes focus,
 * so keyboard and screen-reader users land on "what went wrong", with a link
 * to each field. Success messages are announced politely instead.
 */
export function FormMessage({ state, labels = {} }: { state: FormState; labels?: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error") ref.current?.focus();
  }, [state]);

  if (state.status === "success") {
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border-2 border-ink bg-tint p-3">
        <CheckIcon className="mt-0.5 shrink-0" />
        <p>{state.message}</p>
      </div>
    );
  }
  if (state.status !== "error") return null;

  const fields = Object.entries(state.fieldErrors).filter(([key, msgs]) => key !== "form" && msgs?.length);
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-lg border-[3px] border-ink bg-page p-3">
      <h2 className="flex items-center gap-2 font-sans text-base font-bold">
        <AlertIcon className="shrink-0" />
        {state.message}
      </h2>
      {fields.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-8 text-sm">
          {fields.map(([key, msgs]) => (
            <li key={key}>
              <a href={`#f-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`} className="text-ink underline">
                {labels[key] ?? key}: {msgs?.join(" ")}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Submit button with a pending state; disabled while the action runs. */
export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = "btn btn-primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
