// Home's search block: the field is the hero of its block, with a volt glow and nothing around it to explain it,
// then six suggestion chips, this UTC hour's pick from a pool that shows every kind of answer search gives
// (src/shared/homeSuggestions.ts). The placeholder cycles through the ones that fit it (paused while the field has
// focus, still under reduced motion) and each chip runs its query on /search.
// Presentation only: the box underneath is the same SearchBox, so what it finds is the search's own answer.
// The chips are drawn by the app alone (the server's first paint keeps their space empty) from the clock, so a
// cached or prerendered page still shows this hour's six, and nothing is fetched for them.
import { useEffect, useMemo, useState, type ComponentType, type Ref } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, Award, CalendarClock, Crown, Gauge, Globe, ListFilter, ListOrdered, MapPin, Medal, MessageCircleQuestion, SpellCheck, Swords, TrendingUp, Users } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { SearchBox, hitHref, searchPagePick } from "../search/SearchBox";
import { addRecentSearch } from "../search/discover";
import { SUGGESTION_HOUR_MS, placeholderable, suggestionLabel, suggestionsAt, type HomeSuggestion, type SuggestionKind } from "../../shared/homeSuggestions";
import type { SearchHit } from "../../shared/api";

/** Each family's name (read with the chip) and icon. */
const KINDS: Record<SuggestionKind, { label: string; icon: ComponentType<{ className?: string }> }> = {
  team: { label: "Team", icon: MapPin },
  opr: { label: "OPR", icon: Gauge },
  rating: { label: "Rating", icon: TrendingUp },
  record: { label: "Record", icon: ListOrdered },
  matches: { label: "Matches", icon: Swords },
  awards: { label: "Awards", icon: Award },
  worlds: { label: "Worlds", icon: Globe },
  versus: { label: "Versus", icon: ArrowLeftRight },
  three: { label: "Three teams", icon: Users },
  leaderboard: { label: "Leaderboard", icon: Medal },
  winners: { label: "Winners", icon: Crown },
  predict: { label: "Prediction", icon: CalendarClock },
  spelling: { label: "Spelling", icon: SpellCheck },
  question: { label: "Question", icon: MessageCircleQuestion },
  filters: { label: "Filters", icon: ListFilter },
};

/** How long each example stays in the placeholder. */
export const HERO_EXAMPLE_MS = 3500;

/** The placeholder for a suggestion. */
export const heroPlaceholder = (s: HomeSuggestion) => `Try “${s.q}”`;

/** This UTC hour's six, changing on the hour while the page stays open. */
export function useHourSuggestions(): HomeSuggestion[] {
  const [hour, setHour] = useState(() => Math.floor(Date.now() / SUGGESTION_HOUR_MS));
  useEffect(() => {
    const t = setTimeout(() => setHour(Math.floor(Date.now() / SUGGESTION_HOUR_MS)), SUGGESTION_HOUR_MS - (Date.now() % SUGGESTION_HOUR_MS) + 50);
    return () => clearTimeout(t);
  }, [hour]);
  return useMemo(() => suggestionsAt(hour * SUGGESTION_HOUR_MS), [hour]);
}

/** The example the placeholder shows (an index into `count`): the next one every HERO_EXAMPLE_MS, holding while
 *  `paused` (the field has focus, so nobody reads a moving target) and never moving under reduced motion. */
export function useRotatingExample(paused: boolean, reduced: boolean, count: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paused || reduced || count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), HERO_EXAMPLE_MS);
    return () => clearInterval(t);
  }, [paused, reduced, count]);
  return i % Math.max(1, count);
}

export function HeroSearch({ inputRef, onEscape, hint, initialQuery }: { inputRef: Ref<HTMLInputElement>; onEscape: () => void; hint: string; initialQuery?: string }) {
  const nav = useNavigate();
  const reduced = useReducedMotion() === true;
  const [focused, setFocused] = useState(false);
  const six = useHourSuggestions();
  const typeable = six.filter(placeholderable);
  const shown = typeable[useRotatingExample(focused, reduced, typeable.length)] ?? six[0];
  // A chip run counts as a recent search, like one typed and entered.
  const run = (q: string) => { addRecentSearch(q); nav(hitHref(searchPagePick(q))); };
  return (
    // The field speaks for itself: its label and placeholder, no heading or tag around it.
    <section aria-label="Search" className="mt-6 max-sm:mt-4 max-w-[38rem]">
      <div onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
        <SearchBox
          size="lg" inputRef={inputRef} onEscape={onEscape} hint={hint} tour="search" initialQuery={initialQuery} discover
          label="Search teams, events and matches"
          placeholder={heroPlaceholder(shown)}
          onPick={(h: SearchHit) => nav(hitHref(h))}
          className="cs-hero-search w-full"
        />
      </div>
      {/* This hour's six, one tap each: on a wider screen they wrap inside three rows' room, whichever six they are
          (labels are SUGGESTION_LABEL_MAX at most, so two always share a row), and scroll sideways on a phone. A chip
          is drawn 36px tall; its tap area reaches 44px (the row's padding keeps that inside the scroller). */}
      <ul aria-label="Example searches" className="mt-3 flex gap-2 max-sm:-mx-4 max-sm:mt-2 max-sm:overflow-x-auto max-sm:px-4 max-sm:py-1 max-sm:[scrollbar-width:none] sm:min-h-[7.75rem] sm:flex-wrap sm:content-start">
        {six.map((s) => { const K = KINDS[s.kind]; const label = suggestionLabel(s); return (
          <li key={s.q} className="shrink-0">
            <button
              type="button" onClick={() => run(s.q)} aria-label={`${K.label}: search “${s.q}”`}
              className={"relative inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:border-accent/60 hover:text-foreground "
                + (s === shown && !focused ? "border-accent/50 bg-accent/10 text-foreground" : "border-border bg-card text-text-muted")}
            >
              <K.icon className="size-3.5 shrink-0 text-accent" />{label}
            </button>
          </li>
        ); })}
      </ul>
    </section>
  );
}
