// The small v8 pieces My team, My teams, Shortlist and Compare share (docs/design/v8-revamp-brief.md): the page title
// row, a card, a faint label, the empty state (icon, one line, one plain action), and the standing figures. Drawn only
// while <html data-v8> is set: the pages pick them with useIsV8(), so the classic look never sees them.
import type { ComponentType, ReactNode } from "react";
import { cn } from "../cn";

/** A small label: sentence case, faint (the classic uppercase tracked eyebrows). */
export const V8_LABEL = "text-xs font-normal text-text-faint";
/** A card: the surface, a hairline, 14px corners, 16–20px padding. */
export const V8_CARD = "rounded-xl border border-line bg-card p-4 sm:p-5";
/** A row that answers the pointer: a faint fill (no lift), 44px tall, and the 0.97-style press kept small for rows. */
export const V8_ROW = "flex min-h-11 items-center gap-3 transition-colors duration-150 hover:bg-white/[0.03]";
/** A press on a button-like element. */
export const V8_PRESS = "active:scale-[0.97] motion-reduce:active:scale-100";

/** The page title at the top of the content (22/28, semibold, tight), with the page's actions on its right. */
export function V8Title({ title, line, actions, children }: { title: ReactNode; line?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 max-sm:mb-4" data-v8-title>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-semibold leading-7 tracking-tight text-text-base">{title}</h1>
          {line && <p className="mt-0.5 text-sm text-text-muted">{line}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full" data-print-hide>{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

/** One quiet empty state: an icon, one line (and an optional second), one plain action. */
export function V8Empty({ icon: Icon, title, line, action, className }: { icon: ComponentType<{ className?: string }>; title: ReactNode; line?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-xl border border-line bg-card px-6 py-10 text-center", className)} data-v8-empty>
      <Icon className="size-5 text-text-faint" aria-hidden />
      <p className="mt-3 text-sm font-medium text-text-base">{title}</p>
      {line && <p className="mt-1 max-w-sm text-sm text-text-muted">{line}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A section heading inside a page: title, a quiet line, and an action on the right. */
export function V8Heading({ title, line, action, id }: { title: ReactNode; line?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-text-base">{title}</h2>
        {line && <p className="mt-0.5 text-sm text-text-muted">{line}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A row of figures split by hairlines: a faint label over a white tabular number. */
export function V8Figures({ items, className }: { items: { label: ReactNode; value: ReactNode; sub?: ReactNode; title?: string }[]; className?: string }) {
  return (
    <dl className={cn("grid min-w-0 divide-x divide-line", className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} data-v8-figures>
      {items.map((x, i) => (
        <div key={i} className="min-w-0 px-4 first:pl-0 max-sm:px-3 max-sm:first:pl-0" title={x.title}>
          <dt className={V8_LABEL}>{x.label}</dt>
          <dd className="mt-0.5 whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums text-text-base">{x.value}</dd>
          {x.sub && <dd className="truncate text-[0.6875rem] text-text-faint">{x.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
