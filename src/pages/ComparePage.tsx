// Compare up to four teams head to head: OPR by phase, prediction ratings,
// records, event-by-event OPR, and every match where they met or partnered.
//
// The team search sits in one place, first under the title, whether no team or three are chosen, so it
// never moves as teams are added. With none chosen, the page offers the member's own teams (Control
// Point, followed, shortlist, tracked) as one-click picks. With teams chosen, the stats table and both
// charts share the first screen; head to head and the workspace's scouting (only when there is some) follow.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowUp, Plus, Scale, Sparkles, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
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
import { num, rankPct } from "../lib/format";
import { CompareConsensus } from "../components/ScoutConsensus";
import { cn } from "../components/cn";

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];
const MAX = 4;

export default function ComparePage() {
  useTitle("Compare");
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const asked = Number(sp.get("season")) || null;
  const teams = (sp.get("teams") ?? "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, MAX);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The URL as last written: React Router's functional update reads the params of the render that made the
  // setter, so a pick finishing after another one would otherwise write over it. Every change goes through here.
  const latest = useRef(sp);
  latest.current = sp;
  const edit = (fn: (now: string[]) => string[]) => {
    const x = new URLSearchParams(latest.current);
    x.set("teams", fn((x.get("teams") ?? "").split(",").filter((t) => /^\d+$/.test(t))).slice(0, MAX).join(","));
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
  // Without ?season the server picks the latest season these teams have results in.
  const state = useApi<CompareView>(teams.length ? `/api/compare${qs({ teams: teams.join(","), season: asked ?? undefined })}` : null);
  const season = asked ?? state.data?.season ?? current;
  const full = teams.length >= MAX;
  const suggestions = useSuggestions(teams.map(Number));
  return (
    <div>
      <PageHeader title="Compare" description="Up to four teams side by side: season stats, OPR by phase, event-by-event form and every match they've met in."
        actions={<SeasonToggle value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />}>
        {/* The search stays first, at the same place, however many teams are chosen. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <TeamPicker className="w-full sm:w-[28rem]" onPick={add} exclude={teams.map(Number)} busy={checking} error={error} onEdit={() => setError(null)}
            inputRef={input} autoFocus={!teams.length} disabled={full}
            label="Add a team to compare" placeholder={full ? "Four teams is the most: remove one to add another" : "Add a team: number or name"} />
          <p className="flex items-center text-sm text-muted-foreground sm:h-12" aria-live="polite">{teams.length} of {MAX} teams</p>
        </div>
        {teams.length > 0 && !full && suggestions.length > 0 && <QuickPicks list={suggestions} onPick={add} />}
      </PageHeader>
      {!teams.length ? <Start suggestions={suggestions} onPick={add} onPickAll={addAll} /> : (
        <>
          {/* Until the comparison loads (or if it fails), the chosen teams can still be removed here. */}
          {!state.data && (
            <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Chosen teams">
              {teams.map((t, i) => (
                <span key={t} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card pl-3 pr-1 font-mono text-sm">
                  <span className="size-2 rounded-full" style={{ background: COLORS[i] }} />{t}
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${t}`} onClick={() => setTeams(teams.filter((x) => x !== t))}><X /></Button>
                </span>
              ))}
            </div>
          )}
          <Async state={state}>{(d) => <Compare d={d} onRemove={(n) => setTeams(teams.filter((x) => x !== String(n)))} />}</Async>
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
  return (
    <button type="button" onClick={() => onPick(s.team)} aria-label={`Add ${s.team}${name ? ` ${name}` : ""}`}
      className={cn("lift inline-flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card text-left hover:border-accent/50",
        big ? "w-full px-3.5 py-3" : "h-9 px-3 text-sm max-sm:h-11")}>
      <Plus className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="font-mono font-semibold tabular-nums">{s.team}</span>
      {big ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name || (name === undefined ? "…" : "Unnamed team")}</span>
          <span className="block text-xs text-muted-foreground">{s.why}</span>
        </span>
      ) : name ? <span className="max-w-[10rem] truncate text-muted-foreground">{name}</span> : null}
    </button>
  );
}

function QuickPicks({ list, onPick }: { list: Suggestion[]; onPick: (n: number) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Quick add:</span>
      {list.slice(0, 5).map((s) => <SuggestionChip key={s.team} s={s} onPick={onPick} />)}
    </div>
  );
}

/** No teams yet: where to start, and the member's own teams one click away. */
function Start({ suggestions, onPick, onPickAll }: { suggestions: Suggestion[]; onPick: (n: number) => void; onPickAll: (ns: number[]) => void }) {
  const yours = suggestions.filter((s) => s.why === "Your team" || s.why === "Followed").slice(0, MAX);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15"><Scale className="size-5 text-accent" aria-hidden /></span>
        <div className="min-w-0">
          <p className="font-medium">Pick up to four teams</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <ArrowUp className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />Search by number or name in the box above. Every team page also has a Compare button.
          </p>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Start with your teams</p>
            {yours.length >= 2 && <Button size="sm" variant="secondary" onClick={() => onPickAll(yours.map((s) => s.team))}><Scale /> Compare your {yours.length} teams</Button>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {suggestions.map((s) => <SuggestionChip key={s.team} s={s} onPick={onPick} big />)}
          </div>
        </div>
      )}
      <ul className="mt-5 grid list-disc gap-x-8 gap-y-1.5 border-t border-border pl-4 pt-4 text-sm text-muted-foreground marker:text-accent sm:grid-cols-2 lg:grid-cols-4" aria-label="What you'll see">
        <li>Season OPR, rating and record, with the best of each marked</li>
        <li>OPR split into auto, TeleOp and endgame</li>
        <li>Event-by-event OPR, to see who's improving</li>
        <li>Every match they've played with or against each other</li>
      </ul>
    </div>
  );
}

type Better = "high" | null;
interface Metric { label: string; better: Better; value: (x: CompareTeam) => number | null; show: (x: CompareTeam) => string; sub?: (x: CompareTeam) => string | null }

const winRate = (x: CompareTeam) => {
  const r = x.stats?.record;
  const n = r ? r.wins + r.losses + r.ties : 0;
  return r && n ? r.wins / n : null;
};
const METRICS: Metric[] = [
  { label: "OPR", better: "high", value: (x) => x.stats?.opr.np.value ?? null, show: (x) => num(x.stats?.opr.np.value), sub: (x) => rankPct(x.stats?.opr.np.rank, x.stats?.opr.np.of) },
  { label: "Auto", better: "high", value: (x) => x.stats?.opr.auto.value ?? null, show: (x) => num(x.stats?.opr.auto.value) },
  { label: "TeleOp", better: "high", value: (x) => x.stats?.opr.teleop.value ?? null, show: (x) => num(x.stats?.opr.teleop.value) },
  { label: "Endgame", better: "high", value: (x) => x.stats?.opr.endgame.value ?? null, show: (x) => num(x.stats?.opr.endgame.value) },
  { label: "Rating", better: "high", value: (x) => x.stats?.rating?.np ?? null, show: (x) => (x.stats?.rating ? `${num(x.stats.rating.np)} ±${num(x.stats.rating.sd, 0)}` : "—"), sub: (x) => (x.stats?.rating?.rank ? `#${x.stats.rating.rank.toLocaleString()}` : null) },
  { label: "Record", better: "high", value: winRate, show: (x) => (x.stats ? `${x.stats.record.wins}-${x.stats.record.losses}-${x.stats.record.ties}` : "—"), sub: (x) => { const w = winRate(x); return w == null ? null : `${Math.round(w * 100)}% won`; } },
  { label: "Events", better: null, value: (x) => x.stats?.record.events ?? null, show: (x) => (x.stats ? String(x.stats.record.events) : "—") },
  { label: "Avg score", better: "high", value: (x) => x.stats?.avg.score ?? null, show: (x) => num(x.stats?.avg.score) },
  { label: "Pen. given", better: null, value: (x) => x.stats?.opr.pen ?? null, show: (x) => num(x.stats?.opr.pen), sub: (x) => (x.stats?.opr.pen != null ? "per match" : null) },
];

/** Which teams lead a row: only with two or more values, every team tied at the top. */
export function leaders(m: Pick<Metric, "better" | "value">, t: CompareTeam[]): Set<number> {
  if (!m.better) return new Set();
  const vals = t.map((x) => m.value(x)).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length < 2) return new Set();
  const top = Math.max(...vals);
  return new Set(t.filter((x) => m.value(x) === top).map((x) => x.team.number));
}

function StatsTable({ d, onRemove }: { d: CompareView; onRemove: (n: number) => void }) {
  const t = d.teams;
  return (
    <div className="min-w-0 self-start overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: `${5 + t.length * 8}rem` }}>
        <caption className="sr-only">Season stats; the best in each row is marked</caption>
        <thead>
          <tr>
            <th scope="col" className="w-20 p-3 sm:w-24"><span className="sr-only">Stat</span></th>
            {t.map((x, i) => (
              <th key={x.team.number} scope="col" className="border-l border-border p-3 text-left align-top font-normal" style={{ boxShadow: `inset 0 3px 0 ${COLORS[i]}` }}>
                <div className="flex items-start justify-between gap-1">
                  <Link to={`/teams/${x.team.number}?season=${d.season}`} className="min-w-0 hover:underline">
                    <span className="block font-display text-xl font-semibold tabular-nums">{x.team.number}</span>
                    <span className="block truncate text-xs text-muted-foreground">{x.team.name ?? "—"}</span>
                  </Link>
                  <Button variant="ghost" size="icon-sm" className="-mr-1.5 -mt-1 shrink-0 max-sm:size-10" aria-label={`Remove ${x.team.number}`} onClick={() => onRemove(x.team.number)}><X /></Button>
                </div>
                {!x.stats && <span className="mt-1 block text-xs text-muted-foreground">No results this season</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const best = leaders(m, t);
            return (
              <tr key={m.label} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">{m.label}</th>
                {t.map((x) => {
                  const lead = best.has(x.team.number);
                  const sub = m.sub?.(x);
                  return (
                    <td key={x.team.number} className={cn("border-l border-border px-3 py-2 tabular-nums", lead && "bg-accent/[0.08]")}>
                      <span className={cn("whitespace-nowrap font-medium", lead && "text-accent-text")}>{m.show(x)}</span>
                      {lead && <span className="sr-only"> (best)</span>}
                      {sub && <span className="whitespace-nowrap text-xs text-muted-foreground max-sm:block sm:ml-1.5">{sub}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Compare({ d, onRemove }: { d: CompareView; onRemove: (n: number) => void }) {
  const t = d.teams;
  const phase = (["auto", "teleop", "endgame"] as const).map((k) => ({ phase: k === "auto" ? "Auto" : k === "teleop" ? "TeleOp" : "Endgame", ...Object.fromEntries(t.map((x) => [String(x.team.number), x.stats?.opr[k].value ?? 0])) }));
  const config = Object.fromEntries(t.map((x, i) => [String(x.team.number), { label: String(x.team.number), color: COLORS[i] }]));
  const maxEvents = Math.max(0, ...t.map((x) => x.events.length));
  const trend = Array.from({ length: maxEvents }, (_, i) => ({ i: `E${i + 1}`, ...Object.fromEntries(t.map((x) => [String(x.team.number), x.events[i]?.opr ?? null])) }));
  // 2019–2022 are history only: their predict routes 404, so no "Predict" button.
  const predictable = usePredictable(d.season);
  const lab = t.length === 4 && predictable ? `/predict?mode=match&season=${d.season}&red=${t[0].team.number},${t[1].team.number}&blue=${t[2].team.number},${t[3].team.number}` : null;
  return (
    <div className="space-y-6">
      {/* The stats and both charts share the first screen from lg up. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <StatsTable d={d} onRemove={onRemove} />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <ChartCard title="OPR by phase" description="From each team's best event this season">
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
          <ChartCard title="OPR event by event" description="Each team's events in order (E1 = its first)">
            {maxEvents < 2 ? <p className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">Needs two events to draw a line.</p> : (
              <ChartContainer config={config} className="h-48 w-full">
                <LineChart data={trend} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="i" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  {t.map((x) => <Line key={x.team.number} dataKey={String(x.team.number)} stroke={`var(--color-${x.team.number})`} strokeWidth={2} connectNulls dot={{ r: 3 }} />)}
                </LineChart>
              </ChartContainer>
            )}
          </ChartCard>
        </div>
      </div>
      {lab && <Button asChild variant="secondary"><Link to={lab}><Sparkles /> Predict {t[0].team.number}+{t[1].team.number} vs {t[2].team.number}+{t[3].team.number}</Link></Button>}
      {t.length > 1 && (
        <Section title={`Head to head (${d.meetings.length})`} description={`Matches where ${t[0].team.number} played with or against the others this season`}>
          {d.meetings.length ? <MatchList matches={d.meetings} highlight={t[0].team.number} />
            : <p className="text-sm text-muted-foreground">They haven't played with or against each other this season.</p>}
        </Section>
      )}
      {/* Workspace members only, and only once their workspace has scouted one of these teams. */}
      {predictable && <CompareConsensus teams={t.map((x) => x.team.number)} season={d.season} colors={COLORS} hideWhenEmpty />}
    </div>
  );
}
