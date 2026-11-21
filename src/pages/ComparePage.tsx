// Compare up to four teams head to head: OPR by phase, prediction ratings,
// records, event-by-event OPR, and every match where they met or partnered.
//
// The team search sits in one place, first under the title, whether no team or three are chosen, so it
// never moves as teams are added. With none chosen, the page offers the member's own teams (Control
// Point, followed, shortlist, tracked) as one-click picks. With teams chosen, the stats table and both
// charts share the first screen; the brief (closed until asked for), head to head and the workspace's scouting
// (only when there is some) follow.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowUp, GripVertical, Info, Plus, Scale, Sparkles, Trophy, X } from "lucide-react";
import { useApi } from "../lib/api";
import { useCurrentSeason, usePredictable, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { myTeamsOf } from "../lib/myTeams";
import type { CompareTeam, CompareView } from "../shared/api";
import { PageHeader, Section } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { MatchList } from "../components/predict";
import { lookupTeamName, useTeamName } from "../components/TeamInput";
import { TeamPicker } from "../components/TeamPicker";
import { teamError } from "../lib/teamCheck";
import { SeasonToggle } from "../components/SeasonToggle";
import { awardLabel, num, rankPct, seasonLabel } from "../lib/format";
import { compareSeasonNote } from "../lib/compareSeasonNote";
import { CompareConsensus } from "../components/ScoutConsensus";
import { CompareBrief } from "../components/CompareBrief";
import { compareEventNames } from "../lib/compareBrief";
import { cn } from "../components/cn";
import { SWING_LINE, swingText, swingTitle } from "../shared/reliability";
import { useTeamColors } from "../components/TeamColorPicker";
import { Reveal, Stagger, StaggerItem, m } from "../components/motion";
import { predictHref } from "../shared/predictUrl";
import { useIsV8, V8_NUM } from "../lib/v8";
import { V8Title, V8_LABEL } from "../components/myteams/v8";
import { COMPARE_MAX as MAX, compareApiPath, compareSeasonOf, compareTeamsOf, compareTitle } from "../shared/compareUrl";
import { V8_PHASE, type V8Phase } from "../lib/records/describe";

// The team hues (src/index.css --color-team-a…d, Okabe–Ito), as search's compare card has them: never the accent gold.
const COLORS = ["var(--color-team-a)", "var(--color-team-b)", "var(--color-team-c)", "var(--color-team-d)"];

/** Each compared team's colour: the one the scout gave it on the shortlist, else the usual one for its place. */
export function teamPalette(teams: number[], colorOf: (team: number) => { css: string } | null): string[] {
  return teams.map((t, i) => colorOf(t)?.css ?? COLORS[i % COLORS.length]);
}
/** The teams in ?teams= (src/shared/compareUrl.ts: the server reads the address the same way for the first paint). */
export const teamsOf = compareTeamsOf;

/** The head-to-head matches for the baseline (the first team): the ones it played with or against another
 *  compared team, each marked from its side. */
export function baselineMeetings(meetings: CompareView["meetings"], order: number[]): CompareView["meetings"] {
  const [base, ...others] = order;
  if (base == null) return [];
  return meetings.flatMap((m) => {
    const red = m.red.teams.map((t) => t.number), blue = m.blue.teams.map((t) => t.number);
    if (!red.includes(base) && !blue.includes(base)) return [];
    const mine = red.includes(base) ? red : blue, theirs = mine === red ? blue : red;
    const relation = others.some((o) => theirs.includes(o)) ? "opponents" as const : others.some((o) => mine.includes(o)) ? "partners" as const : null;
    return relation ? [{ ...m, relation }] : [];
  });
}

export default function ComparePage() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const asked = compareSeasonOf(sp.get("season"));
  const teams = teamsOf(sp.get("teams"));
  const { colorOf } = useTeamColors();
  const palette = teamPalette(teams.map(Number), colorOf);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The URL as last written: React Router's functional update reads the params of the render that made the
  // setter, so a pick finishing after another one would otherwise write over it. Every change goes through here.
  const latest = useRef(sp);
  latest.current = sp;
  const edit = (fn: (now: string[]) => string[]) => {
    const x = new URLSearchParams(latest.current);
    x.set("teams", fn(teamsOf(x.get("teams"))).slice(0, MAX).join(","));
    latest.current = x;
    setSp(x, { replace: true });
  };
  const setTeams = (t: string[]) => edit(() => t);
  // Picks still being checked: each finishes on its own, so a second pick never cancels the first.
  const pending = useRef(new Set<string>());
  const add = async (n: number) => {
    const team = String(n);
    if (teams.includes(team) || pending.current.has(team)) { setError(`${team} is already in the comparison.`); return; }
    if (teams.length + pending.current.size >= MAX) return;
    pending.current.add(team);
    setChecking(true);
    const err = await teamError(team, lookupTeamName);
    pending.current.delete(team);
    setChecking(pending.current.size > 0);
    if (err) { setError(err); input.current?.focus(); return; }
    setError(null);
    // From the URL as it is now: a team removed (or added) while checking stays that way.
    edit((now) => (now.includes(team) ? now : [...now, team]));
  };
  const addAll = (ns: number[]) => edit((now) => [...now, ...ns.map(String).filter((n) => !now.includes(n))]);
  // Without ?season the server picks the latest season these teams have results in. Asked for in one fixed
  // order, so dragging the columns into another order doesn't fetch again: the URL's order is applied here.
  // A page the server drew (server/firstPaint.ts) carries this very answer, so the first render is the comparison.
  const state = useApi<CompareView>(teams.length ? compareApiPath(teams, asked) : null);
  const order = teams.join(",");
  const view = useMemo(() => {
    if (!state.data) return state.data;
    const at = order.split(",");
    const pos = (x: CompareTeam) => { const i = at.indexOf(String(x.team.number)); return i < 0 ? at.length : i; };
    const sorted = [...state.data.teams].sort((a, b) => pos(a) - pos(b));
    return { ...state.data, teams: sorted, meetings: baselineMeetings(state.data.meetings, sorted.map((x) => x.team.number)) };
  }, [state.data, order]);
  /** Move a team to another place in the order (the first is the one the others are measured against). */
  const move = (team: number, to: number) => edit((now) => {
    const rest = now.filter((x) => x !== String(team));
    if (rest.length === now.length) return now;
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, String(team));
    return rest;
  });
  const season = asked ?? state.data?.season ?? current;
  // Titled by its teams once they're here, as the server titles a drawn comparison (src/shared/compareUrl.ts).
  useTitle(teams.length && view?.teams.length ? compareTitle(view.teams) : "Compare");
  const full = teams.length >= MAX;
  const suggestions = useSuggestions(teams.map(Number));
  const v8 = useIsV8();
  // v8: the title row of the content (docs/design/v8-page-guide.md); the controls below it are the same.
  const Header = v8 ? V8CompareHeader : PageHeader;
  return (
    <div className={cn(v8 && "min-w-0")} data-compare-v8={v8 ? "" : undefined}>
      <Header title="Compare" description="Up to four teams side by side: season stats, OPR by phase, event-by-event form and every match they've met in."
>
        {/* The search stays first, at the same place, however many teams are chosen. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <TeamPicker className="w-full sm:w-[28rem]" onPick={add} exclude={teams.map(Number)} busy={checking} error={error} onEdit={() => setError(null)}
            inputRef={input} autoFocus={!teams.length} disabled={full}
            label="Add a team to compare" placeholder={full ? "Four teams is the most: remove one to add another" : "Add a team: number or name"} />
          <p className="flex items-center text-sm text-muted-foreground sm:h-12 v8:text-text-faint" aria-live="polite">{teams.length} of {MAX} teams</p>
        </div>
        {teams.length > 0 && !full && suggestions.length > 0 && <QuickPicks list={suggestions} onPick={add} />}
        {/* The season sits under the team controls, so switching teams and seasons happens in one place. */}
        <div className="mt-3"><SeasonToggle value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} /></div>
      </Header>
      {!teams.length ? <Start suggestions={suggestions} onPick={add} onPickAll={addAll} /> : (
        <>
          {/* Until the comparison loads (or if it fails), the chosen teams can still be removed here. */}
          {!state.data && (
            <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Chosen teams">
              {teams.map((t, i) => (
                <span key={t} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card pl-3 pr-1 font-mono text-sm v8:rounded-lg v8:border-line v8:font-sans v8:tabular-nums">
                  <span className="size-2 rounded-full" style={{ background: palette[i] }} />{t}
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${t}`} onClick={() => setTeams(teams.filter((x) => x !== t))}><X /></Button>
                </span>
              ))}
            </div>
          )}
          <Async state={{ ...state, data: view }}>{(d) => {
            // Without ?season the server picks the season: say which and why when it isn't simply the current one.
            const note = compareSeasonNote({ asked: asked != null, season: d.season, current, teams: d.teams.map((x) => ({ number: x.team.number, hasResults: !!x.stats })) });
            return (
              <>
                {note && <p className="mb-4 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/[0.07] px-3 py-2.5 text-sm v8:border-line v8:bg-card v8:text-text-muted" role="note" data-season-note><Info className="mt-0.5 size-4 shrink-0 text-accent-text v8:text-text-faint" aria-hidden />{note}</p>}
                <Compare d={d} onRemove={(n) => setTeams(teams.filter((x) => x !== String(n)))} onMove={move} />
              </>
            );
          }}</Async>
        </>
      )}
    </div>
  );
}

interface Suggestion { team: number; why: "Your team" | "Followed" | "Shortlist" | "Tracked" }

/** The member's own teams to offer: Control Point teams, the followed team, then shortlist and tracked teams. */
function useSuggestions(chosen: number[]): Suggestion[] {
  const { user, state } = usePersonal();
  const key = chosen.join(",");
  return useMemo(() => {
    const out: Suggestion[] = [];
    const push = (team: number, why: Suggestion["why"]) => { if (Number.isInteger(team) && team > 0 && !chosen.includes(team) && !out.some((s) => s.team === team)) out.push({ team, why }); };
    for (const t of myTeamsOf(user).teams) push(t.teamNumber, "Your team");
    if (state.myTeam) push(state.myTeam, "Followed");
    for (const n of state.bookmarks ?? []) push(n, "Shortlist");
    for (const n of state.tracked?.teams ?? []) push(n, "Tracked");
    return out.slice(0, 8);
  }, [user, state.myTeam, state.bookmarks, state.tracked, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function SuggestionChip({ s, onPick, big }: { s: Suggestion; onPick: (n: number) => void; big?: boolean }) {
  const name = useTeamName(s.team);
  const color = useTeamColors().colorOf(s.team);
  // .lift (rise and glow) is plain CSS no v8: class can undo: left off in v8.
  const v8 = useIsV8();
  return (
    <button type="button" onClick={() => onPick(s.team)}
      className={cn(v8 ? "inline-flex min-w-0 items-center gap-2 rounded-lg border border-line bg-card text-left transition-colors duration-150 hover:bg-ink/[0.04] active:scale-[0.97] motion-reduce:active:scale-100"
        : "lift inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card text-left hover:border-accent/50",
        big ? "w-full px-3.5 py-3" : "h-9 px-3 text-sm max-sm:h-10")}>
      {/* The name is the chip's own text with "Add" in front ("Add 18360 Robo Raiders"); the spaces are explicit
          because a name from content joins inline pieces without them. */}
      <Plus className="size-4 shrink-0 text-accent v8:text-text-faint" aria-hidden /><span className="sr-only">Add</span>{" "}
      {color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: color.css }} title={color.label} aria-hidden />}
      <span className={cn("font-mono font-semibold tabular-nums v8:font-sans", V8_NUM)}>{s.team}</span>{" "}
      {big ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm" title={name ?? undefined}>{name || (name === undefined ? "…" : "Unnamed team")}</span>{" "}
          <span className="block text-xs text-muted-foreground">{s.why}</span>
        </span>
      ) : name ? <span className="max-w-[10rem] truncate text-muted-foreground" title={name}>{name}</span> : null}
    </button>
  );
}

function QuickPicks({ list, onPick }: { list: Suggestion[]; onPick: (n: number) => void }) {
  return (
    <Stagger className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground v8:text-text-faint">Quick add:</span>
      {list.slice(0, 5).map((s) => <StaggerItem key={s.team}><SuggestionChip s={s} onPick={onPick} /></StaggerItem>)}
    </Stagger>
  );
}

/** No teams yet: where to start, and the member's own teams one click away. */
function Start({ suggestions, onPick, onPickAll }: { suggestions: Suggestion[]; onPick: (n: number) => void; onPickAll: (ns: number[]) => void }) {
  const yours = suggestions.filter((s) => s.why === "Your team" || s.why === "Followed").slice(0, MAX);
  const v8 = useIsV8();
  return (
    <Reveal className="rounded-2xl border border-border bg-card p-4 sm:p-6 v8:rounded-xl v8:border-line sm:v8:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 v8:size-5 v8:bg-transparent"><Scale className="size-5 text-accent v8:size-4 v8:text-text-faint" aria-hidden /></span>
        <div className="min-w-0">
          <p className="font-medium">Pick up to four teams</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <ArrowUp className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />Search by number or name in the box above. Every team page also has a Compare button.
          </p>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-5 max-sm:mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Start with your teams</p>
            {yours.length >= 2 && <Button size="sm" variant="secondary" onClick={() => onPickAll(yours.map((s) => s.team))}><Scale /> Compare your {yours.length} teams</Button>}
          </div>
          <Stagger className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {suggestions.map((s) => <StaggerItem key={s.team} className="min-w-0"><SuggestionChip s={s} onPick={onPick} big /></StaggerItem>)}
          </Stagger>
        </div>
      )}
      <ul className="mt-5 max-sm:mt-4 grid list-disc gap-x-8 gap-y-1.5 border-t border-border pl-4 pt-4 text-sm text-muted-foreground marker:text-accent sm:grid-cols-2 lg:grid-cols-4 v8:border-line v8:marker:text-text-faint" aria-label="What you'll see">
        <li>{v8 ? "Who leads each stat, counted up first" : "Season OPR, rating and record, with the best of each marked"}</li>
        <li>OPR split into auto, TeleOp and endgame</li>
        <li>Event-by-event OPR, to see who's improving</li>
        <li>Every match they've played with or against each other</li>
      </ul>
    </Reveal>
  );
}

type Better = "high" | "low" | null;
interface Metric { label: string; /** v8: the OPR phase whose colour the row takes. */ phase?: V8Phase; /** v8 phones: a short label, so the row stays one line. */ short?: string; better: Better; value: (x: CompareTeam) => number | null; show: (x: CompareTeam) => string; sub?: (x: CompareTeam) => string | null; title?: (x: CompareTeam | null) => string }

const winRate = (x: CompareTeam) => {
  const r = x.stats?.record;
  const n = r ? r.wins + r.losses + r.ties : 0;
  return r && n ? r.wins / n : null;
};
const METRICS: Metric[] = [
  { label: "OPR", phase: "np", better: "high", value: (x) => x.stats?.opr.np.value ?? null, show: (x) => num(x.stats?.opr.np.value), sub: (x) => rankPct(x.stats?.opr.np.rank, x.stats?.opr.np.of) },
  // An estimate from match results (src/shared/reliability.ts), right under OPR: captains pick on both.
  { label: "Reliability (est.)", short: "Reliab.", better: "high", value: (x) => x.stats?.reliability?.index ?? null, show: (x) => (x.stats?.reliability ? String(x.stats.reliability.index) : "—"), sub: (x) => (x.stats?.reliability ? `${x.stats.reliability.matches} quals` : null) },
  // Swing, the consistency stat (the engine's, same number as the reliability index's part): lower = steadier.
  { label: "Swing", better: "low", value: (x) => x.stats?.reliability?.consistency?.value ?? null, show: (x) => swingText(x.stats?.reliability?.consistency),
    sub: (x) => (x.stats?.reliability?.consistency?.value != null ? `${x.stats.reliability.consistency.matches} quals` : null), title: (x) => (x ? swingTitle(x.stats?.reliability?.consistency) : SWING_LINE) },
  { label: "Auto", phase: "auto", better: "high", value: (x) => x.stats?.opr.auto.value ?? null, show: (x) => num(x.stats?.opr.auto.value) },
  { label: "TeleOp", phase: "teleop", better: "high", value: (x) => x.stats?.opr.teleop.value ?? null, show: (x) => num(x.stats?.opr.teleop.value) },
  { label: "Endgame", phase: "endgame", better: "high", value: (x) => x.stats?.opr.endgame.value ?? null, show: (x) => num(x.stats?.opr.endgame.value) },
  { label: "Rating", phase: "np", better: "high", value: (x) => x.stats?.rating?.np ?? null, show: (x) => (x.stats?.rating ? `${num(x.stats.rating.np)} ±${num(x.stats.rating.sd, 0)}` : "—"), sub: (x) => (x.stats?.rating?.rank ? `#${x.stats.rating.rank.toLocaleString()}` : null) },
  { label: "Record", better: "high", value: winRate, show: (x) => (x.stats ? `${x.stats.record.wins}-${x.stats.record.losses}-${x.stats.record.ties}` : "—"), sub: (x) => { const w = winRate(x); return w == null ? null : `${Math.round(w * 100)}% won`; } },
  { label: "Events", better: null, value: (x) => x.stats?.record.events ?? null, show: (x) => (x.stats ? String(x.stats.record.events) : "—") },
  { label: "Avg score", better: "high", value: (x) => x.stats?.avg.score ?? null, show: (x) => num(x.stats?.avg.score) },
  { label: "Pen. given", phase: "pen", better: null, value: (x) => x.stats?.opr.pen ?? null, show: (x) => num(x.stats?.opr.pen), sub: (x) => (x.stats?.opr.pen != null ? "per match" : null) },
];

/** Which teams lead a row: only with two or more values, every team tied at the top. */
export function leaders(m: Pick<Metric, "better" | "value">, t: CompareTeam[]): Set<number> {
  if (!m.better) return new Set();
  const vals = t.map((x) => m.value(x)).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length < 2) return new Set();
  const top = m.better === "low" ? Math.min(...vals) : Math.max(...vals);
  return new Set(t.filter((x) => m.value(x) === top).map((x) => x.team.number));
}

/** How a table cell fades in (a new team's column, or the rows on first load). */
const CELL = { duration: 0.28, ease: [0.2, 0.8, 0.2, 1] as const };

const ORDINAL = ["first", "second", "third", "fourth"];
/** The first team's column, the one the others are measured against: a neutral tint. */
// A neutral tint, not the accent: gold marks the interface, never a team or a value.
const BASELINE = "bg-foreground/[0.04]";

function StatsTable({ d, onRemove, onMove }: { d: CompareView; onRemove: (n: number) => void; onMove: (team: number, to: number) => void }) {
  const t = d.teams;
  // v8: no Motion fades (v8-page-guide: no layout/entrance animation on tables); plain cells, same markup.
  const v8 = useIsV8();
  const Th = (v8 ? "th" : m.th) as typeof m.th, Tr = (v8 ? "tr" : m.tr) as typeof m.tr, Td = (v8 ? "td" : m.td) as typeof m.td;
  const fade = <T,>(x: T) => (v8 ? {} : x);
  const { colorOf } = useTeamColors();
  const COLORS = teamPalette(t.map((x) => x.team.number), colorOf);
  // Reordering: drag a column's grip onto another column (mouse, pen or touch), or arrow keys on the grip.
  const [drag, setDrag] = useState<{ team: number; from: number; over: number } | null>(null);
  const [said, setSaid] = useState("");
  const refocus = useRef<number | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const order = t.map((x) => x.team.number).join(",");
  // A moved column's grip keeps the keyboard focus (moving the node in the DOM can drop it).
  useEffect(() => {
    if (refocus.current == null) return;
    table.current?.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus();
    refocus.current = null;
  }, [order]);
  const moveTo = (team: number, to: number) => {
    if (to < 0 || to >= t.length) return;
    onMove(team, to);
    setSaid(`${team} moved to ${ORDINAL[to]}${to === 0 ? ": the others are measured against it" : ""}.`);
  };
  const colAt = (e: { clientX: number; clientY: number }) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-col]");
    return el && table.current?.contains(el) ? Number(el.dataset.col) : null;
  };
  // While dragging near the table's left or right edge (a phone shows only some columns), it scrolls that way,
  // so a far column can be reached in one drag.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dragging = drag != null;
  useEffect(() => {
    if (!dragging) { pointer.current = null; return; }
    let frame = 0;
    const step = () => {
      const box = table.current?.parentElement, p = pointer.current;
      if (box && p) {
        const r = box.getBoundingClientRect(), edge = Math.min(48, r.width / 4);
        const dx = p.x < r.left + edge ? -10 : p.x > r.right - edge ? 10 : 0;
        if (dx && box.scrollWidth > box.clientWidth) {
          box.scrollLeft += dx;
          const c = colAt({ clientX: p.x, clientY: p.y });
          if (c != null) setDrag((d) => (d && d.over !== c ? { ...d, over: c } : d));
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  const gripProps = (team: number, i: number) => ({
    "data-grip": team,
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ team, from: i, over: i }); },
    onPointerMove: (e: PointerEvent) => {
      if (!drag) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      const c = colAt(e); if (c != null && c !== drag.over) setDrag({ ...drag, over: c });
    },
    onPointerUp: () => { if (drag && drag.over !== drag.from) moveTo(drag.team, drag.over); setDrag(null); },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent) => {
      const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? t.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      if (to === i || to < 0 || to >= t.length) return;
      refocus.current = team;
      moveTo(team, to);
    },
  });
  const colClass = (i: number) => cn(i === 0 && t.length > 1 && BASELINE, drag && drag.over === i && drag.from !== i && "outline-2 -outline-offset-2 outline-accent v8:outline-ink/40", drag?.from === i && "opacity-60");
  return (
    <Reveal className="min-w-0 self-start overflow-x-auto rounded-2xl border border-border bg-card v8:rounded-xl v8:border-line" data-stats-table>
      <p className="sr-only" aria-live="polite">{said}</p>
      {/* v8 (Sushil's table note): visible hairlines, a header rule, 44px rows, numbers right-aligned, the team on one
          line, and narrow enough that three teams fit a phone without scrolling sideways. */}
      <table ref={table} className="w-full table-fixed border-collapse text-sm" style={{ minWidth: v8 ? `${4.75 + t.length * 6.5}rem` : `${5 + t.length * 8}rem` }}>
        <caption className="sr-only">Season stats; the best in each row is marked</caption>
        <thead>
          <tr className="v8:border-b v8:border-ink/[0.12]">
            <th scope="col" className="w-20 p-3 sm:w-24 v8:w-[4.75rem] sm:v8:w-32"><span className="sr-only">Stat</span></th>
            {t.map((x, i) => (
              <Th key={x.team.number} scope="col" data-col={i} className={cn("border-l border-border p-3 text-left align-top font-normal v8:border-line", colClass(i))} style={{ boxShadow: `inset 0 ${v8 ? 2 : 3}px 0 ${COLORS[i]}` }}
                {...fade({ initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, transition: CELL })}>
                {v8 ? (
                  <>
                    <Link to={`/teams/${x.team.number}?season=${d.season}`} className="flex min-w-0 items-baseline gap-2 hover:underline" title={x.team.name ?? undefined}>
                      <span className="shrink-0 font-display text-lg font-semibold tabular-nums text-text-base">{x.team.number}</span>
                      <span className="min-w-0 truncate text-xs text-text-muted max-sm:hidden">{x.team.name ?? ""}</span>
                    </Link>
                    <div className="-mb-1 -ml-2 mt-1 flex items-center gap-1">
                      {t.length > 1 && (
                        <button type="button" {...gripProps(x.team.number, i)}
                          aria-label={`Reorder ${x.team.number}, ${ORDINAL[i]} of ${t.length}: drag, or use the arrow keys`} title="Drag to reorder: the first team is the one the others are measured against"
                          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-text-faint hover:bg-ink/[0.06] hover:text-text-base focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing pointer-coarse:size-[44px]">
                          <GripVertical className="size-4" aria-hidden />
                        </button>
                      )}
                      {i === 0 && t.length > 1 && <span className="truncate text-[0.6875rem] text-text-faint max-sm:sr-only">Baseline</span>}
                      <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0 text-text-faint pointer-coarse:size-[44px]" aria-label={`Remove ${x.team.number}`} onClick={() => onRemove(x.team.number)}><X /></Button>
                    </div>
                  </>
                ) : (
                <div className="flex items-start justify-between gap-1 pointer-coarse:flex-wrap pointer-coarse:gap-0">
                  {t.length > 1 && (
                    <button type="button" {...gripProps(x.team.number, i)}
                      aria-label={`Reorder ${x.team.number}, ${ORDINAL[i]} of ${t.length}: drag, or use the arrow keys`} title="Drag to reorder: the first team is the one the others are measured against"
                      className="-ml-2 -mt-0.5 flex h-8 w-5 shrink-0 pointer-coarse:mt-0 pointer-coarse:-ml-3 pointer-coarse:h-[44px] pointer-coarse:w-[44px] cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing max-sm:h-10">
                      <GripVertical className="size-4" aria-hidden />
                    </button>
                  )}
                  <Link to={`/teams/${x.team.number}?season=${d.season}`} className="min-w-0 hover:underline pointer-coarse:order-first pointer-coarse:min-h-[44px] pointer-coarse:basis-full">
                    <span className="block font-display text-xl font-semibold tabular-nums v8:text-text-base">{x.team.number}</span>
                    <span className="block truncate text-xs text-muted-foreground">{x.team.name ?? "—"}</span>
                    {i === 0 && t.length > 1 && <span className="mt-1 inline-block rounded-full border border-border bg-muted px-1.5 text-[10px] font-semibold text-foreground/80 v8:border-line v8:bg-transparent v8:text-[0.6875rem] v8:font-normal v8:text-text-faint">Baseline</span>}
                  </Link>
                  <Button variant="ghost" size="icon-sm" className="-mr-1.5 -mt-1 shrink-0 max-sm:size-10 pointer-coarse:ml-auto pointer-coarse:mt-0 pointer-coarse:size-[44px]" aria-label={`Remove ${x.team.number}`} onClick={() => onRemove(x.team.number)}><X /></Button>
                </div>
                )}
                {!x.stats && <span className="mt-1 block text-xs text-muted-foreground v8:truncate v8:text-text-faint">No results this season</span>}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric, row) => {
            const best = leaders(metric, t);
            return (
              <Tr key={metric.label} className="border-t border-border v8:border-ink/[0.08] v8:first:border-t-0" {...fade({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { ...CELL, delay: 0.05 + row * 0.03 } })}>
                <th scope="row" className={cn("px-3 py-2 text-left font-normal text-muted-foreground v8:h-11 v8:truncate v8:py-0", metric.phase ? V8_PHASE[metric.phase] : "v8:text-text-muted")} title={metric.title?.(null) ?? metric.label}>{v8 && metric.short ? <><span className="sm:hidden" aria-hidden>{metric.short}</span><span className="max-sm:sr-only">{metric.label}</span></> : metric.label}</th>
                {t.map((x, i) => {
                  const lead = best.has(x.team.number);
                  const sub = metric.sub?.(x);
                  return (
                    <Td key={x.team.number} data-col={i} data-lead={lead || undefined} title={metric.title?.(x)} className={cn("border-l border-border px-3 py-2 tabular-nums transition-colors duration-300 v8:h-11 v8:whitespace-nowrap v8:border-line v8:py-0 v8:text-right v8:duration-150", colClass(i), lead && "bg-foreground/[0.07] v8:bg-ink/[0.06]")}
                      {...fade({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: CELL })}>
                      <span className={cn("whitespace-nowrap font-medium", lead ? cn("font-bold text-foreground v8:font-semibold", metric.phase ? V8_PHASE[metric.phase] : "v8:text-text-base") : best.size > 0 ? "v8:text-text-muted" : metric.phase && V8_PHASE[metric.phase])}>{metric.show(x)}</span>
                      {lead && <span className="sr-only"> (best)</span>}
                      {sub && <span className="whitespace-nowrap text-xs text-muted-foreground max-sm:block sm:ml-1.5 max-sm:v8:hidden v8:text-text-faint">{sub}</span>}
                    </Td>
                  );
                })}
              </Tr>
            );
          })}
        </tbody>
      </table>
      {v8 ? (
        // v8: the explanation waits behind a disclosure.
        <details className="group border-t border-ink/[0.08] text-xs text-text-faint" data-swing-line>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 hover:text-text-muted [&::-webkit-details-marker]:hidden">
            <Info className="size-3.5" aria-hidden />About these numbers
          </summary>
          <p className="px-3 pb-3">{SWING_LINE} <Link to="/methodology#swing" className="underline">How it's computed</Link></p>
        </details>
      ) : <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground" data-swing-line>{SWING_LINE} <Link to="/methodology#swing" className="underline">How it's computed</Link></p>}
    </Reveal>
  );
}

function ChartCard({ title, description, delay = 0, children }: { title: string; description: string; delay?: number; children: ReactNode }) {
  return (
    <Reveal delay={delay} className="min-w-0 rounded-2xl border border-border bg-card p-4 v8:rounded-xl v8:border-line">
      <section aria-label={title}>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="mt-2">{children}</div>
      </section>
    </Reveal>
  );
}

/** The compare trend's line patterns, one per chosen team (four at most): solid, dashed, dotted, dash-dot. */
const LINE_DASH = [undefined, "6 3", "2 3", "8 3 2 3"];

function Compare({ d, onRemove, onMove }: { d: CompareView; onRemove: (n: number) => void; onMove: (team: number, to: number) => void }) {
  const t = d.teams;
  const { colorOf } = useTeamColors();
  const COLORS = teamPalette(t.map((x) => x.team.number), colorOf);
  const phase = (["auto", "teleop", "endgame"] as const).map((k) => ({ phase: k === "auto" ? "Auto" : k === "teleop" ? "TeleOp" : "Endgame", ...Object.fromEntries(t.map((x) => [String(x.team.number), x.stats?.opr[k].value ?? 0])) }));
  const config = Object.fromEntries(t.map((x, i) => [String(x.team.number), { label: String(x.team.number), color: COLORS[i] }]));
  const maxEvents = Math.max(0, ...t.map((x) => x.events.length));
  const trend = Array.from({ length: maxEvents }, (_, i) => ({ i: `E${i + 1}`, ...Object.fromEntries(t.map((x) => [String(x.team.number), x.events[i]?.opr ?? null])) }));
  // 2019–2022 are history only: their predict routes 404, so no "Predict" button.
  const predictable = usePredictable(d.season);
  const v8 = useIsV8();
  const lab = t.length === 4 && predictable ? predictHref({ mode: "match", season: d.season, red: [t[0].team.number, t[1].team.number], blue: [t[2].team.number, t[3].team.number] }) : null;
  return (
    <div className="space-y-6 max-sm:space-y-4">
      {v8 && t.length > 1 && <Verdict t={t} colors={COLORS} season={d.season} />}
      {/* The stats and both charts share the first screen from lg up. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <StatsTable d={d} onRemove={onRemove} onMove={onMove} />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <ChartCard title="OPR by phase" description="From each team's best event this season" delay={0.06}>
            <ChartContainer config={config} className="h-48 w-full">
              <BarChart data={phase} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="phase" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={32} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Legend />
                {t.map((x) => <Bar key={x.team.number} dataKey={String(x.team.number)} fill={`var(--color-${x.team.number})`} radius={[4, 4, 0, 0]} />)}
              </BarChart>
            </ChartContainer>
          </ChartCard>
          <ChartCard title="OPR event by event" description="Each team's events in order (E1 = its first)" delay={0.12}>
            {maxEvents < 2 ? <p className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">Needs two events to draw a line.</p> : (
              <ChartContainer config={config} className="h-48 w-full">
                <LineChart data={trend} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="i" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Legend iconType="plainline" />
                  {/* Each line has its own dash and dot shape as well as its colour, so the teams tell apart without colour. */}
                  {t.map((x, i) => <Line key={x.team.number} dataKey={String(x.team.number)} stroke={`var(--color-${x.team.number})`} strokeWidth={2} strokeDasharray={LINE_DASH[i % LINE_DASH.length]} connectNulls dot={{ r: 3 }} />)}
                </LineChart>
              </ChartContainer>
            )}
          </ChartCard>
        </div>
      </div>
      {/* The brief stays closed until asked for: the table and charts come first. */}
      <CompareBrief d={d} />
      {lab && <Button asChild variant="secondary"><Link to={lab}><Sparkles /> Predict {t[0].team.number}+{t[1].team.number} vs {t[2].team.number}+{t[3].team.number}</Link></Button>}
      <Section id="awards" title="Events and awards" description={`Each team's ${seasonLabel(d.season)} season side by side: where it played, how it ranked, and what it won`}>
        <div className={cn("grid gap-3", t.length > 1 && "sm:grid-cols-2", t.length > 2 && "xl:grid-cols-4")}>
          {t.map((x, i) => (
            <div key={x.team.number} className="min-w-0 rounded-xl border border-border bg-card p-3 v8:border-line sm:v8:p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><span className="size-2.5 shrink-0 rounded-full" style={{ background: COLORS[i] }} />
                <Link to={`/teams/${x.team.number}?season=${d.season}`} className="truncate hover:text-accent-text pointer-coarse:block pointer-coarse:leading-[44px] v8:hover:text-text-base v8:hover:underline">{x.team.number} {x.team.name}</Link></p>
              <ul className="mt-2 space-y-1 text-xs">
                {x.events.length ? x.events.map((e) => (
                  <li key={e.code} className="flex items-baseline gap-2 pointer-coarse:min-h-[44px] pointer-coarse:items-center">
                    <Link to={`/events/${d.season}/${e.code}?team=${x.team.number}`} className="min-w-0 flex-1 truncate text-foreground/90 hover:text-accent-text pointer-coarse:leading-[44px] v8:hover:text-text-base v8:hover:underline" title={e.name}>{e.name}</Link>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{e.rank ? `#${e.rank}` : "—"} · OPR {e.opr == null ? "—" : num(e.opr, 1)}</span>
                  </li>
                )) : <li className="text-muted-foreground">No events this season.</li>}
              </ul>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground v8:text-xs v8:font-normal v8:normal-case v8:tracking-normal v8:text-text-faint">Awards ({x.awards.length})</p>
              <ul className="mt-1 space-y-1 text-xs">
                {x.awards.length ? x.awards.map((a) => (
                  <li key={`${a.code}:${a.type}:${a.placement}`} className="flex items-baseline gap-1.5"><Trophy className="size-3 shrink-0 translate-y-px text-accent v8:text-text-faint" />
                    <span className="min-w-0"><span className="font-medium">{awardLabel(a.type, a.placement)}</span> <span className="text-muted-foreground">at {a.event}</span></span></li>
                )) : <li className="text-muted-foreground">None this season.</li>}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      {t.length > 1 && (
        <Section title={`Head to head (${d.meetings.length})`} description={`Matches where ${t[0].team.number} played with or against the others this season`}>
          {d.meetings.length ? <MatchList matches={d.meetings} highlight={t[0].team.number} eventNames={compareEventNames(d)} />
            : <p className="text-sm text-muted-foreground">They haven't played with or against each other this season.</p>}
        </Section>
      )}
      {/* Workspace members only, and only once their workspace has scouted one of these teams. */}
      {predictable && <CompareConsensus teams={t.map((x) => x.team.number)} season={d.season} colors={COLORS} hideWhenEmpty />}
    </div>
  );
}

/** The v8 title row (docs/design/v8-page-guide.md): the page title at the content's top, the controls under it. */
function V8CompareHeader({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return <V8Title title={title} line={description}>{children}</V8Title>;
}

/** Each team's wins on the table: the rows it leads (every team tied at the top leads), and how many rows had a leader.
 *  Exported for its test. */
export function verdict(t: CompareTeam[]): { rows: number; teams: { team: number; leads: string[] }[] } {
  const leads = new Map(t.map((x) => [x.team.number, [] as string[]]));
  let rows = 0;
  for (const metric of METRICS) {
    const best = leaders(metric, t);
    if (!best.size) continue;
    rows++;
    for (const n of best) leads.get(n)?.push(metric.label);
  }
  return { rows, teams: t.map((x) => ({ team: x.team.number, leads: leads.get(x.team.number) ?? [] })) };
}

/** v8, the answer first: how many of the table's stats each team leads, and which. The team ahead on most gets the
 *  accent (the "best" mark); a tie at the top says so. */
function Verdict({ t, colors, season }: { t: CompareTeam[]; colors: string[]; season: number }) {
  const v = verdict(t);
  const most = Math.max(0, ...v.teams.map((x) => x.leads.length));
  const top = v.teams.filter((x) => x.leads.length === most && most > 0);
  const name = (n: number) => t.find((x) => x.team.number === n)?.team.name;
  const headline = !v.rows ? "Not enough results to call a leader yet."
    : top.length === 1 ? `${top[0].team} leads on ${most} of ${v.rows} stats.`
    : `${top.map((x) => x.team).join(" and ")} are level, ${most} of ${v.rows} stats each.`;
  // Level on count: the higher OPR (the stat captains pick on first) breaks it, said as a second line.
  const opr = (n: number) => t.find((x) => x.team.number === n)?.stats?.opr.np.value ?? null;
  const byOpr = top.length > 1 ? [...top].filter((x) => opr(x.team) != null).sort((a, b) => opr(b.team)! - opr(a.team)!) : [];
  const tieBreak = byOpr.length > 1 && opr(byOpr[0].team) !== opr(byOpr[1].team) ? `${byOpr[0].team} has the higher OPR.` : null;
  return (
    <section aria-labelledby="compare-verdict" className="rounded-xl border border-line bg-card p-4 sm:p-5" data-verdict>
      <h2 id="compare-verdict" className={V8_LABEL}>Who's ahead · {seasonLabel(season)}</h2>
      <p className="mt-1 text-lg font-semibold tracking-tight text-text-base" data-verdict-line>{headline}</p>
      {tieBreak && <p className="text-sm text-text-muted" data-verdict-tiebreak>{tieBreak}</p>}
      <ul className={cn("mt-4 grid gap-3 max-sm:gap-2.5", t.length === 2 ? "sm:grid-cols-2" : t.length === 3 ? "sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-4")}>
        {v.teams.map((x, i) => {
          const ahead = top.length === 1 && top[0].team === x.team;
          return (
            <li key={x.team} className="min-w-0 border-t-2 pt-3 max-sm:pt-2.5" style={{ borderTopColor: colors[i] }} data-verdict-team={x.team}>
              {/* A phone: the team and its count on one line, the stats it leads under them. */}
              <div className="flex items-baseline justify-between gap-3 sm:block">
                <p className="flex min-w-0 items-baseline gap-2">
                  <Link to={`/teams/${x.team}?season=${season}`} className={cn("font-display text-lg font-semibold tabular-nums text-text-base hover:underline", V8_NUM)}>{x.team}</Link>
                  <span className="min-w-0 truncate text-xs text-text-muted" title={name(x.team) ?? undefined}>{name(x.team) ?? ""}</span>
                </p>
                <p className="flex shrink-0 items-baseline gap-1.5 sm:mt-1">
                  <span className={cn("font-display text-[1.5rem] font-semibold leading-none tabular-nums sm:text-[2rem]", ahead ? "text-accent" : "text-text-base")} data-verdict-count>{x.leads.length}</span>
                  <span className="text-xs text-text-faint">of {v.rows}<span className="max-sm:hidden"> stats led</span>{ahead ? <span className="max-sm:hidden"> · ahead on most</span> : ""}</span>
                </p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{x.leads.length ? x.leads.join(" · ") : "Leads none of them"}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
