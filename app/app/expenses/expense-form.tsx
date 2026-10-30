"use client";

import { useActionState } from "react";
import { saveExpenseAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/validation/business";
import { Field, SelectField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";

const LABELS = { category: "Category", amount: "Amount", spentOn: "Date", note: "Note", receiptRef: "Receipt reference" };

export function ExpenseForm({ today, requestId }: { today: string; requestId: string }) {
  const [state, action] = useActionState(saveExpenseAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={LABELS} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <SelectField name="category" label="Category" required defaultValue={v?.category ?? ""} errors={errors.category}>
        <option value="">Choose…</option>
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {EXPENSE_CATEGORY_LABELS[c]}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="amount" label="Amount (₦)" required inputMode="decimal" defaultValue={v?.amount ?? ""} errors={errors.amount} />
        <Field name="spentOn" label="Date" type="date" required defaultValue={v?.spentOn ?? today} errors={errors.spentOn} />
      </div>
      <Field name="note" label="Note" defaultValue={v?.note ?? ""} errors={errors.note} />
      <Field
        name="receiptRef"
        label="Receipt reference"
        hint="Where the paper receipt is, like “blue file, no. 41”."
        defaultValue={v?.receiptRef ?? ""}
        errors={errors.receiptRef}
      />
      <SubmitButton className="btn btn-primary w-full sm:w-auto">Record expense</SubmitButton>
    </form>
  );
}
