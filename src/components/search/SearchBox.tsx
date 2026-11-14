// Inline search: a field with a results dropdown under it. The page behind it
// stays fully usable (no modal, no focus trap). Content only: teams, events
// and matches, plus the site pages a whole word names (docs/search.md) —
// navigation lives in the nav.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { smoothBehavior } from "../../lib/pageScroll";
import { ArrowLeftRight, ArrowRight, BookOpen, CalendarDays, ChevronDown, Clock, Compass, FileText, Info, Loader2, MapPin, Search, Shield, Sparkles, Swords, Trophy, Users, X } from "lucide-react";
import { m } from "../motion";
import { apiFetch } from "../../lib/api";
import { offlineSource } from "../../lib/offline/saved";
import { usePersonal } from "../../lib/personal";
import { MINE } from "../../shared/searchMine";
import { useMeta } from "../../lib/meta";
import { useServerFlag } from "../../lib/flags";
import type { SearchAnswer, SearchCard, SearchFact, SearchHit } from "../../shared/api";
import { SEARCH_GROUPS, cardWho, shownPath } from "../../shared/search";
import { cn } from "../cn";
import { SEARCH_PALETTE } from "../../lib/textTones";
import { TeamTable } from "./TeamTable";
import { SEARCH_EXAMPLES, addRecentSearch, clearRecentSearches, useRecentSearches } from "./discover";
import { dateRange, seasonLabel } from "../../lib/format";
import { EventStatusChip } from "../EventChips";
import { directHit, markDirect } from "./direct";
import { dropdownNotes, dropdownSections, groupCount, teamOpr, type DropId } from "./dropdown";
import { compareSides, compareTeams, eventFacts, teamParts } from "./page/results";
import { answerSections, isAnswer, plainSections, type AnswerNotes, type AnswerRow, type AnswerSection, type SectionId } from "../../shared/searchSections";

export type HitKind = SearchHit["kind"];

export { hitHref } from "../../shared/search";

/** How long typing pauses before search asks (each key doesn't send a request). */
/** How long typing must pause before results are asked for: nothing is searched letter by letter. Enter skips it. */
export const SEARCH_DEBOUNCE_MS = 1000;

type Answered = { q: string; /** The picked season it was asked with (useSearchHits season). */ season?: number | null; hits: SearchHit[]; answer?: SearchAnswer; /** Fetched here (not the first paint's): only these stay on screen for a newer query. */ live?: boolean; /** Answered from data saved on this device (it may not know every team). */ saved?: boolean };

/** Debounced search; my team, tracked and shortlisted teams/events rank first among equal matches.
 *  Without `kinds` it asks for the whole answer (step, pages, recovery), and when that answer is weak and Bruno AI
 *  is on, asks him after the answer is on screen (never before: his reading can't slow the first results).
 *  `initial`: results already on screen (the server's, on /search), shown while the first request refreshes them. */
/** `refine`: off where Bruno AI's suggestion isn't shown (the /search page), so he's never asked for nothing. */
/** The visitor's preferred teams and events (their team, the ones they follow or saved), as search is asked with them:
 *  a name several teams share reads as theirs. */
export function usePreferKey(): string {
  const { state } = usePersonal();
  return useMemo(() => [...new Set([
    ...(state.myTeam ? [`team:${state.myTeam}`] : []),
    ...state.tracked.teams.map((t) => `team:${t}`),
    ...state.bookmarks.map((t) => `team:${t}`),
    ...state.tracked.events.map((e) => `event:${e}`),
  ])].slice(0, 100).join(","), [state.myTeam, state.tracked, state.bookmarks]);
}

/** `season`: the season the answer's picker chose (/search?in=), sent as ?season= (server/api/answers/season.ts
 *  withSeason); results remember it with their query. */
export function useSearchHits(q: string, kinds?: HitKind[], limit = 15, initial?: { q: string; hits: SearchHit[] } | null, refine = true, season: number | null = null) {
  // Results remember the query they answer, so a pick can never come from a previous query.
  const [res, setRes] = useState<Answered>(() => (initial ? { q: initial.q, hits: initial.hits, answer: isAnswer(initial) ? initial : undefined } : { q: "", hits: [] }));
  const [ai, setAi] = useState<{ q: string; answer: SearchAnswer | null } | null>(null);
  const [refining, setRefining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by retry(): the same query asked again after a failure.
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  // The search waiting out the typing pause: Enter (searchNow) runs it at once.
  const waiting = useRef<{ q: string; run: () => void } | null>(null);
  // The query last asked about (null before the first): only a changed one, typed, waits for the pause.
  const lastQ = useRef<string | null>(null);
  const brunoOn = useServerFlag("brunoSearch");
  const prefer = usePreferKey();
  // My team, sent only with a query saying "my" or "our" (src/shared/searchMine.ts).
  const myTeam = usePersonal().state.myTeam;
  const kindKey = kinds?.join(",") ?? "";
  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    // A new request: an earlier query's Bruno AI suggestion goes (it never reappears for a retyped query or a failed one).
    setRefining(false);
    setAi(null);
    const typed = lastQ.current !== null && lastQ.current !== query;
    lastQ.current = query;
    if (!query) { setRes({ q: "", hits: [] }); setError(null); setBusy(false); return; }
    setBusy(true);
    // A newer query (or leaving) drops the older request: the server isn't kept busy with queries nobody waits for.
    const ctrl = new AbortController();
    const run = () => {
      waiting.current = null;
      // A box limited to some kinds asks the server for only those, so other kinds (often teams) can't crowd its own out.
      apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}${kindKey ? `&kinds=${encodeURIComponent(kindKey)}` : "&answer=1"}${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}${!kindKey && myTeam && MINE.test(query) ? `&my=${myTeam}` : ""}${!kindKey && season != null ? `&season=${season}` : ""}`, { signal: ctrl.signal })
        .then((r) => {
          if (id !== seq.current) return;
          // Offline (saved data) answers plain hits: the plain list, as before.
          const answer = !kindKey && isAnswer(r) ? r : undefined;
          setRes({ q: query, season, hits: kindKey ? r.hits.filter((h) => kindKey.split(",").includes(h.kind)) : r.hits, answer, live: true, saved: offlineSource(r) != null });
          setError(null);
          if (answer?.weak && brunoOn && refine) {
            setRefining(true);
            // 204 (null): he had nothing to add. Failing or slow: search's own answer stands.
            apiFetch<SearchAnswer | null>(`/api/search/refine?q=${encodeURIComponent(query)}&limit=${limit}`)
              .then((a) => { if (id === seq.current) setAi({ q: query, answer: isAnswer(a) ? a : null }); })
              .catch(() => {})
              .finally(() => { if (id === seq.current) setRefining(false); });
          }
        })
        .catch((e) => { if (id === seq.current) { setRes({ q: query, season, hits: [] }); setError(e.message); } }) // the query is answered (with an error): the spinner stops
        .finally(() => { if (id === seq.current) setBusy(false); });
    };
    // Opening a page with its query, a retry or a change of preferred teams asks at once.
    const t = setTimeout(run, typed ? SEARCH_DEBOUNCE_MS : 0);
    waiting.current = { q: query, run: () => { clearTimeout(t); run(); } };
    return () => { clearTimeout(t); ctrl.abort(); waiting.current = null; };
  }, [q, prefer, myTeam, kindKey, limit, brunoOn, refine, attempt, season]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** Enter: search this query now, without waiting for the typing pause. */
  const searchNow = useCallback(() => { if (waiting.current?.q === q.trim()) waiting.current.run(); }, [q]);
  const current = res.q === q.trim() && (res.season ?? null) === season;
  // While a newer query is on its way, the last answer stays on screen (dimmed, marked stale) instead of the list
  // emptying at every keystroke: typing never flickers to a bare "Searching…" between replies.
  const stale = !current && !!res.live && !!res.q && !!q.trim();
  const shown = current || stale;
  // One opened result from a whole answer, sent with its query: the server counts what the query asked for, and (when
  // learning is on) the pick. Aggregate only: the query and the result, nothing about who.
  const logPick = useCallback((h: SearchHit) => {
    if (!res.answer || !current) return;
    const body = JSON.stringify({ q: res.q, kind: h.kind, ref: h.ref });
    try {
      if (!navigator.sendBeacon?.("/api/search/click", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/search/click", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
      }
    } catch { /* counting a click is never worth an error */ }
  }, [res, current]);
  return {
    hits: shown ? res.hits : [], answer: shown ? res.answer : undefined, stale,
    /** Stale only by its season: the same query asked about another (the answer's season picker). */
    reseason: stale && res.q === q.trim(), saved: current && !!res.saved,
    ai: brunoOn && shown && ai?.q === res.q ? ai.answer : null, refining: brunoOn && current && refining,
    busy: busy || (!!q.trim() && !current), error: current ? error : null, retry, searchNow, logPick,
    /** What's shown answers this query, from this hook's own request (not `initial`'s hits). */
    live: current && !!res.live,
    /** The visitor's preferred teams and events, as sent with the search (Bruno's answer is asked with the same). */
    prefer,
  };
}

const ICONS: Record<HitKind, typeof Users> = { compare: ArrowLeftRight, place: MapPin, team: Users, event: CalendarDays, match: Swords };
export const GROUPS: [HitKind, string, typeof Users][] = SEARCH_GROUPS.map(([k, title]) => [k, title, ICONS[k]]);

/** A row's icon: its kind's, or its section's for pages, browsing and Bruno AI's suggestion. */
export function rowIcon(section: SectionId | DropId, row: AnswerRow): typeof Users {
  if (section === "pages") return FileText;
  if (section === "browse") return Compass;
  if (section === "compare") return ArrowLeftRight;
  if (row.sub) return CalendarDays;
  // A team's own badge (as on the results page), never the people icon a whole set of teams has.
  if (row.hit.kind === "team") return Shield;
  return ICONS[row.hit.kind];
}

/** The sections a search lists: the whole answer's, or the plain kinds (offline, or a box limited to some kinds). */
export function useSections(hits: SearchHit[], answer: SearchAnswer | undefined, ai: SearchAnswer | null): { sections: AnswerSection[]; notes: AnswerNotes } {
  return useMemo(() => (answer ? answerSections({ ...answer, hits }, ai) : { sections: plainSections(hits), notes: { understood: [] } }), [hits, answer, ai]);
}

/** What the query was read as, above the rows: a correction, Bruno AI's reading, or what was understood.
 *  A correction is always labelled as one, never a silent swap: "Did you mean: …", and (given `query`) what was typed.
 *  `onDidYouMean` makes the correction a tap that runs it. */
export function AnswerNotesView({ notes, refining, className, query, onDidYouMean }: { notes: AnswerNotes; refining?: boolean; className?: string; query?: string; onDidYouMean?: (q: string) => void }) {
  const lines: ReactNode[] = [];
  if (notes.didYouMean) {
    const fix = notes.didYouMean;
    // Kept off the field's focus (as the rows are), so a tap in the header's list lands before it closes.
    // A link in its sentence, to the corrected search (running text: exempt from the 44px tap size, WCAG 2.5.8);
    // a plain tap runs it in place, a new-tab tap opens it.
    const said = onDidYouMean
      ? <a href={`/search?q=${encodeURIComponent(fix)}`} data-did-you-mean-link onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); onDidYouMean(fix); }}
        className={cn("font-semibold underline decoration-current/40 underline-offset-2 hover:decoration-current", SEARCH_PALETTE.reference.text)}>{fix}</a>
      : <b className={cn("font-semibold", SEARCH_PALETTE.reference.text)}>{fix}</b>;
    // In Reference's sky (search's palette: a pointer to what to read), a thick bar on its wash.
    lines.push(<span className={cn("inline-block rounded-md border-l-4 px-2 py-1 text-foreground", SEARCH_PALETTE.reference.edge, SEARCH_PALETTE.reference.tint)} data-did-you-mean>Did you mean: {said}{notes.corrected === false ? "" : <>. Showing results for that{query ? <>, not “{query}”</> : ""}.</>}</span>);
  }
  for (const u of notes.understood) lines.push(u);
  if (notes.gap) lines.push(<span className="inline-flex items-start gap-1 rounded-md border border-warning/40 bg-warning/[0.08] px-1.5 py-0.5 text-foreground"><Info className="mt-px size-3 shrink-0 text-warning" />{notes.gap}</span>);
  if (notes.ai) {
    lines.push(<span className="inline-flex items-center gap-1"><Sparkles className="size-3 shrink-0 text-accent" />{notes.ai.refined
      ? <>Bruno AI read this as <b className="font-medium text-foreground">“{notes.ai.refined}”</b>{notes.ai.found ? "" : ", and nothing matched that either"}</>
      : "Bruno AI found nothing more to search for"}</span>);
  } else if (refining) {
    lines.push(<span className="inline-flex items-center gap-1"><Loader2 className="size-3 shrink-0 animate-spin" />Asking Bruno AI for a better reading…</span>);
  }
  if (!lines.length) return null;
  return <div className={cn("space-y-0.5 text-xs text-muted-foreground", className)}>{lines.map((l, i) => <p key={i}>{l}</p>)}</div>;
}

/** The numbers a search asked about ("hypnotic ranking points"), under the top team's name. */
export function HitFacts({ facts }: { facts: SearchFact[] }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {facts.map((f) => (
        <span key={f.label} className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-accent/25 bg-accent/[0.07] px-1.5 py-0.5 text-[11px]">
          <span className="shrink-0 text-muted-foreground">{f.label}</span><span className="truncate font-medium tabular-nums text-foreground">{f.value}</span>
        </span>
      ))}
    </span>
  );
}

/** One row's text: the name (wrapping before it cuts: event divisions differ only at the end), then season and
 *  details, the numbers asked about, and where it opens ("controlscout.org/teams/4215#opr"). */
/** `opr`: a team row's one compact number, its season OPR, when the server sends it and the row shows no asked-for
 *  numbers of its own (the full set of badges is on the results page). */
export function HitText({ h, opr }: { h: SearchHit; opr?: boolean }) {
  const o = opr && !h.facts?.length ? teamOpr(h) : null;
  return (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-start gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 break-words">{h.title}</span>
        {o != null && <span className="mt-px shrink-0 rounded-md border border-border bg-muted/50 px-1.5 py-px text-[11px]" data-opr><span className="text-muted-foreground">OPR </span><span className="font-semibold tabular-nums text-foreground">{o.toFixed(1)}</span></span>}
      </span>
      {(h.subtitle || h.season != null) && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {(h.kind === "event" || h.kind === "match" || h.atEvent) && h.season != null && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80">{seasonLabel(h.season)}</span>}
          <span className="truncate">{h.subtitle}</span>
        </span>
      )}
      {h.facts?.length ? <HitFacts facts={h.facts} /> : null}
      <span className="mt-0.5 block truncate font-mono text-[11px] text-accent-text/80" data-path>{shownPath(h)}</span>
    </span>
  );
}

/** An event row: its name (a division's in full), then season, dates and place from the event's own facts, and Live
 *  while it's on. No event code or raw date: the row reads like the Events list. */
export function EventText({ h }: { h: SearchHit }) {
  const e = eventFacts(h);
  return (
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 break-words">{h.title}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-event-when>
        {h.season != null && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80">{seasonLabel(h.season)}</span>}
        {e.status === "live" && <EventStatusChip status="live" className="shrink-0 px-1.5 py-px text-[10px]" />}
        <span className="shrink-0 tabular-nums text-foreground/80">{e.start ? dateRange(e.start, e.end) : "Date to be announced"}</span>
        {e.place && <span className="truncate">· {e.place}</span>}
      </span>
      <span className="mt-0.5 block truncate font-mono text-[11px] text-accent-text/80" data-path>{shownPath(h)}</span>
    </span>
  );
}

/** "X vs Y" as an action, not a team: its own icon and accent, both teams by name and number, and where it goes. */
function CompareRow({ id, h, active, onPick, onHover }: { id: string; h: SearchHit; active: boolean; onPick: () => void; onHover: () => void }) {
  const sides = compareSides(h);
  const names = h.title.split(/\s+vs\.?\s+/i);
  const nums = compareTeams(h);
  const who = nums.length >= 2
    ? nums.map((n, i) => { const name = sides.find((x) => x.number === n)?.name ?? teamParts(names[i] ?? "")?.name; return name ? `${name} (${n})` : `Team ${n}`; })
    : [h.title];
  return (
    <div
      id={id} role="option" aria-selected={active} data-compare
      onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={onPick} onPointerMove={onHover}
      className={cn("mx-0.5 flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-sm", active ? "border-accent bg-accent/[0.16]" : "border-accent/40 bg-accent/[0.07]")}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-ink"><ArrowLeftRight className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium text-foreground">{who.map((w, i) => <span key={i}>{i > 0 && <span className="px-1 text-accent-text">vs</span>}{w}</span>)}</span>
        {/* The server's own line: it says when some of the teams named were left out of the comparison. */}
        <span className="block break-words text-xs text-muted-foreground">{h.subtitle || "Compare side by side: records, OPR and event history"}</span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-accent-text/80" data-path>{shownPath(h)}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink max-[380px]:hidden">Compare<ArrowRight className="size-3.5" aria-hidden /></span>
    </div>
  );
}

export interface SearchBoxProps {
  onPick: (h: SearchHit) => void;
  kinds?: HitKind[];
  placeholder: string;
  label: string;
  size?: "md" | "lg";
  className?: string;
  /** Extra classes for the field's own bordered row (e.g. a taller bar on a phone). */
  fieldClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Shown under the field while it's empty and focused (e.g. quick picks). */
  emptyHint?: ReactNode;
  autoFocus?: boolean;
  /** Called whenever the box closes on its own (Escape on an empty field, focus leaving, a pick). */
  onClose?: () => void;
  /** Escape on an empty, closed field (after onClose): where focus goes next. Without it, focus leaves the field. */
  onEscape?: () => void;
  /** Keyboard shortcut shown at the right while the field is empty (e.g. "⌘K"). */
  hint?: string;
  /** Text to start with, its results already open (a search arriving in the URL). Read on mount only. */
  initialQuery?: string;
  /** The last row, "See all results for …", and plain Enter open the full results page (/search?q=…). Off for a box
   *  that picks something instead of going somewhere (Predict's team picker). */
  seeAll?: boolean;
  /** FTC One Search's teaching parts in the empty field's list: this device's recent searches, one tap to run again
   *  (with Clear), and, with `examples`, chips of real example queries. */
  discover?: boolean;
  examples?: boolean;
  /** The query the page is showing (the /search page's, in the top bar): the field holds it, re-set whenever it
   *  changes, without opening the list. Until it's edited it isn't searched again (the page already shows its
   *  results); Enter or the magnifier run it again. Undefined on other pages. */
  syncQuery?: string;
}

/** A phone's keyboard (and its accessory bar) covers the bottom of the page without making it shorter: while it's
 *  up, the list's height is what's left between its top and the keyboard, so no row sits underneath. Null otherwise
 *  (no keyboard, pinch-zoomed, or no visualViewport): the list keeps its usual height. */
export function useRoomAboveKeyboard(el: RefObject<HTMLElement | null>, on: boolean): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!on || !vv) { setRoom(null); return; }
    const fit = () => {
      const top = el.current?.getBoundingClientRect().top;
      const keyboard = window.innerHeight - vv.height > 150 && Math.abs(vv.scale - 1) < 0.01;
      // The visible area's bottom, in the same (layout viewport) coordinates as the list's top.
      // Exactly the room there is, however little: a taller list would put its last rows under the keyboard.
      setRoom(top == null || !keyboard ? null : Math.max(0, Math.floor(vv.offsetTop + vv.height - top - 12)));
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); window.removeEventListener("scroll", fit); };
  }, [el, on]);
  return room;
}

/** The full results page for a query: where plain Enter and the last row go. */
export const searchPagePick = (q: string): SearchHit => ({ kind: "place", ref: "search", title: `See all results for “${q}”`, subtitle: "", season: null, href: `/search?q=${encodeURIComponent(q)}` });

/** A question's direct answer (src/shared/api.ts SearchCard): what was found, each a link, or a plain "none found"
 *  with the closest real records. `compact`: the dropdown's (the first lines only). */
export function AnswerCard({ card, compact, onOpen }: { card: SearchCard; compact?: boolean; onOpen: (href: string) => void }) {
  const lines = card.lines.length ? card.lines : card.closest ?? [];
  const shown = compact ? lines.slice(0, 2) : lines;
  const who = cardWho(card);
  return (
    <div role="note" aria-label={who ? `${card.title}: ${who}` : card.title} className={cn("rounded-xl border border-accent/30 bg-accent/[0.06]", compact ? "mx-1.5 mb-1 mt-1.5 px-3 py-2" : "px-4 py-3")}>
      <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 font-semibold text-foreground", compact ? "text-xs" : "text-sm")}>
        {/* A rule's answer (the game manual) has a book; records have the trophy. */}
        {card.kind === "rule" ? <BookOpen className="size-3.5 shrink-0 text-accent" data-card-icon="rule" /> : <Trophy className="size-3.5 shrink-0 text-accent" />}{card.title}{who && ` · ${who}`}
        {!!card.count && <span className="rounded-full bg-accent/15 px-2 py-px text-[11px] font-semibold tabular-nums text-accent-text">{card.count} {card.count === 1 ? "time" : "times"}</span>}
      </p>
      {card.none && <p className={cn("mt-1 text-foreground/90", compact ? "text-xs" : "text-sm")}>{card.none}</p>}
      {/* A list of teams on the full page: one table of their season numbers (./TeamTable.tsx); the dropdown keeps lines. */}
      {!compact && !!card.table?.rows.length ? <div className="mt-2"><TeamTable table={card.table} label={card.title} /></div> : !!shown.length && (
        <>
          {card.none && <p className="mt-1.5 text-xs font-semibold text-muted-foreground">Closest records</p>}
          {/* Full page: a row per record, divided by lines, how it went as bullets. The dropdown keeps it to a line. */}
          <ul className={cn(compact ? "mt-1 space-y-1 text-xs" : "mt-2 divide-y divide-accent/15 text-sm")}>
            {shown.map((l, i) => (
              <li key={i} className={cn(!compact && "py-2.5 first:pt-1 last:pb-0.5")}>
                {l.href
                  ? /^https?:\/\//.test(l.href)
                    // Another site (FIRST's manual): an ordinary link, in a new tab.
                    ? <a href={l.href} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} className="font-medium text-accent-text hover:underline">{l.text}</a>
                    : <a href={l.href} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); onOpen(l.href!); }} className="font-medium text-accent-text hover:underline">{l.text}</a>
                  : <span className="font-medium text-foreground">{l.text}</span>}
                {l.detail && <span className={cn("block text-muted-foreground", !compact && "mt-0.5 text-xs")}>{l.detail}</span>}
                {!!l.results?.length && (compact
                  ? <span className="block text-muted-foreground">{l.results.join(" · ")}</span>
                  : (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-foreground/90 marker:text-accent">
                      {l.results.map((r, j) => <li key={j}>{r}</li>)}
                    </ul>
                  ))}
              </li>
            ))}
          </ul>
          {compact && lines.length > shown.length && <p className="mt-1 text-[11px] text-muted-foreground">{lines.length - shown.length} more on the full results page</p>}
        </>
      )}
    </div>
  );
}

export function SearchBox({ onPick, kinds, placeholder, label, size = "md", className, fieldClassName, inputRef, emptyHint, autoFocus, onClose, onEscape, hint, initialQuery, seeAll = true, discover, examples, syncQuery }: SearchBoxProps) {
  const [q, setQ] = useState(initialQuery ?? syncQuery ?? "");
  const [open, setOpen] = useState(!!initialQuery);
  const synced = useRef(syncQuery);
  useEffect(() => {
    if (synced.current === syncQuery) return;
    synced.current = syncQuery;
    setQ(syncQuery ?? "");
    setOpen(false);
  }, [syncQuery]);
  // The page's own query, unedited: its results are on the page, so the box doesn't ask for them again.
  const idle = syncQuery !== undefined && q === syncQuery;
  // Nothing is highlighted until the arrow keys or the pointer pick a row: plain Enter opens the full results page.
  const [active, setActive] = useState(-1);
  const { hits, answer, ai, refining, busy, error, logPick, stale, searchNow } = useSearchHits(idle ? "" : q, kinds);
  const { sections: answered, notes: answerNotes } = useSections(hits, answer, ai);
  // The page's order, a Compare first in its own group, and the live "we understood" line (Requirement 17).
  const sections = useMemo(() => dropdownSections(answered, hits), [answered, hits]);
  const notes = useMemo(() => dropdownNotes(answerNotes, answer), [answerNotes, answer]);
  const meta = useMeta();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The field itself (the caller's inputRef is set too): the magnifier focuses it when there's nothing to search.
  const field = useRef<HTMLInputElement | null>(null);
  const setField = useCallback((el: HTMLInputElement | null) => {
    field.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  }, [inputRef]);
  // How many results sit below the visible part of the dropdown (drives the "more below" cue).
  const [below, setBelow] = useState(0);
  const measure = () => {
    const el = list.current;
    if (!el) { setBelow(0); return; }
    const bottom = el.scrollTop + el.clientHeight;
    setBelow(el.scrollHeight - bottom > 6 ? [...el.querySelectorAll<HTMLElement>("[role=option]")].filter((o) => o.offsetTop + o.offsetHeight / 2 > bottom).length : 0);
  };
  const listId = useId();
  // In the order shown, so arrow keys walk the list top to bottom.
  const ordered = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  // The highlight follows its row, not its place: Bruno AI's group arriving above never moves it to another result
  // (Enter still opens what was highlighted). A row that's gone, or new results (another query): nothing highlighted.
  const activeKey = useRef<string | null>(null);
  const shownHits = useRef(hits);
  useEffect(() => {
    const fresh = shownHits.current !== hits;
    shownHits.current = hits;
    const i = !fresh && activeKey.current ? ordered.findIndex((r) => r.key === activeKey.current) : -1;
    setActive(i >= 0 ? i : -1);
  }, [ordered, hits]);
  useEffect(() => { activeKey.current = ordered[active]?.key ?? null; }, [ordered, active]);
  // Typing again: nothing highlighted (an older query's row is never Enter's pick).
  useEffect(() => { setActive(-1); activeKey.current = null; }, [q]);
  // Re-measure the "more below" cue whenever the list's contents change.
  useEffect(() => { measure(); }, [sections, open, q, busy]);
  // …and when the list's own size changes (window resized, phone rotated).
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  });
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest", behavior: smoothBehavior() }); }, [active, open, listId]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  // A box holding the page's query keeps it (a pick that lands back on that page shows it again).
  const go = (h: SearchHit) => { onPick(h); setQ(syncQuery ?? ""); setOpen(false); (document.activeElement as HTMLElement | null)?.blur?.(); onClose?.(); };
  // A search of everything (not a picker, not a box limited to some kinds): what was searched is remembered on
  // this device, for the recent searches list.
  const remember = seeAll && !kinds;
  const pick = (h: SearchHit) => { logPick(h); if (remember && q.trim()) addRecentSearch(q); go(h); };
  // Enter pressed before a picker's results were in: the query it was pressed on, until they arrive.
  const enterFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enterFor.current) return;
    // Closed (Escape, a click away, leaving the field) or retyped: the Enter is dropped, never acted on later.
    if (!open || enterFor.current !== q.trim()) { enterFor.current = null; return; }
    if (busy || stale) return;
    enterFor.current = null;
    if (ordered[0]) pick(ordered[0].hit);
  });
  const query = q.trim();
  // The last row: the full results page. Its index is right after the results', so the arrow keys reach it too.
  const full = seeAll && !!query;
  const recent = useRecentSearches();
  // The empty field's suggestions (this device's recent searches, then examples): options like results, so the
  // arrow keys walk them and Enter runs the highlighted one. A page's own emptyHint replaces them.
  const suggestions = useMemo(() => (emptyHint ? [] : [
    ...(discover ? recent.map((text) => ({ text, recent: true })) : []),
    ...(examples ? SEARCH_EXAMPLES.map((text) => ({ text, recent: false })) : []),
  ]), [emptyHint, discover, examples, recent]);
  const count = query ? ordered.length + (full ? 1 : 0) : suggestions.length;
  /** The full results page for a query: the one typed, or a recent search or example tapped. */
  const runQuery = (text: string) => { if (remember) addRecentSearch(text); go(searchPagePick(text.trim())); };
  const openFull = () => runQuery(query);
  // A query that names one thing exactly (a team number, "team 6980", one team's whole name, an event code), as the
  // server's answer for it reads: straight to its page. Anything else, the full results page. With the answer not in
  // yet, /search at once (never a wait here), which goes on to that one page itself when its answer names one. A team
  // always goes by /search: only the results page's answer says whether it has highlights to show (direct.ts).
  const openDirectOrFull = () => {
    const d = !idle && !busy && !stale ? directHit(answer, query) : null;
    if (d && d.kind !== "team") pick(d);
    else { markDirect(query); openFull(); }
  };
  // Enter, the keyboard's Search key and the magnifier: the highlighted row (Enter only); with none, the full results
  // page (a picker box: its top result, once it's current).
  const submit = (highlighted: boolean) => {
    if (highlighted && !stale && active >= 0 && ordered[active]) pick(ordered[active].hit);
    // "See all results" highlighted: the results page, as clicking it does (never the one result it names).
    else if (highlighted && full && active === ordered.length) openFull();
    // A search box never waits: the one page its answer names, else /search (at once).
    else if (full) openDirectOrFull();
    else if (!stale && !busy && ordered[0]) pick(ordered[0].hit);
    // A picker box whose results aren't in yet: ask now, and open the top result when they arrive (one press).
    // (Open again first: a list closed meanwhile would drop the pending pick.)
    else { setOpen(true); enterFor.current = query; searchNow(); }
  };
  const keep = (e: React.SyntheticEvent) => e.preventDefault(); // a press that mustn't take focus from the field
  const suggestion = (i: number) => ({
    id: `${listId}-${i}`, role: "option", "aria-selected": i === active,
    onPointerDown: keep, onMouseDown: keep, onClick: () => runQuery(suggestions[i].text), onPointerMove: () => setActive(i),
  });
  const recentCount = suggestions.filter((x) => x.recent).length;
  const hintContent = emptyHint ?? (suggestions.length ? (
    <>
      {recentCount > 0 && (
        <div role="group" aria-label="Recent searches">
          <p className="flex items-center justify-between px-3 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">
            Recent searches
            <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={clearRecentSearches}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-text hover:underline pointer-coarse:min-h-[44px]">Clear</button>
          </p>
          {suggestions.slice(0, recentCount).map((x, i) => (
            <div key={x.text} {...suggestion(i)} data-recent
              className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm pointer-coarse:min-h-[44px]", i === active ? "bg-accent/[0.12] text-foreground" : "text-foreground/90")}>
              <Clock className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{x.text}</span>
            </div>
          ))}
        </div>
      )}
      {suggestions.length > recentCount && (
        <div role="group" aria-label="Example searches" className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5 pt-2 text-sm text-muted-foreground">
          <span aria-hidden>Try:</span>
          {suggestions.slice(recentCount).map((x, j) => {
            const i = recentCount + j;
            return (
              <span key={x.text} {...suggestion(i)} data-example
                className={cn("inline-flex cursor-pointer items-center rounded-full border px-3 py-1 text-foreground max-md:min-h-[44px] pointer-coarse:min-h-[44px]", i === active ? "border-accent bg-accent/[0.12]" : "border-border hover:border-accent/60")}>
                {x.text}
              </span>
            );
          })}
        </div>
      )}
    </>
  ) : undefined);
  const showList = open && (query ? !idle : !!hintContent);
  // A closed list highlights nothing: Enter after Escape never opens a row or suggestion that was dismissed.
  useEffect(() => { if (!showList) { setActive(-1); activeKey.current = null; } }, [showList]);
  const room = useRoomAboveKeyboard(list, showList);
  const lg = size === "lg";
  return (
    <div ref={box} data-search-box data-opens-search={seeAll && !kinds ? "" : undefined} className={cn("relative", className)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) { setOpen(false); onClose?.(); } }}>
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-card text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]", lg ? "h-14 px-4" : "h-9 px-3", fieldClassName)}>
        {/* The magnifier searches, like Enter: it never just focuses the field (only an empty one, with nothing to
            search). The press keeps focus in the field so the list stays open until the search goes; going closes
            the keyboard. */}
        <button
          type="button" aria-label="Run search" data-search-submit
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (query) submit(false); else field.current?.focus(); }}
          className={cn("-ml-1 flex shrink-0 items-center justify-center rounded-lg outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:size-[44px] pointer-coarse:-my-1", lg ? "size-9 -mr-1" : "size-7 -mr-1.5")}
        >
          {busy ? <Loader2 className={cn("animate-spin text-muted-foreground", lg ? "size-5" : "size-4")} /> : <Search className={cn("text-accent", lg ? "size-5" : "size-4")} />}
        </button>
        <input
          ref={setField} value={q} autoFocus={autoFocus} enterKeyHint={full ? "search" : "go"}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            // Escape: closes the list and stays in the field; again clears it; on an empty, closed field, leaves it.
            if (e.key === "Escape") { if (showList) setOpen(false); else if (q) setQ(""); else { (e.target as HTMLInputElement).blur(); onClose?.(); onEscape?.(); } return; }
            // Enter: the highlighted row; with none, the full results page (a picker box: its top result, once it's current).
            if (e.key === "Enter" && query) { e.preventDefault(); submit(true); return; }
            // Enter on the empty field: the highlighted suggestion; nothing highlighted, nothing to search.
            if (e.key === "Enter") { if (active >= 0 && suggestions[active]) { e.preventDefault(); runQuery(suggestions[active].text); } return; }
            if (!count) return;
            if (e.key === "ArrowDown") { e.preventDefault(); if (!showList) { setOpen(true); return; } setActive((i) => (i + 1) % count); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? count - 1 : i - 1)); }
          }}
          placeholder={placeholder} aria-label={label}
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 && active < count ? `${listId}-${active}` : undefined}
          className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground", lg ? "text-base" : "text-sm")}
        />
        {!q && hint && <kbd className="hidden shrink-0 rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground sm:inline">{hint}</kbd>}
        {/* A touch screen: a 44px target (the icon alone is too small to hit), pulled into the row's padding. */}
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground pointer-coarse:-my-1 pointer-coarse:-mr-2 pointer-coarse:size-[44px]"><X className="size-4" /></button>}
      </div>
      {showList && (
        <m.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]">
        <div ref={list} id={listId} role="listbox" aria-label={`${label} results`} aria-busy={stale || undefined} onScroll={measure}
          style={room != null ? { maxHeight: `min(26rem, ${room}px)` } : undefined}
          className={cn("relative max-h-[min(26rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain p-1.5 transition-opacity", stale && "opacity-60")}>
          {!query ? hintContent : error ? <p className="px-3 py-2.5 text-sm text-destructive">{error}</p>
            : !ordered.length && !answer?.card ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">{busy ? "Searching…" : meta && !meta.dataLoaded ? "No FTC data has been loaded on this server yet, so there's nothing to search."
                : full ? <>No team, event or match matches “{query}” yet. Check the spelling, or try a team number or an event name. The full results page has places to browse.</> : <>Nothing matches “{query}”.</>}</p>
            ) : (
              <>
                <AnswerNotesView notes={notes} refining={refining} query={stale ? undefined : query} className="px-3 pb-1 pt-1.5" onDidYouMean={(fix) => { setQ(fix); field.current?.focus(); }} />
                {answer?.card && <AnswerCard card={answer.card} compact onOpen={(href) => { if (remember) addRecentSearch(query); go({ ...searchPagePick(query), href }); }} />}
                {sections.map((s) => (
                  <div key={s.id} role="group" aria-label={s.title}>
                    <p className={cn("flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-semibold", s.id === "ai" ? "text-accent-text" : "text-muted-foreground")}>
                      {s.id === "ai" && <Sparkles className="size-3" />}{s.title}
                      {s.id !== "pages" && s.id !== "browse" && s.id !== "compare" && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80" data-count>{groupCount(s, answer)}</span>}
                    </p>
                    {s.rows.map((r) => {
                      const i = ordered.indexOf(r);
                      if (s.id === "compare") return <CompareRow key={r.key} id={`${listId}-${i}`} h={r.hit} active={i === active} onPick={() => pick(r.hit)} onHover={() => setActive(i)} />;
                      const Icon = rowIcon(s.id, r);
                      return (
                        <div
                          key={r.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                          // Keep focus in the field so the list doesn't close before the click lands. Both are needed:
                          // on an iPhone a tap still sends mousedown after a cancelled pointerdown, and that blurs the field.
                          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r.hit)} onPointerMove={() => setActive(i)}
                          className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm", r.sub && "pl-9", i === active ? "bg-accent/[0.12] text-foreground" : "text-foreground/90")}
                        >
                          <Icon className={cn("size-4 shrink-0", r.hit.kind === "place" && !r.hit.href ? "text-accent" : "text-muted-foreground")} />
                          {r.hit.kind === "event" && !r.sub ? <EventText h={r.hit} /> : <HitText h={r.hit} opr={r.hit.kind === "team" && !r.sub} />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          {full && !error && (
            <div
              id={`${listId}-${ordered.length}`} role="option" aria-selected={active === ordered.length} data-see-all
              onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={openFull} onPointerMove={() => setActive(ordered.length)}
              className={cn("mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg border-t border-border px-3 py-2 text-sm font-medium text-accent-text", active === ordered.length && "bg-accent/[0.12]")}
            >
              <Search className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">See all results for “{query}”</span>
              <ArrowRight className="size-4 shrink-0" />
            </div>
          )}
        </div>
        {below > 0 && (
          // The cue: results continue below. Fades the last row and offers a one-tap scroll.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-popover via-popover/85 to-transparent pb-2">
            <button type="button" tabIndex={-1} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => list.current?.scrollBy({ top: list.current.clientHeight * 0.8, behavior: smoothBehavior() })}
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-accent/40 bg-popover px-3 py-1 text-xs font-medium text-accent-text shadow-sm hover:border-accent">
              {below} more below <ChevronDown className="size-3.5 motion-safe:animate-bounce" />
            </button>
          </div>
        )}
        </m.div>
      )}
    </div>
  );
}
