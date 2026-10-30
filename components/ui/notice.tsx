import type { ReactNode } from "react";
import { AlertIcon, InfoIcon } from "@/components/ui/icons";

/** Errors: icon + heading + thick black border (never colour alone). */
export function ErrorNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border-[3px] border-ink bg-page p-4">
      <h2 className="flex items-center gap-2 font-sans text-base font-bold">
        <AlertIcon className="shrink-0" />
        {title}
      </h2>
      {children ? <div className="mt-1 text-ink-2">{children}</div> : null}
    </div>
  );
}

export function InfoNotice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-l-4 border-line border-l-gold bg-card p-3">
      <InfoIcon className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-ink-2">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-3 border-dashed p-6">
      <h2 className="text-xl">{title}</h2>
      {children ? <div className="text-ink-2">{children}</div> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 border-gold pb-4">
      <div className="min-w-0">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {description ? <div className="mt-1 text-ink-2">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Skeleton({ className = "h-6 w-full" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="space-y-4">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
