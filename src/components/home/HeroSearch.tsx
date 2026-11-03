// Home's search block, FTC One Search: the field is the hero of its block, with a volt glow, plain words saying
// any kind of search works, and the search's shared examples. The placeholder cycles through them (paused while
// the field has focus, still under reduced motion) and each one is a chip that runs its query on /search.
// Presentation only: the box underneath is the same SearchBox, so what it finds is the search's own answer.
import { useEffect, useState, type ComponentType, type Ref } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, CalendarDays, ListOrdered, MapPin, Medal, Trophy } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { SearchBox, hitHref, searchPagePick } from "../search/SearchBox";
import { SEARCH_EXAMPLE_SET, addRecentSearch, type SearchExampleKind } from "../search/discover";
import type { SearchHit } from "../../shared/api";
import { HOME_SEARCH_NAME, HOME_SEARCH_SUB, HOME_SEARCH_TITLE } from "../../shared/boot";

/** The examples: the search's own shared list (queries it answers, varied teams), never a copy of our own. */
export const HERO_EXAMPLES = SEARCH_EXAMPLE_SET;

/** Each kind's chip label and icon. */
const KINDS: Record<SearchExampleKind, { label: string; icon: ComponentType<{ className?: string }> }> = {
  place: { label: "Place", icon: MapPin },
  versus: { label: "Versus", icon: ArrowLeftRight },
  question: { label: "Question", icon: Trophy },
  record: { label: "Record", icon: ListOrdered },
  leaderboard: { label: "Leaderboard", icon: Medal },
  upcoming: { label: "Upcoming", icon: CalendarDays },
};

/** How long each example stays in the placeholder. */
export const HERO_EXAMPLE_MS = 3500;

/** The placeholder for example `i`. */
export const heroPlaceholder = (i: number) => `Try “${HERO_EXAMPLES[i % HERO_EXAMPLES.length].q}”`;

/** The example the placeholder shows: the next one every HERO_EXAMPLE_MS, holding while `paused` (the field has
 *  focus, so nobody reads a moving target) and never moving under reduced motion. */
export function useRotatingExample(paused: boolean, reduced: boolean, count = HERO_EXAMPLES.length): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused || reduced || count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), HERO_EXAMPLE_MS);
    return () => clearInterval(t);
  }, [paused, reduced, count]);
  return i;
}

export function HeroSearch({ inputRef, onEscape, hint, initialQuery }: { inputRef: Ref<HTMLInputElement>; onEscape: () => void; hint: string; initialQuery?: string }) {
  const nav = useNavigate();
  const reduced = useReducedMotion() === true;
  const [focused, setFocused] = useState(false);
  const shown = useRotatingExample(focused, reduced);
  // A chip run counts as a recent search, like one typed and entered.
  const run = (q: string) => { addRecentSearch(q); nav(hitHref(searchPagePick(q))); };
  return (
    <section aria-labelledby="hero-search-title" className="mt-6 max-sm:mt-4 max-w-[38rem]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-text">{HOME_SEARCH_NAME}</p>
      <h2 id="hero-search-title" className="mt-1.5 font-display text-2xl font-semibold tracking-[-0.01em] @lg/home:text-[1.75rem]">{HOME_SEARCH_TITLE}</h2>
      <p className="mt-1 text-sm text-text-muted">{HOME_SEARCH_SUB}</p>
      <div onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
        <SearchBox
          size="lg" inputRef={inputRef} onEscape={onEscape} hint={hint} tour="search" initialQuery={initialQuery} discover
          label="Search teams, events and matches"
          placeholder={heroPlaceholder(shown)}
          onPick={(h: SearchHit) => nav(hitHref(h))}
          className="cs-hero-search mt-4 w-full"
        />
      </div>
      {/* Every example, one tap each: they wrap on a wide screen and scroll sideways on a phone. */}
      <ul aria-label="Example searches" className="mt-3 flex gap-2 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[scrollbar-width:none] sm:flex-wrap">
        {HERO_EXAMPLES.map(({ q, kind }, i) => { const K = KINDS[kind]; return (
          <li key={q} className="shrink-0">
            <button
              type="button" onClick={() => run(q)} aria-label={`${K.label}: search “${q}”`}
              className={"inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors hover:border-accent/60 hover:text-foreground "
                + (i === shown && !focused ? "border-accent/50 bg-accent/10 text-foreground" : "border-border bg-card text-text-muted")}
            >
              <K.icon className="size-3.5 shrink-0 text-accent" />{q}
            </button>
          </li>
        ); })}
      </ul>
    </section>
  );
}
