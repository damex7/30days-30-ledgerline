"use client";

import { useActionState } from "react";
import { recordPaymentAction, reversePaymentAction, sendInvoiceAction, voidInvoiceAction } from "../actions";
import { IDLE } from "@/lib/forms";
import { koboToInput } from "@/lib/money";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function SendForm({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState(sendInvoiceAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <SubmitButton pendingText="Sending…">Mark as sent</SubmitButton>
    </form>
  );
}

export function VoidForm({ invoiceId, hasStock }: { invoiceId: string; hasStock: boolean }) {
  const [state, action] = useActionState(voidInvoiceAction, IDLE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <ConfirmDialog trigger="Void invoice" title="Void this invoice?">
      <form action={action} className="space-y-3">
        <FormMessage state={state} labels={{ reason: "Reason" }} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <p className="text-ink-2">
          Voiding can&apos;t be undone. The number stays used, so the sequence has no gaps.
          {hasStock ? " Its items go back into stock." : ""}
        </p>
        <TextareaField name="reason" label="Reason" required rows={2} errors={errors.reason} />
        <SubmitButton className="btn btn-dark" pendingText="Voiding…">
          Void invoice
        </SubmitButton>
      </form>
    </ConfirmDialog>
  );
}

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "transfer", label: "Transfer" },
  { value: "pos", label: "POS" },
] as const;

/** Built for one hand: big targets, amount pre-filled with the balance. */
export function PaymentForm({ invoiceId, balanceKobo, today, requestId }: { invoiceId: string; balanceKobo: number; today: string; requestId: string }) {
  const [state, action] = useActionState(recordPaymentAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  const method = v?.method ?? "transfer";
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={{ amount: "Amount", method: "Method", paidOn: "Date", note: "Note" }} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <Field
        name="amount"
        label="Amount received (₦)"
        required
        inputMode="decimal"
        hint="Part payments are fine; it can't be more than the balance."
        defaultValue={v?.amount ?? koboToInput(balanceKobo)}
        errors={errors.amount}
        className="text-lg"
      />
      <fieldset aria-describedby={errors.method ? "method-error" : undefined}>
        <legend className="mb-1.5 font-semibold">How did they pay?</legend>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <label
              key={m.value}
              className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-[1.5px] border-field px-2 font-semibold has-[:checked]:border-[3px] has-[:checked]:border-ink has-[:checked]:bg-tint"
            >
              <input type="radio" name="method" value={m.value} defaultChecked={method === m.value} className="h-4 w-4 accent-current" />
              {m.label}
            </label>
          ))}
        </div>
        {errors.method ? (
          <p id="method-error" className="mt-1 text-sm font-semibold">
            ▲ {errors.method.join(" ")}
          </p>
        ) : null}
      </fieldset>
      <Field name="paidOn" label="Date received" type="date" required defaultValue={v?.paidOn ?? today} errors={errors.paidOn} />
      <Field name="note" label="Note" hint="For example the transfer reference." defaultValue={v?.note ?? ""} errors={errors.note} />
      <SubmitButton className="btn btn-primary w-full text-lg" pendingText="Recording…">
        Record payment
      </SubmitButton>
    </form>
  );
}

export function ReverseForm({ paymentId, invoiceId, requestId, label }: { paymentId: string; invoiceId: string; requestId: string; label: string }) {
  const [state, action] = useActionState(reversePaymentAction, IDLE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <ConfirmDialog trigger={<>Reverse<span className="sr-only"> payment of {label}</span></>} triggerClassName="btn btn-ghost min-h-9 px-2 py-1 text-sm underline" title={`Reverse the payment of ${label}?`}>
      <form action={action} className="space-y-3">
        <FormMessage state={state} labels={{ reason: "Reason" }} />
        <input type="hidden" name="paymentId" value={paymentId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="clientRequestId" value={requestId} />
        <p className="text-ink-2">Nothing is deleted: a reversal line is added and the balance goes back up.</p>
        <TextareaField name="reason" label="Reason" required rows={2} errors={errors.reason} />
        <SubmitButton className="btn btn-dark" pendingText="Reversing…">
          Reverse payment
        </SubmitButton>
      </form>
    </ConfirmDialog>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      Print
    </button>
  );
}
