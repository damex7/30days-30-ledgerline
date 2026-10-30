"use client";

import { useActionState, useState } from "react";
import { draftInvoiceAction, reminderAction, summaryAction, type ReminderState, type SummaryState } from "./actions";
import { IDLE } from "@/lib/forms";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";
import { AlertIcon } from "@/components/ui/icons";
import { whatsappLink } from "@/components/app/whatsapp";

export function DraftInvoiceForm({ requestId, maxChars }: { requestId: string; maxChars: number }) {
  const [state, action] = useActionState(draftInvoiceAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={state} labels={{ text: "Sales note" }} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <TextareaField
        name="text"
        label="Describe the sale"
        required
        maxLength={maxChars}
        hint="For example: Sell 3 bags of rice and 2 cartons of Indomie to Mama Chidi, delivery 2,000, due next Friday"
        defaultValue={v?.text ?? ""}
        errors={errors.text}
      />
      <SubmitButton pendingText="Drafting…">Draft a proposal</SubmitButton>
      <p className="text-sm text-ink-2">Nothing is created yet: you&apos;ll check and approve the draft first.</p>
    </form>
  );
}

/** Each result carries the next idempotency key; a double tap reuses the current one. */
function requestIdFor(first: string, state: { nextRequestId?: string }): string {
  return state.nextRequestId ?? first;
}

export function ReminderForm({ invoices, firstRequestId }: { invoices: { id: string; label: string }[]; firstRequestId: string }) {
  const [state, action] = useActionState<ReminderState, FormData>(reminderAction, { status: "idle" });
  const requestId = requestIdFor(firstRequestId, state);
  const [copied, setCopied] = useState(false);
  if (invoices.length === 0) return <p className="text-ink-2">No invoices are overdue, so there&apos;s nobody to remind.</p>;
  return (
    <div className="space-y-4">
      <form
        action={action}
        className="space-y-3"
        onSubmit={() => setCopied(false)}
      >
        <input type="hidden" name="clientRequestId" value={requestId} />
        <SelectField name="invoiceId" label="Overdue invoice" required>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField name="tone" label="Tone" required defaultValue="polite">
            <option value="polite">Polite</option>
            <option value="firm">Firm</option>
            <option value="final">Final reminder</option>
          </SelectField>
          <SelectField name="language" label="Language" required defaultValue="english">
            <option value="english">English</option>
            <option value="pidgin">Nigerian Pidgin</option>
          </SelectField>
        </div>
        <SubmitButton pendingText="Writing…">Write reminder</SubmitButton>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border-[3px] border-ink p-2 font-semibold">
          <AlertIcon /> {state.message}
        </p>
      ) : null}
      {state.status === "ok" ? (
        <div className="space-y-2" role="status">
          <Field name="reminder-text" label="Reminder (edit before sending)" defaultValue={state.message} key={state.message} required readOnly={false} />
          {state.unverified.length ? (
            <p className="text-sm font-semibold">▲ Unverified figure(s): {state.unverified.join(", ")}. Check before sending.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const el = document.getElementById("f-reminder-text") as HTMLInputElement | null;
                void navigator.clipboard.writeText(el?.value ?? state.message).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <a className="btn btn-primary" href={whatsappLink(state.phone, state.message)} target="_blank" rel="noopener noreferrer">
              Open in WhatsApp<span className="sr-only"> (you press send yourself)</span>
            </a>
          </div>
          <p className="text-sm text-ink-2">Ledgerline never sends messages to customers by itself.{state.provider === "mock" ? " Written by the built-in mock." : ""}</p>
        </div>
      ) : null}
    </div>
  );
}

export function SummaryPanel({ firstRequestId }: { firstRequestId: string }) {
  const [state, action] = useActionState<SummaryState, FormData>(summaryAction, { status: "idle" });
  const requestId = requestIdFor(firstRequestId, state);
  return (
    <div className="space-y-4">
      <form action={action}>
        <input type="hidden" name="clientRequestId" value={requestId} />
        <SubmitButton pendingText="Summarising…">Summarise the last 7 days</SubmitButton>
      </form>
      {state.status === "error" ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border-[3px] border-ink p-2 font-semibold">
          <AlertIcon /> {state.message}
        </p>
      ) : null}
      {state.status === "ok" ? (
        <div className="space-y-3" role="status">
          <p className="whitespace-pre-line">{state.narration}</p>
          {state.unverified.length ? (
            <p className="flex items-start gap-2 rounded-lg border-[3px] border-ink p-2 text-sm">
              <AlertIcon className="shrink-0" /> Unverified figure(s): {state.unverified.join(", ")}. They aren&apos;t among the numbers below.
            </p>
          ) : null}
          <table className="w-full text-sm">
            <caption className="mb-1 text-left font-semibold">The numbers it used ({state.period}), computed by Ledgerline</caption>
            <tbody>
              {state.facts.map((f) => (
                <tr key={f.label} className="border-b border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">{f.label}</th>
                  <td className="num py-1">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.provider === "mock" ? <p className="text-sm text-ink-2">Narrated by the built-in mock.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
