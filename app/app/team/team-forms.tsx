"use client";

import { useActionState } from "react";
import { changeRoleAction, inviteAction, removeMemberAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { Field, SelectField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const ROLE_OPTIONS = [
  ["staff", "Staff: sells, records payments and expenses"],
  ["manager", "Manager: everything except the team and deleting the business"],
  ["owner", "Owner: everything"],
] as const;

export function InviteForm() {
  const [state, action] = useActionState(inviteAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={{ email: "Email", role: "Role" }} />
      <Field name="email" label="Email" type="email" required defaultValue={v?.email ?? ""} errors={errors.email} />
      <SelectField name="role" label="Role" required defaultValue={v?.role ?? "staff"} errors={errors.role}>
        {ROLE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
    </form>
  );
}

export function RoleForm({ userId, role, name }: { userId: string; role: string; name: string }) {
  const [state, action] = useActionState(changeRoleAction, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`role-${userId}`} className="sr-only">
          Role for {name}
        </label>
        <select id={`role-${userId}`} name="role" defaultValue={role} className="field min-h-10 py-1">
          <option value="owner">Owner</option>
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
      </div>
      <SubmitButton className="btn btn-secondary min-h-10 py-1" pendingText="Saving…">
        Change<span className="sr-only"> role for {name}</span>
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="w-full text-sm font-semibold">
          ▲ {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function RemoveForm({ userId, name }: { userId: string; name: string }) {
  const [state, action] = useActionState(removeMemberAction, IDLE);
  return (
    <ConfirmDialog trigger={<>Remove<span className="sr-only"> {name}</span></>} triggerClassName="btn btn-ghost min-h-10 py-1 underline" title={`Remove ${name}?`}>
      <form action={action} className="space-y-3">
        <FormMessage state={state} />
        <input type="hidden" name="userId" value={userId} />
        <p className="text-ink-2">They lose access immediately, on every device. Their past invoices and payments stay.</p>
        <SubmitButton className="btn btn-dark" pendingText="Removing…">
          Remove from workspace
        </SubmitButton>
      </form>
    </ConfirmDialog>
  );
}
