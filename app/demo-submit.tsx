"use client";

import { useFormStatus } from "react-dom";

export function DemoSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Setting up your sandbox…" : "Try the demo"}
    </button>
  );
}
