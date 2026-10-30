"use client";

import { ErrorNotice } from "@/components/ui/notice";

// Database or provider unreachable, or an unexpected bug: a friendly message
// and a retry, never a stack trace. Forms keep their input on their own.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const unreachable = /DatabaseUnavailable|could not be reached/i.test(`${error.name} ${error.message}`);
  return (
    <div className="space-y-4">
      <ErrorNotice title={unreachable ? "We can't reach the database right now" : "Something went wrong on this page"}>
        <p>
          {unreachable
            ? "Your data is safe. This is usually a short network problem; please try again in a moment."
            : "Please try again. If it keeps happening, reload the page."}
        </p>
        {error.digest ? <p className="mt-1 text-sm">Reference: {error.digest}</p> : null}
      </ErrorNotice>
      <button type="button" className="btn btn-primary" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
