"use client";

import { useActionState } from "react";
import { saveCustomerAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { Field, TextareaField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";

export interface CustomerDefaults {
  id?: string;
  name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  notes?: string | null;
  tags?: string[];
}

const LABELS = { name: "Name", phone: "Phone", whatsapp: "WhatsApp", email: "Email", notes: "Notes", tags: "Tags" };

export function CustomerForm({ defaults = {} }: { defaults?: CustomerDefaults }) {
  const [state, action] = useActionState(saveCustomerAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  const value = (key: keyof typeof LABELS, fallback: string | null | undefined) => v?.[key] ?? fallback ?? "";
  return (
    <form action={action} className="max-w-2xl space-y-4" noValidate>
      <FormMessage state={state} labels={LABELS} />
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <Field name="name" label="Name" required defaultValue={value("name", defaults.name)} errors={errors.name} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={value("phone", defaults.phone)}
          errors={errors.phone}
        />
        <Field
          name="whatsapp"
          label="WhatsApp number"
          type="tel"
          inputMode="tel"
          hint="Used for the “share on WhatsApp” links, with country code: +234…"
          defaultValue={value("whatsapp", defaults.whatsapp)}
          errors={errors.whatsapp}
        />
      </div>
      <Field name="email" label="Email" type="email" defaultValue={value("email", defaults.email)} errors={errors.email} />
      <Field
        name="tags"
        label="Tags"
        hint="Separate with commas, like: wholesale, lekki"
        defaultValue={value("tags", defaults.tags?.join(", "))}
        errors={errors.tags}
      />
      <TextareaField name="notes" label="Notes" defaultValue={value("notes", defaults.notes)} errors={errors.notes} />
      <SubmitButton>{defaults.id ? "Save changes" : "Add customer"}</SubmitButton>
    </form>
  );
}
