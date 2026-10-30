import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Labelled form fields. Errors are linked with aria-describedby and marked
// aria-invalid (which also draws a thick black border, so an error never
// depends on colour). The hint stays visible while there is an error.

interface Common {
  name: string;
  label: string;
  hint?: string;
  errors?: string[] | undefined;
  className?: string;
}

export function fieldId(name: string): string {
  return `f-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function describedBy(id: string, hint?: string, errors?: string[]): string | undefined {
  const parts = [hint ? `${id}-hint` : null, errors?.length ? `${id}-error` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function Shell({
  id,
  label,
  hint,
  errors,
  required,
  className = "",
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  errors?: string[] | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="font-semibold">
        {label}
        {required ? null : <span className="font-normal text-ink-2"> (optional)</span>}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-2">
          {hint}
        </p>
      ) : null}
      {children}
      {errors?.length ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm font-semibold">
          <span aria-hidden="true">▲</span>
          <span>{errors.join(" ")}</span>
        </p>
      ) : null}
    </div>
  );
}

export function Field({ name, label, hint, errors, className, ...input }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = input.id ?? fieldId(name);
  return (
    <Shell id={id} label={label} hint={hint} errors={errors} required={input.required} className={className}>
      <input
        id={id}
        name={name}
        className="field"
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(id, hint, errors)}
        {...input}
      />
    </Shell>
  );
}

export function SelectField({
  name,
  label,
  hint,
  errors,
  className,
  children,
  ...select
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const id = select.id ?? fieldId(name);
  return (
    <Shell id={id} label={label} hint={hint} errors={errors} required={select.required} className={className}>
      <select
        id={id}
        name={name}
        className="field"
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(id, hint, errors)}
        {...select}
      >
        {children}
      </select>
    </Shell>
  );
}

export function TextareaField({ name, label, hint, errors, className, ...area }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = area.id ?? fieldId(name);
  return (
    <Shell id={id} label={label} hint={hint} errors={errors} required={area.required} className={className}>
      <textarea
        id={id}
        name={name}
        rows={3}
        className="field"
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={describedBy(id, hint, errors)}
        {...area}
      />
    </Shell>
  );
}
