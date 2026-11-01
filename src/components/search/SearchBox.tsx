// Inline search: a field with a results dropdown under it. The page behind it
// stays fully usable (no modal, no focus trap). Content only: teams, events
// and matches, plus the site pages a whole word names (docs/search.md) —
// navigation lives in the nav.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { smoothBehavior } from "../../lib/pageScroll";
import { ArrowRight, CalendarDays, ChevronDown, Compass, FileText, Info, Loader2, MapPin, Search, Sparkles, Swords, Trophy, Users, X } from "lucide-react";
import { m } from "../motion";
import { apiFetch } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { useMeta } from "../../lib/meta";
import { useServerFlag } from "../../lib/flags";
import type { SearchAnswer, SearchCard, SearchFact, SearchHit } from "../../shared/api";
import { SEARCH_GROUPS, shownPath } from "../../shared/search";
import { cn } from "../cn";
import { seasonLabel } from "../../lib/format";
import { answerSections, isAnswer, plainSections, type AnswerNotes, type AnswerRow, type AnswerSection, type SectionId } from "../../shared/searchSections";

export type HitKind = SearchHit["kind"];

export { hitHref } from "../../shared/search";

/** How long typing pauses before search asks (each key doesn't send a request). */
export const SEARCH_DEBOUNCE_MS = 200;

type Answered = { q: string; hits: SearchHit[]; answer?: SearchAnswer; /** Fetched here (not the first paint's): only these stay on screen for a newer query. */ live?: boolean };

/** Debounced search; my team, tracked and shortlisted teams/events rank first among equal matches.
 *  Without `kinds` it asks for the whole answer (step, pages, recovery), and when that answer is weak and Bruno AI
 *  is on, asks him after the answer is on screen (never before: his reading can't slow the first results).
 *  `initial`: results already on screen (the server's, on /search), shown while the first request refreshes them. */
/** `refine`: off where Bruno AI's suggestion isn't shown (the /search page), so he's never asked for nothing. */
export function useSearchHits(q: string, kinds?: HitKind[], limit = 15, initial?: { q: string; hits: SearchHit[] } | null, refine = true) {
  // Results remember the query they answer, so a pick can never come from a previous query.
  const [res, setRes] = useState<Answered>(() => (initial ? { q: initial.q, hits: initial.hits, answer: isAnswer(initial) ? initial : undefined } : { q: "", hits: [] }));
  const [ai, setAi] = useState<{ q: string; answer: SearchAnswer | null } | null>(null);
  const [refining, setRefining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const brunoOn = useServerFlag("brunoSearch");
  const { state } = usePersonal();
  const prefer = useMemo(() => [...new Set([
    ...(state.myTeam ? [`team:${state.myTeam}`] : []),
    ...state.tracked.teams.map((t) => `team:${t}`),
    ...state.bookmarks.map((t) => `team:${t}`),
    ...state.tracked.events.map((e) => `event:${e}`),
  ])].slice(0, 100).join(","), [state.myTeam, state.tracked, state.bookmarks]);
  const kindKey = kinds?.join(",") ?? "";
  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    // A new request: an earlier query's Bruno AI suggestion goes (it never reappears for a retyped query or a failed one).
    setRefining(false);
    setAi(null);
    if (!query) { setRes({ q: "", hits: [] }); setError(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(() => {
      // A box limited to some kinds asks the server for only those, so other kinds (often teams) can't crowd its own out.
      apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}${kindKey ? `&kinds=${encodeURIComponent(kindKey)}` : "&answer=1"}${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`)
        .then((r) => {
          if (id !== seq.current) return;
          // Offline (saved data) answers plain hits: the plain list, as before.
          const answer = !kindKey && isAnswer(r) ? r : undefined;
          setRes({ q: query, hits: kindKey ? r.hits.filter((h) => kindKey.split(",").includes(h.kind)) : r.hits, answer, live: true });
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
        .catch((e) => { if (id === seq.current) { setRes({ q: query, hits: [] }); setError(e.message); } }) // the query is answered (with an error): the spinner stops
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, prefer, kindKey, limit, brunoOn, refine]);
  const current = res.q === q.trim();
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
    ai: brunoOn && shown && ai?.q === res.q ? ai.answer : null, refining: brunoOn && current && refining,
    busy: busy || (!!q.trim() && !current), error: current ? error : null, logPick,
  };
}

const ICONS: Record<HitKind, typeof Users> = { place: MapPin, team: Users, event: CalendarDays, match: Swords };
export const GROUPS: [HitKind, string, typeof Users][] = SEARCH_GROUPS.map(([k, title]) => [k, title, ICONS[k]]);

/** A row's icon: its kind's, or its section's for pages, browsing and Bruno AI's suggestion. */
export function rowIcon(section: SectionId, row: AnswerRow): typeof Users {
  if (section === "pages") return FileText;
  if (section === "browse") return Compass;
  if (row.sub) return CalendarDays;
  return ICONS[row.hit.kind];
}

/** The sections a search lists: the whole answer's, or the plain kinds (offline, or a box limited to some kinds). */
export function useSections(hits: SearchHit[], answer: SearchAnswer | undefined, ai: SearchAnswer | null): { sections: AnswerSection[]; notes: AnswerNotes } {
  return useMemo(() => (answer ? answerSections({ ...answer, hits }, ai) : { sections: plainSections(hits), notes: { understood: [] } }), [hits, answer, ai]);
}

/** What the query was read as, above the rows: a correction, Bruno AI's reading, or what was understood. */
export function AnswerNotesView({ notes, refining, className }: { notes: AnswerNotes; refining?: boolean; className?: string }) {
  const lines: ReactNode[] = [];
  if (notes.didYouMean) lines.push(<>Showing results for <b className="font-medium text-foreground">“{notes.didYouMean}”</b></>);
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
export function HitText({ h }: { h: SearchHit }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 break-words">{h.title}</span>
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

export interface SearchBoxProps {
  onPick: (h: SearchHit) => void;
  kinds?: HitKind[];
  placeholder: string;
  label: string;
  size?: "md" | "lg";
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Shown under the field while it's empty and focused (e.g. quick picks). */
  emptyHint?: ReactNode;
  autoFocus?: boolean;
  /** Called whenever the box closes on its own (Escape on an empty field, focus leaving, a pick). */
  onClose?: () => void;
  /** Keyboard shortcut shown at the right while the field is empty (e.g. "⌘K"). */
  hint?: string;
  /** What the first-run tour calls this box (data-tour), e.g. "search". */
  tour?: string;
  /** Text to start with, its results already open (a search arriving in the URL). Read on mount only. */
  initialQuery?: string;
  /** The last row, "See all results for …", and plain Enter open the full results page (/search?q=…). Off for a box
   *  that picks something instead of going somewhere (Predict's team picker). */
  seeAll?: boolean;
}

/** The full results page for a query: where plain Enter and the last row go. */
export const searchPagePick = (q: string): SearchHit => ({ kind: "place", ref: "search", title: `See all results for “${q}”`, subtitle: "", season: null, href: `/search?q=${encodeURIComponent(q)}` });

/** A question's direct answer (src/shared/api.ts SearchCard): what was found, each a link, or a plain "none found"
 *  with the closest real records. `compact`: the dropdown's (the first lines only). */
export function AnswerCard({ card, compact, onOpen }: { card: SearchCard; compact?: boolean; onOpen: (href: string) => void }) {
  const lines = card.lines.length ? card.lines : card.closest ?? [];
  const shown = compact ? lines.slice(0, 2) : lines;
  const who = card.team.name ? `${card.team.name} (${card.team.number})` : `Team ${card.team.number}`;
  return (
    <div role="note" aria-label={`${card.title}: ${who}`} className={cn("rounded-xl border border-accent/30 bg-accent/[0.06]", compact ? "mx-1.5 mb-1 mt-1.5 px-3 py-2" : "px-4 py-3")}>
      <p className={cn("flex items-center gap-1.5 font-semibold text-foreground", compact ? "text-xs" : "text-sm")}><Trophy className="size-3.5 shrink-0 text-accent" />{card.title} · {who}{card.count ? ` · ${card.count} ${card.count === 1 ? "time" : "times"}` : ""}</p>
      {card.none && <p className={cn("mt-1 text-foreground/90", compact ? "text-xs" : "text-sm")}>{card.none}</p>}
      {!!shown.length && (
        <>
          {card.none && <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Closest records</p>}
          <ul className={cn("mt-1 space-y-1", compact ? "text-xs" : "text-sm")}>
            {shown.map((l, i) => (
              <li key={i}>
                {l.href
                  ? <a href={l.href} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); onOpen(l.href!); }} className="font-medium text-accent-text hover:underline">{l.text}</a>
                  : <span className="font-medium text-foreground">{l.text}</span>}
                {l.detail && <span className="block text-muted-foreground">{l.detail}</span>}
              </li>
            ))}
          </ul>
          {compact && lines.length > shown.length && <p className="mt-1 text-[11px] text-muted-foreground">{lines.length - shown.length} more on the full results page</p>}
        </>
      )}
    </div>
  );
}

export function SearchBox({ onPick, kinds, placeholder, label, size = "md", className, inputRef, emptyHint, autoFocus, onClose, hint, tour, initialQuery, seeAll = true }: SearchBoxProps) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [open, setOpen] = useState(!!initialQuery);
  // Nothing is highlighted until the arrow keys or the pointer pick a row: plain Enter opens the full results page.
  const [active, setActive] = useState(-1);
  const { hits, answer, ai, refining, busy, error, logPick, stale } = useSearchHits(q, kinds);
  const { sections, notes } = useSections(hits, answer, ai);
  const meta = useMeta();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
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
  const go = (h: SearchHit) => { onPick(h); setQ(""); setOpen(false); (document.activeElement as HTMLElement | null)?.blur?.(); onClose?.(); };
  const pick = (h: SearchHit) => { logPick(h); go(h); };
  const query = q.trim();
  // The last row: the full results page. Its index is right after the results', so the arrow keys reach it too.
  const full = seeAll && !!query;
  const count = ordered.length + (full ? 1 : 0);
  const openFull = () => go(searchPagePick(query));
  const showList = open && (query ? true : !!emptyHint);
  const lg = size === "lg";
  return (
    <div ref={box} data-search-box data-tour={tour} className={cn("relative", className)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) { setOpen(false); onClose?.(); } }}>
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-card text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]", lg ? "h-14 px-4" : "h-9 px-3")}>
        {busy ? <Loader2 className={cn("shrink-0 animate-spin text-muted-foreground", lg ? "size-5" : "size-4")} /> : <Search className={cn("shrink-0 text-accent", lg ? "size-5" : "size-4")} />}
        <input
          ref={inputRef} value={q} autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            // Escape: closes the list and stays in the field; again clears it; on an empty, closed field, leaves it.
            if (e.key === "Escape") { if (showList) setOpen(false); else if (q) setQ(""); else { (e.target as HTMLInputElement).blur(); onClose?.(); } return; }
            // Enter: the highlighted row; with none, the full results page (a picker box: its top result, once it's current).
            if (e.key === "Enter" && query) {
              e.preventDefault();
              if (!stale && active >= 0 && ordered[active]) pick(ordered[active].hit);
              else if (full) openFull();
              else if (!stale && ordered[0]) pick(ordered[0].hit);
              return;
            }
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
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
      </div>
      {showList && (
        <m.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]">
        <div ref={list} id={listId} role="listbox" aria-label={`${label} results`} aria-busy={stale || undefined} onScroll={measure}
          className={cn("relative max-h-[min(26rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain p-1.5 transition-opacity", stale && "opacity-60")}>
          {!query ? emptyHint : error ? <p className="px-3 py-2.5 text-sm text-destructive">{error}</p>
            : !ordered.length ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">{busy ? "Searching…" : meta && !meta.dataLoaded ? "No FTC data has been loaded on this server yet, so there's nothing to search."
                : full ? <>No team, event or match matches “{query}” yet. Check the spelling, or try a team number or an event name. The full results page has places to browse.</> : <>Nothing matches “{query}”.</>}</p>
            ) : (
              <>
                <AnswerNotesView notes={notes} refining={refining} className="px-3 pb-1 pt-1.5" />
                {answer?.card && <AnswerCard card={answer.card} compact onOpen={(href) => go({ ...searchPagePick(query), href })} />}
                {sections.map((s) => (
                  <div key={s.id} role="group" aria-label={s.title}>
                    <p className={cn("flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider", s.id === "ai" ? "text-accent-text" : "text-muted-foreground")}>
                      {s.id === "ai" && <Sparkles className="size-3" />}{s.title}
                      {s.id !== "pages" && s.id !== "browse" && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{s.rows.filter((r) => !r.sub).length}</span>}
                    </p>
                    {s.rows.map((r) => {
                      const i = ordered.indexOf(r);
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
                          <HitText h={r.hit} />
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
