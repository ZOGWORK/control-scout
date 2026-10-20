// The branded "not found" page: unknown routes (pages/NotFound) and team or
// event pages the API doesn't know (TeamPage / EventPage on a 404). Same look
// everywhere, with a message that says what exactly wasn't found. The server
// answers these addresses with HTTP 404 (server/seoMeta.ts), so the page and
// the status agree.
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useNotFoundHead } from "../lib/meta";
import { ArrowRight, CalendarDays, House, Sparkles, Users, type LucideIcon } from "lucide-react";
import { SEARCH_HINT, hitHref, usePageSearch } from "./layout/Search";
import { SearchBox } from "./search/SearchBox";
import { Reveal } from "./motion";

const LINKS: { to: string; label: string; body: string; icon: LucideIcon }[] = [
  { to: "/", label: "Home", body: "Start from the top", icon: House },
  { to: "/events", label: "Events", body: "Every event this season", icon: CalendarDays },
  { to: "/teams", label: "Teams", body: "Stats for every team", icon: Users },
  { to: "/predict", label: "Predict", body: "Who wins the match?", icon: Sparkles },
];

export function NotFoundView({ title = "This page is off the field", description = "The link may be old, or a team or event number mistyped. Search for what you were after, or pick up from one of these.", action }: {
  title?: string;
  description?: string;
  /** A specific way forward, under the description (e.g. drop an unsupported season). */
  action?: ReactNode;
}) {
  // The page's own search: the top-bar field steps aside while this is shown.
  const searchRef = usePageSearch();
  useNotFoundHead();
  const nav = useNavigate();
  return (
    <Reveal className="mx-auto flex w-full max-w-2xl flex-col items-center pt-4 text-center sm:pt-12">
      <div className="relative select-none" aria-hidden>
        <span className="block font-display text-[6rem] font-bold leading-none tracking-tighter text-accent-text sm:text-[9.25rem] [text-shadow:0_0_60px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]">
          4<span className="inline-block align-baseline"><img src="/mark.png" alt="" width={256} height={256} className="mx-1 inline-block size-[72px] -translate-y-1 sm:mx-2 sm:size-[112px] sm:-translate-y-2" /></span>4
        </span>
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Error 404 · Not found</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-[2.125rem] sm:leading-tight">{title}</h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">{description}</p>
      {action && <div className="mt-4">{action}</div>}
      <SearchBox
        inputRef={searchRef} hint={SEARCH_HINT} size="lg"
        label="Search teams, events and matches"
        placeholder="Team number or name, or an event…"
        onPick={(h) => nav(hitHref(h))}
        className="mt-7 w-full text-left [&>div:first-child]:rounded-2xl [&>div:first-child]:shadow-[0_8px_40px_-12px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
      />
      <nav aria-label="Popular pages" className="mt-6 max-sm:mt-4 grid w-full grid-cols-2 gap-3 text-left sm:grid-cols-4">
        {LINKS.map(({ to, label, body, icon: Icon }) => (
          <Link key={to} to={to} className="lift group flex flex-col gap-1 rounded-xl border border-border bg-card/60 px-3.5 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon className="size-4 text-accent-text" /> {label}
              <ArrowRight className="ml-auto size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" />
            </span>
            <span className="text-xs text-muted-foreground">{body}</span>
          </Link>
        ))}
      </nav>
    </Reveal>
  );
}
