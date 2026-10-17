// Predict: predictions run on their own, so this page starts from what people
// care about — a team or an event. Pick one and its predictions show inline;
// this week's events are listed underneath. The manual what-if lab (any four
// teams, advancement for any team at any event) sits at the bottom.
// Every output carries its confidence tier.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, ArrowRight, BookmarkPlus, CalendarDays, ChevronDown, FlaskConical, Link2, MapPin, Sparkles, Star, Swords, Trophy, Users, WifiOff, X } from "lucide-react";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { noteOfflineAnswer, useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventDetail, EventSummary, EventListItem, MatchExplanationView, MatchView, TeamProfile } from "../shared/api";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Async, ErrorState } from "../components/states";
import { Button } from "../components/ui/button";
import { Badge, Input } from "../components/ui/basic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "../components/ui/sonner";
import { CalibrationLine, ConfidenceBadge, FactorList, MatchList, WinBar } from "../components/predict";
import { TeamInput, lookupTeamName } from "../components/TeamInput";
import { teamsErrors } from "../lib/teamCheck";
import { SeasonToggle } from "../components/SeasonToggle";
import { AdvancementView } from "../components/Advancement";
import { SearchBox } from "../components/search/SearchBox";
import { SEARCH_HINT, usePageSearch } from "../components/layout/Search";
import { cn } from "../components/cn";
import { dateRange, num, oddsPct, place, seasonLabel } from "../lib/format";
import { copyLink } from "../lib/clipboard";
import { ShareMatch } from "../components/ShareMatch";

type LabMode = "match" | "advancement";
const ADVANCING = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ?for=team:4215 or ?for=event:2026:USNJQ1 — what's picked. The lab keeps its own params (mode, red, blue, code, team). */
type Pick = { kind: "team"; team: number } | { kind: "event"; season: number; code: string } | null;
function parsePick(v: string | null): Pick {
  const [k, a, b] = (v ?? "").split(":");
  if (k === "team" && /^\d+$/.test(a ?? "")) return { kind: "team", team: Number(a) };
  if (k === "event" && /^\d{4}$/.test(a ?? "") && b) return { kind: "event", season: Number(a), code: b };
  return null;
}

export default function PredictPage() {
  useTitle("Predict");
  const [sp, setSp] = useSearchParams();
  const pick = parsePick(sp.get("for"));
  // ?view=lab|events picks the view; without it, a lab link (mode, red/blue, code) opens the Lab.
  // Each view keeps its own params (for= vs the lab's), so switching back and forth loses neither.
  const view = viewOf(sp);
  // Picking a team or event shows its predictions in the Events view (the lab's matchup stays for later).
  const setPick = (v: string | null) => setSp((x) => { x.set("view", "events"); if (v) x.set("for", v); else x.delete("for"); return x; });
  const setView = (v: "events" | "lab") => setSp((x) => { x.set("view", v); if (v === "lab" && !labLink(x)) x.set("mode", "match"); return x; });
  return (
    <div className="space-y-10">
      <div>
        <PageHeader title="Predict" description={<>Every scheduled match gets win odds and predicted scores automatically, and every advancing event gets advancement odds. Pick a team or an event to see them. Each number carries its confidence, and the <Link to="/methodology#accuracy" className="underline">track record</Link> shows how often they've been right.</>} />
        <Picker onPick={setPick} />
        <PredictSwitch value={view} onChange={setView} />
      </div>
      <div role="tabpanel" id={`predict-panel-${view}`} aria-labelledby={`predict-tab-${view}`} className="space-y-10">
        {view === "lab" ? <Lab /> : (
          <>
            {pick?.kind === "team" && <TeamPredictions team={pick.team} onClear={() => setPick(null)} />}
            {pick?.kind === "event" && <EventPredictions season={pick.season} code={pick.code} onClear={() => setPick(null)} />}
            <ThisWeek onPick={setPick} picked={pick?.kind === "event" ? pick.code : null} />
          </>
        )}
      </div>
    </div>
  );
}

/** Which view: ?view= if set, else the Lab for a lab link, else Events. */
export function viewOf(sp: URLSearchParams): "events" | "lab" {
  const v = sp.get("view");
  return v === "lab" || v === "events" ? v : labLink(sp) ? "lab" : "events";
}
/** A lab link: an explicit mode, or (older links) a matchup or an event without one. */
function labLink(sp: URLSearchParams): "match" | "advancement" | null {
  const m = sp.get("mode") ?? (sp.get("red") || sp.get("blue") ? "match" : sp.get("code") ? "advancement" : null);
  return m === "advancement" ? "advancement" : m === "match" ? "match" : null;
}

/** Predict (scheduled matches and events) or Predict Lab (what-ifs): one switch, right under the search. */
function PredictSwitch({ value, onChange }: { value: "events" | "lab"; onChange: (v: "events" | "lab") => void }) {
  const views = [
    { v: "events" as const, label: "Events", icon: CalendarDays, hint: "Predictions for scheduled matches and events" },
    { v: "lab" as const, label: "Lab", icon: FlaskConical, hint: "What-ifs: any four teams, or advancement odds for any team at any event" },
  ];
  // Tabs keyboard pattern: the selected tab is the one Tab reaches; arrows (and Home/End) move and select.
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = views.findIndex((x) => x.v === value);
    const next = e.key === "ArrowRight" ? (i + 1) % views.length : e.key === "ArrowLeft" ? (i + views.length - 1) % views.length : e.key === "Home" ? 0 : e.key === "End" ? views.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(views[next].v);
    document.getElementById(`predict-tab-${views[next].v}`)?.focus();
  };
  return (
    <div className="mt-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1" role="tablist" aria-label="Predict">
      {views.map(({ v, label, icon: Icon, hint }) => (
        <button key={v} id={`predict-tab-${v}`} type="button" role="tab" aria-selected={value === v} aria-controls={`predict-panel-${v}`} tabIndex={value === v ? 0 : -1}
          title={hint} onKeyDown={onKey} onClick={() => value !== v && onChange(v)}
          className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors max-sm:h-11",
            value === v ? "bg-accent text-accent-ink shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]" : "text-text-muted hover:bg-text-base/[0.06] hover:text-text-base")}>
          <Icon className="size-4" />{label}
        </button>
      ))}
    </div>
  );
}

function Picker({ onPick }: { onPick: (v: string) => void }) {
  const { state } = usePersonal();
  // This picker is the page's search box: the top-bar field steps aside, and ⌘K focuses this.
  const searchRef = usePageSearch();
  const quick = [...new Set([...(state.myTeam ? [state.myTeam] : []), ...state.tracked.teams, ...state.bookmarks])].slice(0, 6);
  const chip = (t: number, small?: boolean) => (
    <button key={t} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => onPick(`team:${t}`)}
      className={cn("inline-flex items-center gap-1 rounded-full border border-border font-mono text-foreground hover:border-accent/60 hover:text-accent", small ? "px-2.5 py-0.5 text-xs max-sm:min-h-8" : "px-3 py-1 text-sm max-sm:min-h-9")}>
      {t === state.myTeam && <Star className={cn("fill-accent text-accent", small ? "size-3" : "size-3.5")} />}{t}
    </button>
  );
  return (
    <div className="max-w-2xl space-y-3">
      <SearchBox
        size="lg" kinds={["team", "event"]} label="Pick a team or event" inputRef={searchRef} hint={SEARCH_HINT}
        placeholder="Pick a team or an event: number, name, or a rough guess"
        onPick={(h) => onPick(h.kind === "team" ? `team:${h.ref}` : `event:${h.ref}`)}
        emptyHint={quick.length ? (
          <div className="p-2">
            <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your teams</p>
            <div className="flex flex-wrap gap-1.5">{quick.map((t) => chip(t))}</div>
          </div>
        ) : undefined}
      />
      {quick.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"><span>Quick:</span>{quick.map((t) => chip(t, true))}</div>}
    </div>
  );
}

function PickedHeader({ icon: Icon, title, sub, to, onClear }: { icon: typeof Users; title: string; sub?: string; to: string; onClear: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/[0.12] text-accent"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-xl font-semibold text-foreground">{title}</h2>
        {sub && <p className="truncate text-sm text-muted-foreground">{sub}</p>}
      </div>
      <Button variant="secondary" size="sm" asChild><Link to={to}>Open page <ArrowRight /></Link></Button>
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear selection"><X /></Button>
    </div>
  );
}

function TeamPredictions({ team, onClear }: { team: number; onClear: () => void }) {
  const season = useCurrentSeason();
  const profile = useApi<TeamProfile>(`/api/teams/${team}${qs({ season })}`);
  const matches = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  // Unplayed and not long past: matches from ended events that never got a result aren't "next".
  const stale = Date.now() - 12 * 3600_000;
  const upcoming = (matches.data?.matches ?? []).filter((m) => !m.played && (!m.startsAt || Date.parse(m.startsAt) > stale));
  const t = profile.data?.team;
  const now = iso(new Date());
  const next = (profile.data?.events ?? []).find((e) => (e.end ?? e.start ?? "") >= now);
  return (
    <section aria-label={`Predictions for team ${team}`} className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
      <PickedHeader icon={Users} title={t ? `${t.number} ${t.name ?? ""}`.trim() : `Team ${team}`} sub={t ? place(t.city, t.state, t.country) : undefined} to={`/teams/${team}`} onClear={onClear} />
      {profile.error?.status === 404 ? <EmptyState icon={Users} title={`No team ${team}`} description="No FTC team with that number in the seasons we hold." /> : (
        <div className="space-y-8">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Next matches</h3>
            <Async state={matches}>{() => (
              <MatchList matches={upcoming.slice(0, 12)} highlight={team} empty={next ? `No schedule yet for ${next.name}. Win odds appear as soon as the event publishes its matches (usually that morning).` : `No scheduled matches for ${team} in ${seasonLabel(season)} yet.`} />
            )}</Async>
            {upcoming.length > 12 && <p className="mt-2 text-xs text-muted-foreground">Showing 12 of {upcoming.length}. All of them are on the <Link to={`/teams/${team}`} className="underline">team page</Link>.</p>}
          </div>
          {next && (
            <div>
              <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-foreground">
                <span>Next event: <Link to={`/events/${next.season}/${next.code}`} className="hover:underline">{next.name}</Link></span>
                <span className="text-xs font-normal text-muted-foreground">{dateRange(next.start, next.end)}</span>
              </h3>
              {ADVANCING.has(next.type ?? "")
                ? <AdvancementView season={next.season} code={next.code} team={team} nameOf={() => ""} />
                : <p className="text-sm text-muted-foreground">This event doesn't advance teams, so there are no advancement odds. Its matches get win odds once it publishes a schedule.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EventPredictions({ season, code, onClear }: { season: number; code: string; onClear: () => void }) {
  const state = useApi<EventDetail>(`/api/events/${season}/${code}`);
  const e = state.data?.event;
  // Unplayed matches of an event that has already ended never got results: say so, don't call them upcoming.
  const over = !!e && (e.end ?? e.start ?? "") < iso(new Date());
  const unplayed = (state.data?.matches ?? []).filter((m) => !m.played);
  const upcoming = over ? [] : unplayed;
  const played = (state.data?.matches ?? []).filter((m) => m.played);
  return (
    <section aria-label={`Predictions for ${e?.name ?? code}`} className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6">
      <PickedHeader icon={CalendarDays} title={e?.name ?? code} sub={e ? `${dateRange(e.start, e.end)} · ${place(e.city, e.state, e.country)}` : undefined} to={`/events/${season}/${code}`} onClear={onClear} />
      <Async state={state}>{(d) => (
        <div className="space-y-8">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">{upcoming.length ? `Upcoming matches (${upcoming.length})` : over ? "This event is over" : played.length ? "All matches have been played" : "Matches"}</h3>
            {over && unplayed.length > 0 && <p className="mb-3 text-sm text-muted-foreground">{unplayed.length} scheduled {unplayed.length === 1 ? "match has" : "matches have"} no result from FIRST, so {unplayed.length === 1 ? "it isn't" : "they aren't"} shown as upcoming.</p>}
            {upcoming.length ? <MatchList matches={upcoming.slice(0, 16)} />
              : played.length ? <p className="text-sm text-muted-foreground">See how the predictions did on the <Link to={`/events/${season}/${code}`} className="underline">event page</Link>.</p>
                : <MatchList matches={[]} empty="No schedule published yet. Win odds for every match appear as soon as it is (usually the morning of the event)." />}
            {upcoming.length > 16 && <p className="mt-2 text-xs text-muted-foreground">Showing 16 of {upcoming.length}. The rest are on the <Link to={`/events/${season}/${code}?tab=matches`} className="underline">event page</Link>.</p>}
          </div>
          {!d.forecastUnsupported && d.event.status !== "finished" && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Advancement odds</h3>
              <AdvancementView season={season} code={code} team={null} nameOf={() => ""} />
            </div>
          )}
        </div>
      )}</Async>
    </section>
  );
}

function ThisWeek({ onPick, picked }: { onPick: (v: string) => void; picked: string | null }) {
  const [all, setAll] = useState(false);
  const season = useCurrentSeason();
  const now = new Date();
  const from = iso(new Date(now.getTime() - 2 * 864e5)), to = iso(new Date(now.getTime() + 7 * 864e5));
  const events = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, from, to })}`);
  // Per-event counts from the event list itself (complete, unlike a capped match feed).
  const toPlay = (e: EventListItem) => (e.status === "finished" ? 0 : Math.max(0, e.matchesTotal - e.matchesPlayed));
  return (
    <Section title="This week" description="Events from two days ago to a week out. Pick one to see its predictions.">
      <Async state={events} empty={(d) => !d.events.length && <EmptyState icon={CalendarDays} title="No events this week" description="Nothing is scheduled in the next seven days. Pick any team or event above to see its predictions." />}>
        {(d) => (
          <div className="grid gap-2 sm:grid-cols-2">
            {[...d.events].sort((a, b) => toPlay(b) - toPlay(a) || (a.start ?? "").localeCompare(b.start ?? "")).slice(0, all ? undefined : 12).map((e) => {
              const n = toPlay(e);
              return (
                <button key={e.code} type="button" onClick={() => onPick(`event:${e.season}:${e.code}`)} aria-pressed={picked === e.code}
                  className={cn("lift flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left", picked === e.code ? "border-accent/60" : "border-border")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{e.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" />{dateRange(e.start, e.end)} · {place(e.city, e.state)}</span>
                  </span>
                  <span className="shrink-0">{n > 0 ? <Badge variant="success">{n} scheduled</Badge> : <Badge variant="secondary">{e.type ?? "Event"}</Badge>}</span>
                </button>
              );
            })}
            {d.events.length > 12 && <Button variant="ghost" size="sm" className="sm:col-span-2 justify-self-start" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${d.events.length} events`}</Button>}
          </div>
        )}
      </Async>
    </Section>
  );
}

/** Predict Lab: what-if alliances and advancement for any team at any event (the switcher's Lab view). */
function Lab() {
  const [sp, setSp] = useSearchParams();
  const mode: LabMode = labLink(sp) === "advancement" ? "advancement" : "match";
  const setMode = (m: string) => setSp((x) => { x.set("mode", m); return x; }, { replace: true });
  return (
    <section aria-label="Predict Lab" className="rounded-2xl border border-border px-4 pb-6 pt-5 sm:px-6">
      <div className="mb-4 flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-accent" />
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Predict Lab</h2>
          <p className="text-sm text-muted-foreground">Any four teams against each other, or advancement odds for any team at any event.</p>
        </div>
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList>
          <TabsTrigger value="match"><Swords className="size-4" /> Match</TabsTrigger>
          <TabsTrigger value="advancement"><Trophy className="size-4" /> Advancement</TabsTrigger>
        </TabsList>
        <TabsContent value="match" className="mt-6"><MatchLab /></TabsContent>
        <TabsContent value="advancement" className="mt-6"><AdvancementLab /></TabsContent>
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Match: what-if alliances
// ---------------------------------------------------------------------------

function MatchLab() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const init = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const [red, setRed] = useState<string[]>(() => { const x = init("red"); return [x[0] ?? "", x[1] ?? ""]; });
  const [blue, setBlue] = useState<string[]>(() => { const x = init("blue"); return [x[0] ?? "", x[1] ?? ""]; });
  const ready = red.every((x) => x) && blue.every((x) => x);
  const query = ready ? `/api/predict/match${qs({ season, red: red.join(","), blue: blue.join(",") })}` : null;
  // The matchup last asked for (from the URL or the Predict button). Typing in
  // the inputs edits a draft; the season switch never touches the draft.
  type Matchup = { red: number[]; blue: number[] };
  const parse = (r: string, b: string): Matchup | null => {
    const red = r.split(",").filter(Boolean).map(Number), blue = b.split(",").filter(Boolean).map(Number);
    const all = [...red, ...blue];
    return red.length === 2 && blue.length === 2 && all.every((t) => Number.isInteger(t) && t > 0) && new Set(all).size === 4 ? { red, blue } : null;
  };
  const urlRed = sp.get("red") ?? "", urlBlue = sp.get("blue") ?? "";
  const [submittedTeams, setSubmittedTeams] = useState<Matchup | null>(() => parse(urlRed, urlBlue));
  // Saved links and back/forward change the URL on this same page: follow it.
  useEffect(() => {
    const r = urlRed.split(",").filter(Boolean), b = urlBlue.split(",").filter(Boolean);
    setRed([r[0] ?? "", r[1] ?? ""]);
    setBlue([b[0] ?? "", b[1] ?? ""]);
    setSubmittedTeams(parse(urlRed, urlBlue));
    setErrors([null, null, null, null]);
    edits.current++;
  }, [urlRed, urlBlue]);
  const submitted = submittedTeams ? `/api/predict/match${qs({ season, red: submittedTeams.red.join(","), blue: submittedTeams.blue.join(",") })}` : null;
  const state = useApi<MatchExplanationView>(submitted);
  // Offline: the submitted (validated) matchup — never the half-typed draft.
  const offline = useOfflineFallback(state.error?.offline && submittedTeams ? { season, ...submittedTeams } : null);
  // One error per field (red 1, red 2, blue 1, blue 2), set on submit and cleared as that field is edited.
  const [errors, setErrors] = useState<(string | null)[]>([null, null, null, null]);
  const [checking, setChecking] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // Bumped by every edit, swap or URL change: a check that finishes after one is stale and dropped.
  const edits = useRef(0);
  const clearError = (i: number) => { edits.current++; setErrors((e) => (e[i] ? e.map((x, j) => (j === i ? null : x)) : e)); };
  const run = async () => {
    if (!ready) return;
    const at = edits.current;
    setChecking(true);
    const errs = await teamsErrors([...red, ...blue], ["red team 1", "red team 2", "blue team 1", "blue team 2"], lookupTeamName);
    setChecking(false);
    if (edits.current !== at) return;
    setErrors(errs);
    const bad = errs.findIndex(Boolean);
    if (bad >= 0) { inputs.current[bad]?.focus(); return; }
    const m = parse(red.join(","), blue.join(","));
    if (!m) return;
    setSubmittedTeams(m);
    setSp((x) => { x.set("mode", "match"); x.set("season", String(season)); x.set("red", red.join(",")); x.set("blue", blue.join(",")); return x; }, { replace: true });
  };
  const swap = () => { edits.current++; setRed(blue); setBlue(red); setErrors((e) => [e[2], e[3], e[0], e[1]]); };
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SeasonToggle predictOnly value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />
          <span className="text-xs text-muted-foreground">Ratings as of now for {seasonLabel(season)}</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} noValidate className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
          <fieldset className="rounded-xl border border-red-alliance/30 bg-red-alliance/[0.04] p-4">
            <legend className="px-1 text-sm font-semibold text-red-alliance">Red alliance</legend>
            <div className="grid grid-cols-2 gap-3">{red.map((v, i) => <TeamInput key={i} label={`Red team ${i + 1}`} tone="red" value={v} onChange={(x) => { setRed((r) => r.map((y, j) => (j === i ? x : y))); clearError(i); }} autoFocus={i === 0 && !v} error={errors[i]} inputRef={(el) => { inputs.current[i] = el; }} />)}</div>
          </fieldset>
          <div className="flex justify-center md:pt-8"><Button type="button" variant="ghost" size="icon" onClick={swap} aria-label="Swap alliances"><ArrowLeftRight /></Button></div>
          <fieldset className="rounded-xl border border-blue-alliance/30 bg-blue-alliance/[0.04] p-4">
            <legend className="px-1 text-sm font-semibold text-blue-alliance">Blue alliance</legend>
            <div className="grid grid-cols-2 gap-3">{blue.map((v, i) => <TeamInput key={i} label={`Blue team ${i + 1}`} tone="blue" value={v} onChange={(x) => { setBlue((r) => r.map((y, j) => (j === i ? x : y))); clearError(2 + i); }} error={errors[2 + i]} inputRef={(el) => { inputs.current[2 + i] = el; }} />)}</div>
          </fieldset>
          <div className="md:col-span-3"><Button type="submit" size="lg" disabled={!ready || checking} className="w-full sm:w-auto"><Sparkles /> Predict this match</Button></div>
        </form>
      </div>
      {submitted && (state.error
        ? (offline.data ? <MatchResult x={offline.data} offlineAsOf={offline.asOf} /> : offline.loading ? <div className="skeleton h-72 rounded-2xl" /> : <ErrorState error={state.error} onRetry={state.reload} />)
        : !state.data ? <div className="skeleton h-72 rounded-2xl" /> : <MatchResult x={state.data} />)}
      {!submitted && <EmptyState icon={Swords} title="Pick four teams" description="Any teams, any season — a real matchup or a what-if. You'll get win odds, predicted scores with ranges, the three biggest reasons, and how confident the call is." />}
      <SavedPredictions />
    </div>
  );
}

/** No connection: predict from the lite pack saved on this device (same engine). Only ever runs once the
 *  server couldn't be reached (an offline error): the pack code loads lazily then, never on an online visit. */
function useOfflineFallback(q: { season: number; red: number[]; blue: number[] } | null) {
  const [out, setOut] = useState<{ data: MatchExplanationView | null; asOf: string | null; loading: boolean }>({ data: null, asOf: null, loading: false });
  const key = q ? `${q.season}|${q.red}|${q.blue}` : "";
  useEffect(() => {
    if (!q) { setOut({ data: null, asOf: null, loading: false }); return; }
    let live = true;
    setOut((o) => ({ ...o, loading: true }));
    import("../lib/offline/predict").then((p) => p.offlineExplain(q.season, q.red, q.blue)).then((x) => {
      if (!live) return;
      if (!x) { setOut({ data: null, asOf: null, loading: false }); return; }
      noteOfflineAnswer();
      setOut({
        loading: false, asOf: x.asOf,
        data: {
          season: q.season, red: q.red, blue: q.blue, winProbRed: x.winProbA, winProbBlue: x.winProbB, predictedRed: x.predictedScoreA, predictedBlue: x.predictedScoreB,
          rangeRed: x.scoreRangeA, rangeBlue: x.scoreRangeB, factors: x.factors, confidence: x.confidence,
          teamsRed: x.teamsA.map((t) => ({ ...t, name: null })), teamsBlue: x.teamsB.map((t) => ({ ...t, name: null })), engineVersion: ENGINE_VERSION,
        },
      });
    }, () => live && setOut({ data: null, asOf: null, loading: false }));
    return () => { live = false; };
  }, [key]);
  return out;
}

function MatchResult({ x, offlineAsOf }: { x: MatchExplanationView; offlineAsOf?: string | null }) {
  const { update } = usePersonal();
  const fav = x.winProbRed >= 0.5 ? "Red" : "Blue";
  const save = () => {
    update("predictionHistory", (h) => [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, season: x.season, red: x.red, blue: x.blue, winProbRed: x.winProbRed, predictedRed: x.predictedRed, predictedBlue: x.predictedBlue, tier: x.confidence.tier, savedAt: Date.now() }, ...h].slice(0, 200));
    toast.success("Saved to your predictions");
  };
  const share = () => copyLink();
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
        {offlineAsOf && <p className="mb-3 flex items-center gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs"><WifiOff className="size-3.5 text-info" />Offline — predicted on this device from your lite pack (ratings as of {new Date(offlineAsOf).toLocaleDateString()}).</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ConfidenceBadge tier={x.confidence.tier} reason={x.confidence.reason} />
          <div className="flex gap-2">
            {/* Offline there's no server to draw the card: just the link. */}
            {offlineAsOf ? <Button variant="outline" size="sm" onClick={share}><Link2 /> Share</Button>
              : <ShareMatch query={{ season: x.season, red: x.red, blue: x.blue }} pRed={x.winProbRed} pBlue={x.winProbBlue} />}
            <Button variant="secondary" size="sm" onClick={save}><BookmarkPlus /> Save</Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-4">
          <div><p className="text-sm font-medium text-red-alliance">Red {x.red.join(" + ")}</p><p className="font-display text-5xl font-semibold tabular-nums text-red-alliance sm:text-6xl">{oddsPct(x.winProbRed)}</p></div>
          <p className="pb-3 text-sm text-muted-foreground">to win</p>
          <div className="text-right"><p className="text-sm font-medium text-blue-alliance">Blue {x.blue.join(" + ")}</p><p className="font-display text-5xl font-semibold tabular-nums text-blue-alliance sm:text-6xl">{oddsPct(x.winProbBlue)}</p></div>
        </div>
        <WinBar pRed={x.winProbRed} className="mt-4" />
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Predicted score</p><p className="font-display text-2xl font-semibold tabular-nums">{x.predictedRed}</p><p className="text-xs text-muted-foreground">80% of the time between {x.rangeRed[0]} and {x.rangeRed[1]}</p></div>
          <div className="text-right"><p className="text-muted-foreground">Predicted score</p><p className="font-display text-2xl font-semibold tabular-nums">{x.predictedBlue}</p><p className="text-xs text-muted-foreground">80% of the time between {x.rangeBlue[0]} and {x.rangeBlue[1]}</p></div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{fav} is favoured — not certain. This is a probability from current ratings, including penalties each side tends to give away.</p>
        <CalibrationLine pRed={x.winProbRed} className="mt-2" />
        {/* Made to be screenshotted: the card says where it came from. */}
        <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><img src="/logo.png" alt="" className="size-4" /> FTC Control Scout · prediction lab</span>
          <span>{seasonLabel(x.season)} · engine v{x.engineVersion}</span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 text-base font-semibold">Why — the top 3 factors</h3>
          <FactorList factors={x.factors} />
          <p className="mt-3 text-xs text-muted-foreground">Factors are an exact split of the predicted margin by game phase. <Link to="/methodology#factors" className="underline">More</Link></p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 text-base font-semibold">The robots</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><th className="pb-2">Team</th><th className="pb-2 text-right">Adds</th><th className="pb-2 text-right">Auto</th><th className="pb-2 text-right">Tele</th><th className="pb-2 text-right">End</th><th className="pb-2 text-right">Matches</th></tr></thead>
            <tbody>
              {[...x.teamsRed.map((t) => ({ ...t, side: "red" })), ...x.teamsBlue.map((t) => ({ ...t, side: "blue" }))].map((t) => (
                <tr key={t.team} className="border-t border-border">
                  <td className="py-1.5"><Link to={`/teams/${t.team}?season=${x.season}`} className={cn("font-mono hover:underline", t.side === "red" ? "text-red-alliance" : "text-blue-alliance")}>{t.team}</Link> <span className="text-xs text-muted-foreground">{t.name}</span></td>
                  <td className="text-right tabular-nums">{num(t.np, 0)}<span className="text-xs text-muted-foreground"> ±{num(t.sd, 0)}</span></td>
                  <td className="text-right tabular-nums">{num(t.auto, 0)}</td><td className="text-right tabular-nums">{num(t.teleop, 0)}</td><td className="text-right tabular-nums">{num(t.endgame, 0)}</td>
                  <td className="text-right tabular-nums">{t.matches}{t.matches < 3 && <Badge variant="outline" className="ml-1">few</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SavedPredictions() {
  const { state, update } = usePersonal();
  const h = state.predictionHistory;
  if (!h.length) return null;
  return (
    <Section title="Your saved predictions" description="Saved on this device (and your account, when signed in)." action={<Button variant="ghost" size="sm" onClick={() => update("predictionHistory", () => [])}>Clear</Button>}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {h.slice(0, 12).map((p) => (
          <li key={p.id}>
            <Link to={`/predict?mode=match&season=${p.season}&red=${p.red.join(",")}&blue=${p.blue.join(",")}`} className="lift block rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span><span className="text-red-alliance">{p.red.join("+")}</span> vs <span className="text-blue-alliance">{p.blue.join("+")}</span></span><span className="text-xs text-muted-foreground">{seasonLabel(p.season)}</span></div>
              <WinBar pRed={p.winProbRed} size="sm" className="mt-2" />
              <p className="mt-1 text-xs text-muted-foreground">Red {oddsPct(p.winProbRed)} · {p.predictedRed}–{p.predictedBlue} · {p.tier} · saved {new Date(p.savedAt).toLocaleDateString()}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Advancement: any team, any event
// ---------------------------------------------------------------------------

function AdvancementLab() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const { state: personal } = usePersonal();
  const season = Number(sp.get("season")) || current;
  const code = sp.get("code");
  const team = Number(sp.get("team")) || null;
  const [teamText, setTeamText] = useState(team ? String(team) : personal.myTeam ? String(personal.myTeam) : "");
  useEffect(() => { if (team) setTeamText(String(team)); }, [team]);
  const set = (k: string, v: string | null) => setSp((x) => { x.set("mode", "advancement"); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  const teamEvents = useApi<{ events: { code: string; name: string; start: string | null; type: string | null }[] }>(teamText.length >= 1 ? `/api/teams/${teamText}${qs({ season })}` : null);
  const [q, setQ] = useState("");
  const events = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`);
  const advancing = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);
  const choices = useMemo(() => {
    const all = (events.data?.events ?? []).filter((e) => advancing.has(e.type ?? ""));
    const mine = new Set((teamEvents.data?.events ?? []).map((e) => e.code));
    const needle = q.trim().toLowerCase();
    return all.filter((e) => !needle || `${e.name} ${e.code} ${e.city ?? ""}`.toLowerCase().includes(needle)).sort((a, b) => Number(mine.has(b.code)) - Number(mine.has(a.code)) || (a.start ?? "").localeCompare(b.start ?? ""));
  }, [events.data, teamEvents.data, q]);
  const myCodes = new Set((teamEvents.data?.events ?? []).map((e) => e.code));
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3"><SeasonToggle predictOnly value={season} onChange={(s) => { set("season", String(s)); set("code", null); }} /></div>
        <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="min-w-0">
            <TeamInput label="Team" value={teamText} onChange={(v) => { setTeamText(v); set("team", v || null); }} />
          </div>
          <div className="min-w-0">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an event (the team's events are listed first)" className="h-11" aria-label="Find an event" />
            <div className="custom-scrollbar mt-2 max-h-56 space-y-1 overflow-y-auto">
              {events.error ? <p className="text-sm text-destructive">{events.error.message}</p> : !events.data ? <div className="skeleton h-24 rounded-lg" /> : !choices.length ? <p className="py-4 text-sm text-muted-foreground">No advancing events {q ? "match" : `in ${seasonLabel(season)} yet`}.</p> : choices.slice(0, 60).map((e) => (
                <button key={e.code} onClick={() => set("code", e.code)} className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm", code === e.code ? "border-accent/60 bg-accent/[0.06]" : "border-transparent hover:bg-text-base/[0.04]")}>
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {myCodes.has(e.code) && <Badge variant="soft">{teamText}'s event</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground">{dateRange(e.start, e.end)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {code ? <AdvancementView season={season} code={code} team={team} nameOf={() => ""} onPickTeam={(t) => { setTeamText(String(t)); set("team", String(t)); }} />
        : <EmptyState icon={Trophy} title="Pick an event" description="Any qualifier, league tournament or championship. Add a team to see its chance to advance, captain and pick odds, likely rank, and expected advancement points." />}
    </div>
  );
}
