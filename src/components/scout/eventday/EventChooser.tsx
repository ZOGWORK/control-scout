// The event picker: what the Scout page is until an event is picked (and again from Change event). It's the
// Events page's list (src/components/EventBrowse.tsx): the events you track, the same filter bar (season, place,
// type, dates, video, text, status) and the same cards by week, but each card has its own Scout button under it,
// apart from the card's link to the event. The button says whether your teams compete there and how far this
// space's scouting has got there (src/shared/scoutProgress.ts), once there's any.
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Users } from "lucide-react";
import { apiFetch, qs, useApi } from "../../../lib/api";
import { dateRange, seasonLabel } from "../../../lib/format";
import type { EventListItem, TeamProfile } from "../../../shared/api";
import { matchesWithEntries, pitProgress } from "../../../shared/scoutProgress";
import { Button } from "../../ui/button";
import { EmptyState } from "../../page";
import { Async, LoadingBlock } from "../../states";
import { CurrentlyTracking } from "../../CurrentlyTracking";
import { EventFilterBar, EventWeeks, type TileAction } from "../../EventBrowse";
import { readFilters } from "../../../pages/eventsList";
import { isNoMatchType } from "../../../shared/labels";
import { cn } from "../../cn";

/** Today's date on this device, as event dates are written (YYYY-MM-DD, event-local). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const isOnToday = (e: Pick<EventListItem, "start" | "end">, today: string) => !!e.start && e.start <= today && (e.end ?? e.start) >= today;

/** Your teams' events this season that aren't over yet, by date: the quick picks above the filters. */
export function ourUpcoming(events: readonly EventListItem[], ours: ReadonlyMap<string, number[]>, today: string): EventListItem[] {
  return events
    .filter((e) => ours.has(e.code) && (e.end ?? e.start ?? today) >= today)
    .sort((a, b) => (a.start ?? "9").localeCompare(b.start ?? "9") || a.name.localeCompare(b.name));
}

/** Enough for any season's every event (the list's own default is 2,000). */
const ALL_EVENTS = 3000;

type Entry = Parameters<typeof pitProgress>[0][number];

export interface EventChooserProps {
  season: number;
  /** The current season (the season picker's default; tracked events from other seasons say theirs). */
  currentSeason: number;
  /** Another season picked in the filter bar. */
  onSeason: (season: number) => void;
  /** This space's entries, for each event's progress. */
  entries: readonly Entry[];
  /** Your teams (the account's own and its Control Point teams): the events they're at are marked, and listed first. */
  ourTeams: readonly number[];
  /** The event picked now, or the workspace's suggestion. */
  current?: string | null;
  onPick: (code: string) => void;
  /** Back to the event already picked (absent with none). */
  onCancel?: () => void;
}

export function EventChooser({ season, currentSeason, onSeason, entries, ourTeams, current, onPick, onCancel }: EventChooserProps) {
  const today = localToday();
  const start = (current ?? "").trim().toUpperCase();
  const titleId = useId();
  const teamsKey = [...new Set(ourTeams)].sort((a, b) => a - b).join(",");
  // Every event type, practice days and the like too: a pit can be scouted at any of them. The list shows the
  // Events page's own set (no kickoffs, workshops, practice days…) until the Event type filter picks one of those,
  // so the two count the same events.
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, all: 1, limit: ALL_EVENTS })}`);

  // The filters live here, not in the URL: Scout's own query string is the entry list's.
  const [f, setF] = useState<Record<string, string>>({});
  const set = useCallback((patch: Record<string, string | null>) => setF((x) => {
    const n = { ...x };
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "" || v === "all") delete n[k]; else n[k] = v; }
    return n;
  }), []);
  const { region, type, status, from, to, video } = readFilters((k) => f[k] ?? null);
  const [q, setQ] = useState("");
  const listQ = useDeferredValue(q);
  const clear = useCallback(() => { setF({}); setQ(""); }, []);
  const active = !!(region || type !== "all" || status !== "all" || from || to || q || video !== "all");

  // Where your teams compete this season, from their profiles.
  const [ours, setOurs] = useState<Map<string, number[]>>(new Map());
  useEffect(() => {
    const teams = teamsKey ? teamsKey.split(",").map(Number) : [];
    let live = true;
    Promise.all(teams.map((t) => apiFetch<TeamProfile>(`/api/teams/${t}${qs({ season })}`).catch(() => null))).then((profiles) => {
      const m = new Map<string, number[]>();
      profiles.forEach((p, i) => { for (const e of p?.events ?? []) if (e.season === season) m.set(e.code, [...(m.get(e.code) ?? []), teams[i]]); });
      if (live) setOurs(m);
    });
    return () => { live = false; };
  }, [season, teamsKey]);

  // The entries by event, sorted once: each card counts only its own event's, not the whole list.
  const byEvent = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const x of entries) {
      const k = (x.eventCode ?? "").trim().toUpperCase();
      if (!k) continue;
      const list = m.get(k);
      if (list) list.push(x); else m.set(k, [x]);
    }
    return m;
  }, [entries]);

  const tileAction = useCallback<TileAction>((e) => {
    const picked = e.code === start;
    const mine = ours.get(e.code) ?? [];
    const mineEntries = byEvent.get(e.code.toUpperCase()) ?? [];
    const pit = pitProgress(mineEntries, e.code, e.teams ?? 0);
    const matches = matchesWithEntries(mineEntries, e.code, e.matchesTotal ?? 0);
    const count = (p: { done: number; total: number }) => (p.total > 0 ? `${p.done} / ${p.total}` : `${p.done}`);
    const strong = picked || mine.length > 0 || e.status === "live" || isOnToday(e, today);
    return {
      ring: picked,
      node: (
        <div className="grid gap-2">
          {mine.length > 0 && <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Users className="size-3.5 shrink-0 text-accent-text" aria-hidden />Your team{mine.length > 1 ? "s" : ""} {mine.join(", ")} {mine.length > 1 ? "are" : "is"} competing
          </p>}
          {(pit.done > 0 || matches.done > 0) && <p className="text-xs text-muted-foreground">
            Scouted: <span className="tabular-nums text-foreground">{count(pit)}</span> pits · <span className="tabular-nums text-foreground">{count(matches)}</span> matches
          </p>}
          <Button size="sm" variant={strong ? "default" : "outline"} className="w-full max-sm:min-h-11" onClick={() => onPick(e.code)} aria-label={`Scout ${e.name}`}>
            {picked ? "Keep scouting this event" : "Scout this event"} <ArrowRight />
          </Button>
        </div>
      ),
    };
  }, [start, ours, byEvent, today, onPick]);

  const allEvents = state.data?.events;
  const events = useMemo(() => (allEvents && !isNoMatchType(type) ? allEvents.filter((e) => !isNoMatchType(e.type)) : allEvents), [allEvents, type]);
  const mineSoon = useMemo(() => ourUpcoming(allEvents ?? [], ours, today), [allEvents, ours, today]);

  return (
    <section aria-labelledby={titleId}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">Which event are you scouting?</h2>
          <p className="text-sm text-muted-foreground">Pick it once. Scout stays on it until you change it. Tap a card to open the event, or Scout to start.</p>
        </div>
        {onCancel && <Button variant="outline" onClick={onCancel} className="max-sm:h-11">Back to {start || "the event"}</Button>}
      </div>
      {/* Your teams' events, one tap from scouting them. */}
      {mineSoon.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Users className="size-4 text-accent-text" aria-hidden />Your teams are at</p>
          <div className="flex flex-wrap gap-2">
            {mineSoon.slice(0, 6).map((e) => (
              <Button key={e.code} variant="outline" size="sm" onClick={() => onPick(e.code)} aria-label={`Scout ${e.name}`} className={cn("h-auto max-w-full flex-col items-start gap-0 py-1.5 text-left", e.code === start && "border-accent/70")}>
                <span className="max-w-[16rem] truncate">{e.name}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground"><CalendarDays className="size-3" aria-hidden />{dateRange(e.start, e.end)} · {(ours.get(e.code) ?? []).join(", ")}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {/* The events you track: a card picks it here (this season's only, as Scout scouts one season at a time). */}
      <CurrentlyTracking season={season} current={currentSeason} events={allEvents} listSettled={!state.loading} className="mb-6 max-sm:mb-5"
        onPick={(_, code) => onPick(code)} picked={start ? `${season}:${start}` : null} only={(e) => e.season === season} />
      <EventFilterBar season={season} onSeason={onSeason} events={events ?? []} typeEvents={allEvents ?? []} {...{ region, type, status, from, to, q, video, listQ, set, active }} onQ={setQ} onClear={clear} />
      <Async state={state} loading={<LoadingBlock rows={6} label="Loading events" />} empty={(d) => !d.events.length && <EmptyState icon={CalendarDays} title={`No events listed for ${seasonLabel(season)} yet`} />}>
        {() => <EventWeeks events={events ?? []} {...{ region, type, status, from, to, video }} q={listQ} onClear={clear} tileAction={tileAction} />}
      </Async>
    </section>
  );
}
