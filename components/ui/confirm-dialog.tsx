"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * A confirmation step for destructive actions (void, reverse, delete).
 * Uses the native <dialog> with showModal(): the rest of the page becomes
 * inert, so focus stays inside; Escape closes it; and focus goes back to
 * the button that opened it.
 */
export function ConfirmDialog({
  trigger,
  triggerClassName = "btn btn-secondary",
  title,
  children,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  /** The form (with its own submit button) shown inside the dialog. */
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  return (
    <>
      <button ref={opener} type="button" className={triggerClassName} onClick={() => dialog.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => opener.current?.focus()}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border-[3px] border-ink bg-page p-0 text-ink backdrop:bg-black/60"
      >
        <div className="space-y-4 p-5">
          <h2 id={titleId} className="text-2xl">
            {title}
          </h2>
          {children}
          <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
