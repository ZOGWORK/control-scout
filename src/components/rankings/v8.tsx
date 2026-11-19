// The rankings area in v8 (docs/design/v8-revamp-brief.md §5 Tables, §7 item 10): world, region, league, conference
// and power rankings, and the records pages, share one look. The table is the page: a quiet sentence-case head on a
// hairline, 44px rows split by hairlines (no box around them), numbers in tabular figures, the slate-blue accent only
// on the #1 rank and the picked sort or tab, and "your team" in white. Every class here is a `v8:` one, so the
// classic look (/legacy) draws exactly as before; the tabs and the disclosure exist in v8 only.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { qs } from "../../lib/api";
import { useFlag } from "../../lib/flags";
import { useIsV8 } from "../../lib/v8";
import { cn } from "../cn";

/** A wrapper around a PageHeader: its title becomes v8's page title (Inter, 22/28, 600, tight). */
export const V8_HEAD = "v8:[&_h1]:font-sans v8:[&_h1]:text-[1.375rem] v8:[&_h1]:font-semibold v8:[&_h1]:leading-7 v8:[&_h1]:tracking-tight";
/** The eyebrow's own words: sentence case, faint (the header draws it uppercase and tracked in the classic look). */
export const V8_EYEBROW = "v8:font-normal v8:normal-case v8:tracking-normal v8:text-text-faint";
/** A table's frame: no box in v8, the rows' hairlines are the structure. */
export const V8_FRAME = "v8:rounded-none v8:border-0 v8:bg-transparent";
/** A column head: small, faint, sentence case, on a visible rule (white 12%; rows are split by white 8%, which reads
 *  on near-black where the 6% `line` token fades); opaque so a sticky head hides the rows under it. */
export const V8_TH = "v8:bg-background v8:pb-0 v8:align-middle v8:text-xs v8:font-medium v8:normal-case v8:tracking-normal v8:text-text-faint v8:shadow-[inset_0_-1px_0_rgb(255_255_255/0.12)]";
/** A row: 44px, a hairline above, a quiet fill on hover (hover-capable devices only). */
export const V8_ROW = "v8:h-11 v8:border-white/[0.08] v8:hover:bg-white/[0.03]";
/** Your team's row (or the one a link asked for): white, not the accent. A faint white fill and a white edge. */
export const V8_MINE = "v8:bg-white/[0.05] v8:shadow-[inset_2px_0_0_var(--color-text-base)]";
/** A rank: Inter in tabular figures (Space Grotesk is for hero numbers only); `V8_TOP` on #1. */
export const V8_RANK = "v8:font-sans v8:text-sm v8:font-medium v8:text-text-base";
export const V8_TOP = "v8:text-accent";
/** A move or rating change downwards: muted, not red (red means live or the red alliance). */
export const V8_DOWN = "v8:text-text-muted";
/** Captions under a number (world rank, matches played): faint. */
export const V8_CAPTION = "v8:text-text-faint";
/** A plain text link in v8: muted, white on hover, no accent. */
export const V8_LINK = "v8:font-normal v8:text-text-muted v8:hover:text-text-base";
/** A note that was a tinted box (season note, "isn't from here"): a neutral card in v8. */
export const V8_NOTE = "v8:border-line v8:bg-card v8:text-text-muted";
/** A card that links somewhere (a league, a meet): neutral hairline, a quiet fill on hover, no lift. */
export const V8_CARD_LINK = "v8:border-line v8:hover:border-white/[0.12] v8:hover:bg-white/[0.02]";
/** A search box in the filter row: a hairline box with no fill of its own. */
export const V8_SEARCH = "v8:border-white/[0.12] v8:bg-transparent";
/** A decorative icon: no colour of its own in v8. */
export const V8_ICON = "v8:text-text-faint";

type Tab = "world" | "regions" | "leagues" | "power";

/**
 * v8's rankings sub-nav, as tabs (the sidebar keeps its Rankings arrow too): World, Regions, Leagues and Power
 * rankings (when that feature is on), the picked one white with the slate-blue line. The season rides along.
 * `ssr`: the page has a server-drawn first paint (the league page), where v8 can't be read; it's drawn there always
 * and shown by CSS in v8 only, so nothing moves when the app takes over. Elsewhere it's drawn in v8 only.
 */
export function RankingsTabs({ at, season, ssr = false }: { at: Tab; season?: number | null; ssr?: boolean }) {
  const v8 = useIsV8();
  const power = useFlag("powerRankings");
  if (!ssr && !v8) return null;
  const s = qs({ season: season ?? null });
  const tabs: { id: Tab; to: string; label: string }[] = [
    { id: "world", to: `/rankings${s}`, label: "World" },
    { id: "regions", to: `/rankings/regions${s}`, label: "Regions" },
    { id: "leagues", to: `/leagues${s}`, label: "Leagues" },
    ...(power ? [{ id: "power" as const, to: "/power-rankings", label: "Power rankings" }] : []),
  ];
  return (
    <nav aria-label="Rankings" data-rankings-tabs className={cn("tabs-fade mb-4 items-center overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]", ssr ? "hidden v8:flex" : "flex")}>
      {tabs.map((t, i) => {
        const on = t.id === at;
        return (
          <Link key={t.id} to={t.to} aria-current={on ? "page" : undefined}
            className={cn("relative inline-flex h-10 shrink-0 items-center px-3 text-sm font-medium transition-colors duration-150 first:pl-0 max-sm:h-11",
              on ? "text-text-base" : "text-text-muted hover:text-text-base")}>
            {t.label}
            {on && <span aria-hidden className={cn("absolute -bottom-px h-0.5 rounded-full bg-accent", i === 0 ? "left-0 right-3" : "inset-x-3")} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** v8's home for a page's explanation: one quiet row that opens it, under the table. */
export function Disclosure({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group border-t border-line", className)} data-disclosure>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:text-text-base [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 transition-transform duration-150 ease-out group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="max-w-3xl space-y-2 pb-4 text-sm text-text-muted">{children}</div>
    </details>
  );
}
