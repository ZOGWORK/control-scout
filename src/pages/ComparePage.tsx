// Compare up to four teams head to head: OPR by phase, prediction ratings,
// records, event-by-event OPR, and every match where they met or partnered.
import { useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import { Plus, Scale, Sparkles, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, usePredictable, useTitle } from "../lib/meta";
import type { CompareView } from "../shared/api";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { MatchList } from "../components/predict";
import { TeamInput, lookupTeamName } from "../components/TeamInput";
import { teamError } from "../lib/teamCheck";
import { SeasonToggle } from "../components/SeasonToggle";
import { num, rankPct } from "../lib/format";
import { CompareConsensus } from "../components/ScoutConsensus";

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];

export default function ComparePage() {
  useTitle("Compare");
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const asked = Number(sp.get("season")) || null;
  const teams = (sp.get("teams") ?? "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, 4);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const setTeams = (t: string[]) => setSp((x) => { x.set("teams", t.join(",")); return x; }, { replace: true });
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const add = async () => {
    if (teams.length >= 4) return;
    const team = draft;
    setChecking(true);
    const err = teams.includes(team) ? `${team} is already in the comparison.` : await teamError(team, lookupTeamName);
    setChecking(false);
    if (latestDraft.current !== team) return; // edited while checking
    if (err) { setError(err); input.current?.focus(); return; }
    // From the URL as it is now: a team removed (or added) while checking stays that way.
    setSp((x) => {
      const now = (x.get("teams") ?? "").split(",").filter((t) => /^\d+$/.test(t));
      if (!now.includes(team) && now.length < 4) x.set("teams", [...now, team].join(","));
      return x;
    }, { replace: true });
    setDraft("");
  };
  // Without ?season the server picks the latest season these teams have results in.
  const state = useApi<CompareView>(teams.length ? `/api/compare${qs({ teams: teams.join(","), season: asked ?? undefined })}` : null);
  const season = asked ?? state.data?.season ?? current;
  return (
    <div>
      <PageHeader title="Compare" description="Up to four teams side by side.">
        <div className="flex flex-wrap items-end gap-3">
          <SeasonToggle value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />
          <div className="flex flex-wrap items-center gap-2">
            {teams.map((t, i) => (
              <span key={t} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card pl-3 pr-1 font-mono text-sm">
                <span className="size-2 rounded-full" style={{ background: COLORS[i] }} />{t}
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${t}`} onClick={() => setTeams(teams.filter((x) => x !== t))}><X /></Button>
              </span>
            ))}
            {teams.length < 4 && (
              <form onSubmit={(e) => { e.preventDefault(); add(); }} noValidate className="flex items-start gap-2">
                <div className={error ? "w-56" : "w-32"}><TeamInput label="Add a team" value={draft} onChange={(v) => { setDraft(v); setError(null); }} error={error} inputRef={input} /></div>
                <Button type="submit" variant="secondary" className="h-11" disabled={!draft || checking}><Plus /> Add</Button>
              </form>
            )}
          </div>
        </div>
      </PageHeader>
      {!teams.length ? <EmptyState icon={Scale} title="Add teams to compare" description="Type a team number above. Tip: every team page has a Compare button." /> : (
        <Async state={state}>{(d) => <Compare d={d} />}</Async>
      )}
    </div>
  );
}

function Compare({ d }: { d: CompareView }) {
  const t = d.teams;
  const phase = (["auto", "teleop", "endgame"] as const).map((k) => ({ phase: k === "auto" ? "Auto" : k === "teleop" ? "TeleOp" : "Endgame", ...Object.fromEntries(t.map((x) => [String(x.team.number), x.stats?.opr[k].value ?? 0])) }));
  const config = Object.fromEntries(t.map((x, i) => [String(x.team.number), { label: String(x.team.number), color: COLORS[i] }]));
  const maxEvents = Math.max(0, ...t.map((x) => x.events.length));
  const trend = Array.from({ length: maxEvents }, (_, i) => ({ i: `E${i + 1}`, ...Object.fromEntries(t.map((x) => [String(x.team.number), x.events[i]?.opr ?? null])) }));
  // 2019–2022 are history only: their predict routes 404, so no "Predict" button.
  const predictable = usePredictable(d.season);
  const lab = t.length === 4 && predictable ? `/predict?mode=match&season=${d.season}&red=${t[0].team.number},${t[1].team.number}&blue=${t[2].team.number},${t[3].team.number}` : null;
  return (
    <div>
      {/* One card per row on phones, two on tablets, all side by side from lg (a four-way row is too narrow below that). */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ "--n": Math.min(t.length, 4) } as CSSProperties}>
        {t.map((x, i) => (
          <div key={x.team.number} className="min-w-0 rounded-xl border border-border bg-card p-4" style={{ borderTopColor: COLORS[i], borderTopWidth: 3 }}>
            <Link to={`/teams/${x.team.number}?season=${d.season}`} className="hover:underline"><p className="font-display text-2xl font-semibold">{x.team.number}</p><p className="truncate text-sm text-muted-foreground">{x.team.name ?? "—"}</p></Link>
            {!x.stats ? <p className="mt-3 text-sm text-muted-foreground">No results this season.</p> : (
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="OPR" v={num(x.stats.opr.np.value)} s={rankPct(x.stats.opr.np.rank, x.stats.opr.np.of)} />
                <Row k="Rating" v={x.stats.rating ? `${num(x.stats.rating.np)} ±${num(x.stats.rating.sd, 0)}` : "—"} s={x.stats.rating?.rank ? `#${x.stats.rating.rank}` : null} />
                <Row k="Record" v={`${x.stats.record.wins}-${x.stats.record.losses}-${x.stats.record.ties}`} s={`${x.stats.record.events} events`} />
                <Row k="Avg score" v={num(x.stats.avg.score)} s={null} />
                <Row k="Pen. given" v={num(x.stats.opr.pen)} s="per match" />
              </dl>
            )}
          </div>
        ))}
      </div>
      {/* Workspace members only: their workspace's scouting on these teams. */}
      {predictable && <CompareConsensus teams={t.map((x) => x.team.number)} season={d.season} colors={COLORS} />}
      {lab && <Button asChild variant="secondary" className="mb-8"><Link to={lab}><Sparkles /> Predict {t[0].team.number}+{t[1].team.number} vs {t[2].team.number}+{t[3].team.number}</Link></Button>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="OPR by phase" description="Best event OPR this season">
          <ChartContainer config={config} className="h-64 w-full rounded-xl border border-border bg-card p-3">
            <BarChart data={phase} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="phase" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Legend />
              {t.map((x) => <Bar key={x.team.number} dataKey={String(x.team.number)} fill={`var(--color-${x.team.number})`} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          </ChartContainer>
        </Section>
        <Section title="OPR event by event" description="Each team's events in order (E1 = its first)">
          {maxEvents < 2 ? <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Needs two events to draw a line.</p> : (
            <ChartContainer config={config} className="h-64 w-full rounded-xl border border-border bg-card p-3">
              <LineChart data={trend} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="i" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                {t.map((x) => <Line key={x.team.number} dataKey={String(x.team.number)} stroke={`var(--color-${x.team.number})`} strokeWidth={2} connectNulls dot={{ r: 3 }} />)}
              </LineChart>
            </ChartContainer>
          )}
        </Section>
      </div>
      {t.length > 1 && (
        <Section title={`Head to head (${d.meetings.length})`} description={`Matches where ${t[0].team.number} played with or against the others this season`}>
          <MatchList matches={d.meetings} highlight={t[0].team.number} empty="They haven't met this season." />
        </Section>
      )}
    </div>
  );
}

function Row({ k, v, s }: { k: string; v: string; s: string | null }) {
  return <div className="flex items-baseline justify-between gap-2"><dt className="shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 text-right font-medium tabular-nums">{v}{s && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{s}</span>}</dd></div>;
}
