// Settings page building blocks, laid out like Control Point's: titled groups of rows
// (label + explanation on the left, the control on the right).
import type { ReactNode } from "react";
import { cn } from "../cn";

/** A titled group of settings rows. */
export function Group({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mb-8 max-sm:mb-5", className)}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

/** One row: label + explanation on the left, the control on the right (stacked on phones, or with `stack`). */
export function Row({ label, description, children, htmlFor, stack }: { label: ReactNode; description?: ReactNode; children?: ReactNode; htmlFor?: string; stack?: boolean }) {
  return (
    <div className={cn("flex gap-4 border-b border-border px-4 py-4 last:border-b-0", stack ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between")}>
      <div className="min-w-0">
        {htmlFor ? <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</label> : <p className="text-sm font-medium text-foreground">{label}</p>}
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className={cn("shrink-0", stack && "w-full")}>{children}</div>}
    </div>
  );
}
