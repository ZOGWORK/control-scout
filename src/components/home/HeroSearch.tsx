// Home's search block: the field is the hero of its block, with a volt glow and nothing around it to explain it,
// then six suggestion chips, this UTC hour's pick from a pool that shows every kind of answer search gives
// (src/shared/homeSuggestions.ts). The placeholder cycles through the ones that fit it (paused while the field has
// focus, still under reduced motion) and each chip runs its query on /search.
// Presentation only: the box underneath is the same SearchBox, so what it finds is the search's own answer.
// The chips are drawn by the app alone (the server's first paint keeps their space empty) from the clock, so a
// cached or prerendered page still shows this hour's six, and nothing is fetched for them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type Ref, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, Award, CalendarClock, Crown, Gauge, Globe, ListFilter, ListOrdered, MapPin, Medal, MessageCircleQuestion, Swords, TrendingUp, Users } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { SearchBox, hitHref, searchPagePick } from "../search/SearchBox";
import { addRecentSearch } from "../search/discover";
import { SUGGESTION_HOUR_MS, fitChips, placeholderable, suggestionLabel, suggestionsAt, type HomeSuggestion, type SuggestionKind } from "../../shared/homeSuggestions";
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
  question: { label: "Question", icon: MessageCircleQuestion },
  filters: { label: "Filters", icon: ListFilter },
};

/** How long each example stays in the placeholder. */
export const HERO_EXAMPLE_MS = 3500;

/** The placeholder for a suggestion. */
export const heroPlaceholder = (s: HomeSuggestion) => `Try “${s.q}”`;

/** This UTC hour's six, changing on the hour while the page stays open. Each wake-up sets the next one itself, so a
 *  clock moved back (the same hour read again) still keeps them turning. */
export function useHourSuggestions(): HomeSuggestion[] {
  const [hour, setHour] = useState(() => Math.floor(Date.now() / SUGGESTION_HOUR_MS));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => { setHour(Math.floor(Date.now() / SUGGESTION_HOUR_MS)); arm(); }, SUGGESTION_HOUR_MS - (Date.now() % SUGGESTION_HOUR_MS) + 50);
    };
    arm();
    return () => clearTimeout(t);
  }, []);
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

/** The chips that fit `list`'s rows, in the order to draw them. The list keeps a fixed height (two or three rows);
 *  each chip's width is measured once, drawn in the hour's order, and then the most that fit whole are packed onto
 *  the rows (fitChips), the rest left out, never cut off. Packed again when the list's width changes; measured
 *  again when the fonts arrive or a drawn chip changes size (the root text size steps up at 768px and can be set in
 *  Settings); before paint each time. Without layout (a test) all of them show, in order. */
export function useFittingChips(list: RefObject<HTMLUListElement | null>, items: HomeSuggestion[]): HomeSuggestion[] {
  const [fit, setFit] = useState<{ items: HomeSuggestion[]; shown: HomeSuggestion[] } | null>(null);
  const widths = useRef(new Map<string, number>());
  // A chip's height, kept from the last draw that had one: when none fit, none is drawn to read it from.
  const chipH = useRef(0);
  const [run, setRun] = useState(0);
  const current = fit?.items === items ? fit.shown : null;
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => { if (live) { widths.current.clear(); chipH.current = 0; setFit(null); setRun((n) => n + 1); } });
    return () => { live = false; };
  }, []);
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const pack = () => {
      const cs = getComputedStyle(ul);
      const px = (v: string) => parseFloat(v) || 0;
      const width = Math.floor(ul.getBoundingClientRect().width) - px(cs.paddingLeft) - px(cs.paddingRight);
      const height = ul.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
      const drawnH = ul.querySelector("button")?.getBoundingClientRect().height;
      if (drawnH) chipH.current = drawnH;
      const chip = chipH.current;
      const ws = items.map((s) => widths.current.get(s.q) ?? 0);
      if (!width || !chip || ws.some((w) => !w)) { setFit({ items, shown: items }); return; }
      const rows = Math.max(1, Math.floor((height + px(cs.rowGap) + 0.5) / (chip + px(cs.rowGap))));
      const order = fitChips(ws, width, Math.ceil(px(cs.columnGap)), rows, items.map((s) => s.kind));
      const shown = order.map((i) => items[i]);
      setFit((was) => (was?.items === items && was.shown.length === shown.length && was.shown.every((s, i) => s === shown[i]) ? was : { items, shown }));
    };
    const drawn = () => ([...ul.children] as HTMLElement[]).flatMap((li) => (li.dataset.q && li.firstElementChild ? [[li.dataset.q, li.firstElementChild] as const] : []));
    const widthOf = (b: Element) => Math.ceil(b.getBoundingClientRect().width);
    // First draw (all of them, in order): measure each chip, then pack.
    if (items.some((s) => !widths.current.has(s.q))) for (const [q, b] of drawn()) widths.current.set(q, widthOf(b));
    pack();
    let w = ul.clientWidth, h = ul.clientHeight;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      // A drawn chip of a new width, or the list a new height (its rows are in rem): the text size changed, so every
      // width is stale. Draw all six and measure again.
      const resized = ul.clientHeight !== h;
      h = ul.clientHeight;
      if (resized || drawn().some(([q, b]) => { const now = widthOf(b); return now > 0 && now !== widths.current.get(q); })) {
        widths.current.clear(); chipH.current = 0; setFit(null); setRun((n) => n + 1); return;
      }
      if (ul.clientWidth !== w) { w = ul.clientWidth; pack(); }
    });
    ro?.observe(ul);
    for (const [, b] of drawn()) ro?.observe(b);
    return () => ro?.disconnect();
  }, [list, items, run, current]);
  return current ?? items;
}

export function HeroSearch({ inputRef, onEscape, hint, initialQuery }: { inputRef: Ref<HTMLInputElement>; onEscape: () => void; hint: string; initialQuery?: string }) {
  const nav = useNavigate();
  const reduced = useReducedMotion() === true;
  const [focused, setFocused] = useState(false);
  const six = useHourSuggestions();
  const listRef = useRef<HTMLUListElement>(null);
  const drawn = useFittingChips(listRef, six);
  const typeable = drawn.filter(placeholderable);
  const shown = typeable[useRotatingExample(focused, reduced, typeable.length)] ?? drawn[0] ?? six[0];
  // A chip run counts as a recent search, like one typed and entered.
  const run = (q: string) => { addRecentSearch(q); nav(hitHref(searchPagePick(q))); };
  return (
    // The field speaks for itself: its label and placeholder, no heading or tag around it.
    <section aria-label="Search" className="mt-6 max-sm:mt-4 max-w-[38rem]">
      <div onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
        <SearchBox
          size="lg" inputRef={inputRef} onEscape={onEscape} hint={hint} initialQuery={initialQuery} discover
          label="Search teams, events and matches"
          placeholder={heroPlaceholder(shown)}
          onPick={(h: SearchHit) => nav(hitHref(h))}
          className="cs-hero-search w-full"
        />
      </div>
      {/* This hour's six, one tap each, wrapping onto rows of a fixed height: three from a small tablet up, two on a
          phone. The most that fit whole are packed onto the rows (useFittingChips) and any that don't are left out,
          never cut off. Nothing scrolls sideways and the hourly change never moves the page. A chip is drawn 2.25rem
          tall; on a touch screen its tap area is 44px (tap-44), and the row gap and padding are wide enough that two
          rows' tap areas never overlap or reach outside the list. */}
      <ul
        ref={listRef} aria-label="Example searches"
        className="flex flex-wrap content-start gap-x-2 overflow-hidden [--chip-h:2.25rem] [--chip-py:max(0px,calc((44px-var(--chip-h))/2))] [--chip-gy:max(0.5rem,calc(2*var(--chip-py)))] gap-y-(--chip-gy) py-(--chip-py) mt-[calc(0.75rem-var(--chip-py))] h-[calc(2*var(--chip-h)+var(--chip-gy)+2*var(--chip-py))] sm:h-[calc(3*var(--chip-h)+2*var(--chip-gy)+2*var(--chip-py))]"
      >
        {drawn.map((s) => { const K = KINDS[s.kind]; const label = suggestionLabel(s); return (
          <li key={s.q} data-q={s.q} className="max-w-full shrink-0">
            <button
              type="button" onClick={() => run(s.q)} aria-label={`${K.label}: search “${s.q}”`}
              className={"tap-44 inline-flex h-(--chip-h) items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition-colors hover:border-accent/60 hover:text-foreground "
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
