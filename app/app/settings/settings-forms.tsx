"use client";

import { useActionState } from "react";
import { changePasswordAction, deleteWorkspaceAction, saveDetailsAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { WorkspaceDetailsInput } from "@/lib/validation/workspace";

const LABELS = {
  name: "Business name",
  businessAddress: "Address",
  businessPhone: "Phone",
  businessEmail: "Email",
  bankDetails: "Bank details",
  invoicePrefix: "Invoice prefix",
  lowStockDefault: "Default low-stock level",
};

export function DetailsForm({ defaults }: { defaults: WorkspaceDetailsInput }) {
  const [state, action] = useActionState(saveDetailsAction, IDLE);
  const v = state.status === "error" || state.status === "success" ? (state.values ?? null) : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  const val = (k: keyof WorkspaceDetailsInput) => v?.[k] ?? String(defaults[k] ?? "");
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={LABELS} />
      <Field name="name" label="Business name" required defaultValue={val("name")} errors={errors.name} />
      <TextareaField name="businessAddress" label="Address" rows={2} defaultValue={val("businessAddress")} errors={errors.businessAddress} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="businessPhone" label="Phone" type="tel" defaultValue={val("businessPhone")} errors={errors.businessPhone} />
        <Field name="businessEmail" label="Email" type="email" defaultValue={val("businessEmail")} errors={errors.businessEmail} />
      </div>
      <Field name="bankDetails" label="Bank details" hint="Printed on invoices and reminders, like: GTBank 0123456789, Mama Ngozi Provisions" defaultValue={val("bankDetails")} errors={errors.bankDetails} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="invoicePrefix" label="Invoice prefix" required hint="Letters and digits; numbers continue from the counter." defaultValue={val("invoicePrefix")} errors={errors.invoicePrefix} />
        <Field name="lowStockDefault" label="Default low-stock level" required inputMode="numeric" defaultValue={val("lowStockDefault")} errors={errors.lowStockDefault} />
      </div>
      <SubmitButton>Save details</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, IDLE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={{ currentPassword: "Current password", newPassword: "New password", confirmPassword: "Confirm" }} />
      <Field name="currentPassword" label="Current password" type="password" autoComplete="current-password" required errors={errors.currentPassword} />
      <Field name="newPassword" label="New password" type="password" autoComplete="new-password" required hint="At least 10 characters." errors={errors.newPassword} />
      <Field name="confirmPassword" label="Type it again" type="password" autoComplete="new-password" required errors={errors.confirmPassword} />
      <SubmitButton>Change password</SubmitButton>
      <p className="text-sm text-ink-2">Changing it signs you out everywhere else.</p>
    </form>
  );
}

export function DeleteWorkspaceForm({ name }: { name: string }) {
  const [state, action] = useActionState(deleteWorkspaceAction, IDLE);
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <ConfirmDialog trigger="Delete this workspace" triggerClassName="btn btn-dark" title="Delete the whole business?">
      <form action={action} className="space-y-3">
        <FormMessage state={state} labels={{ confirmName: "Business name" }} />
        <p className="text-ink-2">
          This permanently deletes every customer, product, invoice, payment, expense and assistant answer in <strong className="text-ink">{name}</strong>, for
          every member. Export your data first. This can&apos;t be undone.
        </p>
        <Field name="confirmName" label={`Type “${name}” to confirm`} required autoComplete="off" errors={errors.confirmName} />
        <SubmitButton className="btn btn-dark" pendingText="Deleting…">
          Delete permanently
        </SubmitButton>
      </form>
    </ConfirmDialog>
  );
}
