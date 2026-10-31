// Scout redesign, step 1 (docs/mockups/scout-redesign.html, "Set the event once"): where the scout is and what
// they watch each match. One picker for the event: a search box on top, and under it a short list (events on
// today first, then the account's own team's events, then the next ones by date). A pick folds the picker to one
// "Scouting at … · Change" row and brings the next step into view, with Start pinned at the bottom. Nothing is
// saved here: Start hands the choice to the page (onStart), which keeps it with useScoutSession's `set`.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, MapPin, Play, RefreshCw, Search, SearchX, X } from "lucide-react";
import { apiFetch, qs } from "../../../lib/api";
import { dateRange, place } from "../../../lib/format";
import { scrollToElement, smoothBehavior } from "../../../lib/pageScroll";
import type { EventListItem, TeamProfile } from "../../../shared/api";
import { DEFAULT_WATCHING, SLOTS, slotLabel, watchingLabel, type AllianceSide, type SlotId, type Watching } from "../../../shared/scoutMatch";
import { Badge, Input } from "../../ui/basic";
import { Button } from "../../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../../ui/controls";
import { EmptyState, Section } from "../../page";
import { Skeleton } from "../../states";
import { cn } from "../../cn";
import { EVENT_SEARCH_DEBOUNCE, rankEvents } from "../EventPicker";

/** How many events the list shows before "Show more" (short, so the next step stays close), and how many upcoming ones it asks for. */
const PAGE = 5;
const UPCOMING = 40;
const SEARCH_CAP = 3000;

/** Today's date on this device, as event dates are written (YYYY-MM-DD, event-local). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const isOnToday = (e: Pick<EventListItem, "start" | "end">, today: string) => !!e.start && e.start <= today && (e.end ?? e.start) >= today;

export interface EventRow { event: EventListItem; today: boolean; mine: boolean }

/**
 * The list's order: events on today, then the account's team's events, then the rest by start date (each group
 * by date, then name). Events already over are left out; codes are listed once.
 */
export function orderEvents(events: readonly EventListItem[], today: string, teamCodes: ReadonlySet<string> = new Set()): EventRow[] {
  const seen = new Set<string>();
  const rows: EventRow[] = [];
  for (const e of events) {
    if (seen.has(e.code) || (e.end ?? e.start ?? today) < today) continue;
    seen.add(e.code);
    rows.push({ event: e, today: isOnToday(e, today), mine: teamCodes.has(e.code) });
  }
  const group = (r: EventRow) => (r.today ? 0 : r.mine ? 1 : 2);
  return rows.sort((a, b) => group(a) - group(b) || (a.event.start ?? "9").localeCompare(b.event.start ?? "9") || a.event.name.localeCompare(b.event.name));
}

const sideOf = (s: SlotId): AllianceSide => (s.startsWith("red") ? "red" : "blue");

const WATCH_OPTIONS: { kind: Watching["kind"]; title: string; help: string }[] = [
  { kind: "slot", title: "One team each match", help: "The most detail. Best when 4 people split a match." },
  { kind: "alliance", title: "One alliance", help: "Both teams on one side, as tabs. Full fields." },
  { kind: "all", title: "All 4 teams", help: "Quick mode: fewer fields per team, all on one screen." },
];

export interface SessionSetupProps {
  season: number;
  /** The session already running, to change it. */
  initial?: { eventCode: string; watching: Watching };
  /** The workspace's default event, chosen to start with (saved only on Start). */
  suggestedEvent?: string | null;
  /** The account's FTC team, whose events are listed after today's. */
  myTeam?: number | null;
  onStart: (eventCode: string, watching: Watching) => void;
  onCancel?: () => void;
}

export function SessionSetup({ season, initial, suggestedEvent, myTeam, onStart, onCancel }: SessionSetupProps) {
  const today = localToday();
  const startCode = (initial?.eventCode || suggestedEvent || "").trim().toUpperCase();
  const [code, setCode] = useState(startCode);
  // The event last tapped, kept so it stays on screen after the search that found it is cleared.
  const [picked, setPicked] = useState<EventListItem | null>(null);
  // A suggestion that arrives after the first render (the workspace's default loads) is chosen too, until the scout picks.
  useEffect(() => { if (!picked) setCode(startCode); }, [startCode]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the suggestion changes
  const [list, setList] = useState<{ events: EventListItem[]; teamCodes: Set<string> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [shown, setShown] = useState(PAGE);
  // The picker reopened over a chosen event ("Change"); with no event chosen it is always open.
  const [changing, setChanging] = useState(false);
  // Bumped on a pick (move the scout on to the next step) and on Change (put them in the search box).
  const [moved, setMoved] = useState(0);
  const [opened, setOpened] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const w = initial?.watching ?? DEFAULT_WATCHING;
  const [kind, setKind] = useState<Watching["kind"]>(w.kind);
  const [slot, setSlot] = useState<SlotId>(w.kind === "slot" ? w.slot : "red1");
  const [side, setSide] = useState<AllianceSide>(w.kind === "alliance" ? w.side : w.kind === "slot" ? sideOf(w.slot) : "red");
  // Like the event: a starting choice that arrives late (an assignment loads) is applied until the scout picks one.
  const watchTouched = useRef(false);
  const wKey = JSON.stringify(w);
  useEffect(() => {
    if (watchTouched.current) return;
    setKind(w.kind);
    if (w.kind === "slot") { setSlot(w.slot); setSide(sideOf(w.slot)); } else if (w.kind === "alliance") setSide(w.side);
  }, [wKey]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the starting choice changes

  const [text, setText] = useState("");
  const [hits, setHits] = useState<{ q: string; events: EventListItem[] } | null>(null);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const subLabel = useId(), helpKey = useId(), hintId = useId();

  // Upcoming events, the team's events and the starting event (both may be past the upcoming page), together.
  useEffect(() => {
    let live = true;
    setFailed(false);
    const byCode = (c: string) => apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, q: c, all: 1, limit: 20 })}`)
      .then((r) => r.events.find((e) => e.code === c) ?? null, () => null);
    (async () => {
      const [upcoming, profile] = await Promise.all([
        apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, from: today, all: 1, limit: UPCOMING })}`),
        myTeam ? apiFetch<TeamProfile>(`/api/teams/${myTeam}${qs({ season })}`).catch(() => null) : null,
      ]);
      const teamCodes = new Set((profile?.events ?? []).filter((e) => e.season === season && (e.end ?? e.start ?? today) >= today).map((e) => e.code));
      const have = new Set(upcoming.events.map((e) => e.code));
      const missing = [...new Set([...teamCodes, ...(startCode ? [startCode] : [])])].filter((c) => !have.has(c));
      const extra = (await Promise.all(missing.map(byCode))).filter((e): e is EventListItem => !!e);
      if (live) setList({ events: [...upcoming.events, ...extra], teamCodes });
    })().catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [season, myTeam, startCode, today, retry]);

  useEffect(() => {
    const q = text.trim();
    setHits(null); setSearchFailed(null);
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, q, all: 1, limit: SEARCH_CAP })}`)
        .then((r) => { if (live) setHits({ q, events: rankEvents(r.events, q).slice(0, PAGE) }); }, () => { if (live) setSearchFailed(q); });
    }, EVENT_SEARCH_DEBOUNCE);
    return () => { live = false; clearTimeout(t); };
  }, [text, season, searchRetry]);

  // After a pick the list folds away under the scout's finger: bring the folded row (and the step under it) into
  // view, gliding unless they asked for reduced motion, and put focus on the row so a keyboard isn't left on nothing.
  useEffect(() => {
    const row = rowRef.current;
    if (!moved || !row) return;
    row.focus({ preventScroll: true });
    if (typeof row.getBoundingClientRect !== "function" || typeof window === "undefined") return;
    const r = row.getBoundingClientRect();
    // Already sitting in the top part of the screen: leave the page where it is.
    if (r.top >= 0 && r.top < window.innerHeight * 0.35) return;
    scrollToElement(row, smoothBehavior());
  }, [moved]);
  useEffect(() => { if (opened) searchRef.current?.focus(); }, [opened]);

  const rows = useMemo(() => (list ? orderEvents(list.events, today, list.teamCodes) : []), [list, today]);
  const known = useMemo(() => new Map([...(list?.events ?? []), ...(hits?.events ?? [])].map((e) => [e.code, e])), [list, hits]);
  const chosen = code ? known.get(code) ?? (picked?.code === code ? picked : null) : null;

  const searching = text.trim().length >= 2;
  const results = hits && hits.q === text.trim() ? hits.events : null;
  // The chosen event stays on screen: first in the list when it isn't one of the rows shown (an event already over).
  const visible: EventRow[] = searching
    ? (results ?? []).map((e) => ({ event: e, today: isOnToday(e, today), mine: !!list?.teamCodes.has(e.code) }))
    : rows.slice(0, shown);
  if (!searching && chosen && !visible.some((r) => r.event.code === code)) {
    visible.unshift({ event: chosen, today: isOnToday(chosen, today), mine: !!list?.teamCodes.has(code) });
  }
  const watching: Watching = kind === "slot" ? { kind, slot } : kind === "alliance" ? { kind, side } : { kind: "all" };
  const subChoices = kind === "slot"
    ? SLOTS.map((s) => ({ value: s, label: slotLabel(s), side: sideOf(s) }))
    : (["red", "blue"] as const).map((s) => ({ value: s, label: s === "red" ? "Red" : "Blue", side: s }));

  const pickerOpen = !code || changing;
  const choose = (e: EventListItem) => { setCode(e.code); setPicked(e); setChanging(false); setText(""); setMoved((n) => n + 1); };
  const keep = () => { setChanging(false); setText(""); setMoved((n) => n + 1); };

  return (
    <div>
      {pickerOpen ? (
        <Section title="Where are you scouting?" description="Search, or pick one of the events below."
          action={code ? <Button variant="outline" size="sm" className="max-sm:h-10" onClick={keep}>Keep {code}</Button> : undefined}>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input ref={searchRef} type="search" aria-label="Search events" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Search events: name, city or code" autoComplete="off" className="h-11 pl-9 pr-11" />
            {text && <Button variant="ghost" size="icon" onClick={() => setText("")} aria-label="Clear search" className="absolute right-0.5 top-1/2 -translate-y-1/2"><X /></Button>}
          </div>
          <p role="status" className="sr-only">{searching && results ? (results.length ? `${results.length} ${results.length === 1 ? "event" : "events"} found` : "No events found") : ""}</p>
          {!searching && failed && (
            <EmptyState icon={AlertTriangle} title="Couldn’t load events" description="Check your connection, or search for the event above."
              action={<Button variant="secondary" onClick={() => setRetry((n) => n + 1)}><RefreshCw /> Try again</Button>} />
          )}
          {!searching && !list && !failed && <div role="status" aria-label="Loading events" className="grid gap-2">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-16 rounded-xl" />)}</div>}
          {!searching && list && !rows.length && !chosen && <EmptyState icon={CalendarDays} title={`No ${season} events coming up`} description="Search for the event you’re at." />}
          {searching && searchFailed === text.trim() && (
            <EmptyState icon={AlertTriangle} title="Couldn’t search events" action={<Button variant="secondary" onClick={() => setSearchRetry((n) => n + 1)}><RefreshCw /> Try again</Button>} />
          )}
          {searching && results && !results.length && <EmptyState icon={SearchX} title={`No ${season} event matches “${text.trim()}”`} />}

          {visible.length > 0 && (
            <ToggleGroup type="single" variant="cards" role="radiogroup" aria-label="Where are you scouting?" value={code}
              // Tapping the event already chosen gives "": that is a pick of it too.
              onValueChange={(v) => { const row = visible.find((r) => r.event.code === (v || code)); if (row) choose(row.event); }}
              className="grid grid-cols-1 gap-2 overflow-visible">
              {visible.map(({ event: e, today: onToday, mine }) => (
                <ToggleGroupItem key={e.code} value={e.code} className="w-full bg-card px-4 py-3">
                  <span className="flex w-full items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-foreground">{e.name}</span>
                    {onToday ? <Badge variant="success">Today</Badge> : <span className="shrink-0 font-mono text-xs">{e.code}</span>}
                  </span>
                  <span className="w-full whitespace-normal text-xs">
                    {[onToday ? e.code : null, dateRange(e.start, e.end), place(e.city, e.state) || null, mine ? "your team is here" : null,
                      e.matchesTotal > 0 ? `${e.matchesTotal} ${e.matchesTotal === 1 ? "match" : "matches"} scheduled` : "schedule not out yet"]
                      .filter(Boolean).join(" · ")}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          {!searching && rows.length > shown && (
            <div className="mt-3 flex justify-center"><Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>Show more events</Button></div>
          )}
        </Section>
      ) : (
        // The pick, folded to one row: what to watch and Start come straight under it.
        <div ref={rowRef} tabIndex={-1} role="group" aria-label={`Scouting at ${chosen?.name ?? code}`}
          className="mb-6 flex scroll-mt-[calc(var(--header-h)+0.75rem)] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-sm:mb-5 max-sm:px-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"><MapPin className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Scouting at</p>
            <p className="truncate font-semibold text-foreground">{chosen?.name ?? code}</p>
            {chosen && <p className="truncate text-xs text-muted-foreground">{[chosen.code, dateRange(chosen.start, chosen.end), place(chosen.city, chosen.state) || null].filter(Boolean).join(" · ")}</p>}
          </div>
          <Button variant="outline" size="sm" className="shrink-0 max-sm:h-10" aria-label="Change event"
            onClick={() => { setChanging(true); setOpened((n) => n + 1); }}>Change</Button>
        </div>
      )}

      <Section title="What are you watching?">
        <ToggleGroup type="single" variant="cards" role="radiogroup" aria-label="What are you watching?" value={kind}
          onValueChange={(v) => { if (v) { watchTouched.current = true; setKind(v as Watching["kind"]); } }} className="grid grid-cols-1 gap-2 overflow-visible">
          {WATCH_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.kind} value={o.kind} aria-describedby={`${helpKey}-${o.kind}`} className="w-full bg-card px-4 py-3">
              <span className="font-semibold text-foreground">{o.title}</span>
              <span id={`${helpKey}-${o.kind}`} className="whitespace-normal text-xs">{o.help}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {kind !== "all" && (
          <div className="mt-3 grid gap-1.5">
            <p id={subLabel} className="text-sm font-medium">{kind === "slot" ? "Which team" : "Which alliance"}</p>
            <ToggleGroup type="single" role="radiogroup" aria-labelledby={subLabel} value={kind === "slot" ? slot : side}
              onValueChange={(v) => {
                if (!v) return;
                watchTouched.current = true;
                if (kind === "slot") { setSlot(v as SlotId); setSide(sideOf(v as SlotId)); } else setSide(v as AllianceSide);
              }} className="flex w-full">
              {subChoices.map((c) => (
                <ToggleGroupItem key={c.value} value={c.value} className="flex-1 max-sm:min-h-11">
                  <span aria-hidden className={cn("size-2 rounded-full", c.side === "red" ? "bg-red-alliance" : "bg-blue-alliance")} />{c.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
      </Section>

      {/* The main action. With an event chosen it is pinned to the bottom (above the phone's tab bar, as Save is on
          the match screen), so it is on screen however far the scout has scrolled. */}
      <div data-sticky-actions={code ? "" : undefined}
        className={cn("grid gap-2", code && "sticky z-30 -mx-4 border-t border-line bg-secondary px-4 py-2.5 max-md:bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] md:bottom-4 md:mx-0 md:rounded-xl md:border")}>
        <div className="flex gap-2">
          {onCancel && <Button variant="outline" size="lg" className="max-sm:h-12 max-sm:px-4" onClick={onCancel}>Cancel</Button>}
          <Button key={code || "none"} size="lg" disabled={!code} onClick={() => code && onStart(code, watching)} aria-describedby={hintId}
            className={cn("min-w-0 flex-1 max-sm:h-12", code && "h-12 text-base motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-300")}>
            <Play className="size-4 fill-current" aria-hidden />Start scouting{code ? <span className="truncate font-medium opacity-80">· {code}</span> : null}
          </Button>
        </div>
        <p id={hintId} className="truncate text-center text-xs text-muted-foreground">
          {code ? `${watchingLabel(watching)} at ${chosen?.name ?? code}` : "Pick the event you’re at to start."}
        </p>
      </div>
    </div>
  );
}
