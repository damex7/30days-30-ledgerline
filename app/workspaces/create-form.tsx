"use client";

import { useActionState } from "react";
import { createWorkspaceAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { Field } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";

export function CreateWorkspaceForm() {
  const [state, action] = useActionState(createWorkspaceAction, IDLE);
  const values = state.status === "error" ? state.values : {};
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={{ name: "Business name" }} />
      <Field
        name="name"
        label="Business name"
        required
        hint="As it should appear on invoices. Currency is naira (₦)."
        defaultValue={values.name ?? ""}
        errors={errors.name}
      />
      <SubmitButton pendingText="Creating…">Create workspace</SubmitButton>
    </form>
  );
}
