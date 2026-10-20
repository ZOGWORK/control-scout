// Building blocks for the site's plain-language policy pages (Privacy, Terms):
// a "short version" of coloured highlights, numbered sections with an
// "On this page" index beside them on wide screens, and readable prose.
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "./cn";

export type Tone = "accent" | "info" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-text",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
};

export interface Highlight { icon: ComponentType<{ className?: string }>; tone: Tone; title: string; body: ReactNode }

/** The page in four lines: coloured tiles, two per row from small screens up. */
export function ShortVersion({ items }: { items: Highlight[] }) {
  return (
    <section aria-labelledby="short-version" className="mb-10 max-sm:mb-6 rounded-2xl border border-line bg-card/70 p-4 sm:p-6">
      <h2 id="short-version" className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">The short version</h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {items.map((h) => (
          <li key={h.title} className="flex gap-3">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONES[h.tone])}><h.icon className="size-[18px]" aria-hidden /></span>
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{h.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-text-muted">{h.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface LegalSectionDef { id: string; title: string; body: ReactNode }

/** Numbered sections; on large screens an "On this page" index stays beside them. */
export function LegalSections({ sections }: { sections: LegalSectionDef[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 max-sm:gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:block lg:self-start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">On this page</p>
        <ol className="space-y-0.5 text-sm">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex gap-2 rounded-md px-2 py-1.5 text-text-muted hover:bg-text-base/[0.05] hover:text-text-base">
                <span className="w-5 shrink-0 tabular-nums text-text-muted/60">{i + 1}</span>{s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="min-w-0 max-w-[72ch] space-y-10 max-sm:space-y-6">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-bar-6">
            <h2 id={`${s.id}-h`} className="mb-3 flex items-baseline gap-3 border-b border-line pb-3 font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              <span className="font-mono text-sm text-accent-text">{String(i + 1).padStart(2, "0")}</span>{s.title}
            </h2>
            <Prose>{s.body}</Prose>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Body text: comfortable line length and spacing, bold in full colour, links underlined. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      "space-y-3 text-[0.9375rem] leading-relaxed text-text-muted",
      "[&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_li]:marker:text-text-muted/50",
      "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-accent/60 [&_a]:underline-offset-2 hover:[&_a]:decoration-accent",
      className,
    )}>{children}</div>
  );
}

/** A link out of the site, opened in a new tab. */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
}

/** An in-app link. */
export function In({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to}>{children}</Link>;
}
