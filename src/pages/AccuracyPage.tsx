// Track record: how often predictions came true, and whether the odds mean
// what they say. Live (logged before each match) and backtest (replayed with
// only earlier data) are always separate — never blended.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { BadgeCheck, FlaskConical, History, Radio } from "lucide-react";
import { useApi } from "../lib/api";
import { useTitle } from "../lib/meta";
import type { AccuracyBlock, TrackRecord } from "../shared/api";
import { PageHeader, Section, EmptyState, Stat } from "../components/page";
import { Async } from "../components/states";
import { Badge } from "../components/ui/basic";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { MatchList } from "../components/predict";
import { pct } from "../lib/format";

export default function AccuracyPage() {
  useTitle("Track record");
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  return (
    <div>
      <PageHeader title="Track record" description={<>Every match prediction, scored. <strong className="text-foreground">Live</strong> calls were written down before the match was played and never changed. <strong className="text-foreground">Backtest</strong> replays past seasons in order, predicting each match from only the matches before it. The two are never mixed.</>} />
      <Async state={state}>{(t) => <Record t={t} />}</Async>
    </div>
  );
}

function Record({ t }: { t: TrackRecord }) {
  const withData = t.seasons.filter((s) => s.live || s.backtest);
  const [season, setSeason] = useState(t.headline?.season ?? withData[0]?.season);
  const sel = t.seasons.find((s) => s.season === season);
  const [kind, setKind] = useState<"live" | "backtest">(sel?.live && sel.live.n >= 50 ? "live" : "backtest");
  if (!withData.length) return <EmptyState icon={BadgeCheck} title="No scored predictions yet" description="Predictions are scored as soon as match results arrive." />;
  const block = sel?.[kind] ?? null;
  return (
    <div>
      {t.headline && (
        <div className="mb-8 grid gap-4 rounded-2xl border border-border bg-card p-6 sm:grid-cols-[auto_1fr]">
          <div>
            <p className="font-display text-6xl font-semibold tabular-nums text-accent">{pct(t.headline.accuracy)}</p>
            <p className="mt-1 text-sm text-muted-foreground">of {t.headline.n.toLocaleString()} matches called correctly</p>
          </div>
          <div className="flex flex-col justify-center gap-2 text-sm text-muted-foreground">
            <Badge variant={t.headline.kind === "live" ? "success" : "secondary"} className="w-fit">{t.headline.kind === "live" ? <><Radio /> Live record</> : <><History /> Backtest</>}</Badge>
            <p>{t.headline.kind === "live" ? "Called before each match was played." : `This season's live record takes over the headline once it has ${t.liveThreshold} scored pre-match calls. Until then the headline is the latest backtest, labelled as one.`}</p>
          </div>
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" value={String(season)} onValueChange={(v) => { if (v) { setSeason(Number(v)); const s = t.seasons.find((x) => x.season === Number(v)); setKind(s?.live && s.live.n >= 50 ? "live" : "backtest"); } }} aria-label="Season">
          {withData.map((s) => <ToggleGroupItem key={s.season} value={String(s.season)}>{s.label.split(" ")[0]}</ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup type="single" value={kind} onValueChange={(v) => { if (v) setKind(v as typeof kind); }} aria-label="Record type">
          <ToggleGroupItem value="live" disabled={!sel?.live}><Radio className="size-3.5" /> Live{sel?.live ? ` (${sel.live.n})` : ""}</ToggleGroupItem>
          <ToggleGroupItem value="backtest" disabled={!sel?.backtest}><FlaskConical className="size-3.5" /> Backtest{sel?.backtest ? ` (${sel.backtest.n.toLocaleString()})` : ""}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!block ? <EmptyState icon={kind === "live" ? Radio : FlaskConical} title={kind === "live" ? `No live calls scored for ${sel?.label} yet` : "No backtest for this season"} description={kind === "live" ? "Live calls are logged for every scheduled match before it's played; they appear here once results arrive." : "Backtests cover seasons with complete match data."} /> : <Block b={block} label={`${sel!.label} · ${kind === "live" ? "live" : "backtest"}`} />}
      {t.recentCalls.length > 0 && (
        <Section title="Latest live calls" description="The most recent matches predicted before they were played.">
          <MatchList matches={t.recentCalls} />
        </Section>
      )}
      <p className="mt-6 text-xs text-muted-foreground">Engine v{t.engineVersion} · <Link to="/methodology" className="underline">How predictions and scoring work</Link></p>
    </div>
  );
}

function Block({ b, label }: { b: AccuracyBlock; label: string }) {
  const skill = 1 - b.brier / b.baselineBrier;
  const rel = b.reliability.filter((r) => r.n > 0).map((r) => ({ x: Math.round(r.predicted * 1000) / 10, y: Math.round(r.actual * 1000) / 10, n: r.n }));
  const tiers = (["provisional", "moderate", "confident"] as const).map((k) => ({ tier: k, accuracy: Math.round(b.byTier[k].accuracy * 1000) / 10, n: b.byTier[k].n })).filter((x) => x.n);
  return (
    <div>
      <div className="mb-8 grid grid-cols-2 gap-6 rounded-2xl border border-border p-6 lg:grid-cols-4">
        <Stat label="Called correctly" value={pct(b.accuracy, 1)} hint={`${b.n.toLocaleString()} matches · ${b.upsets.toLocaleString()} upsets`} />
        <Stat label="Brier score" value={b.brier.toFixed(3)} hint={`lower is better · coin flip ${b.baselineBrier.toFixed(3)}`} />
        <Stat label="Skill vs coin flip" value={pct(skill)} hint="Brier improvement over always saying 50%" tone={skill > 0 ? "good" : "bad"} />
        <Stat label="Log loss" value={b.logLoss.toFixed(3)} hint={`quals ${pct(b.byLevel.qual.accuracy)} · playoffs ${pct(b.byLevel.playoff.accuracy)}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Calibration" description="Each dot: matches where the favourite was given about this chance (x) vs how often it actually won (y). On the dashed line = the odds mean what they say.">
          <ChartContainer config={{ y: { label: "Actually won %", color: "var(--color-chart-1)" } }} className="h-72 w-full rounded-xl border border-border bg-card p-3">
            <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" domain={[0, 100]} tickLine={false} axisLine={false} unit="%" name="Predicted" />
              <YAxis type="number" dataKey="y" domain={[0, 100]} tickLine={false} axisLine={false} unit="%" width={40} name="Actual" />
              <ZAxis type="number" dataKey="n" range={[40, 260]} name="Matches" />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} strokeDasharray="4 4" stroke="var(--color-muted-foreground)" />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Scatter data={rel} fill="var(--color-y)" />
            </ScatterChart>
          </ChartContainer>
          <table className="mt-3 w-full text-xs text-muted-foreground">
            <thead><tr><th className="text-left font-medium">Predicted</th><th className="text-right font-medium">Actually won</th><th className="text-right font-medium">Matches</th></tr></thead>
            <tbody>{b.reliability.filter((r) => r.n).map((r) => <tr key={r.lo}><td>{pct(r.predicted)}</td><td className="text-right tabular-nums">{pct(r.actual)}</td><td className="text-right tabular-nums">{r.n.toLocaleString()}</td></tr>)}</tbody>
          </table>
        </Section>
        <div>
          <Section title="By confidence tier" description="If the tiers mean anything, confident calls should be right more often than provisional ones.">
            <ChartContainer config={{ accuracy: { label: "Called correctly %", color: "var(--color-chart-1)" } }} className="h-44 w-full rounded-xl border border-border bg-card p-3">
              <BarChart data={tiers} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="tier" tickLine={false} axisLine={false} />
                <YAxis domain={[50, 100]} tickLine={false} axisLine={false} width={48} unit="%" />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Bar dataKey="accuracy" fill="var(--color-accuracy)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <p className="mt-2 text-xs text-muted-foreground">{tiers.map((x) => `${x.tier}: ${x.n.toLocaleString()} matches`).join(" · ")}</p>
          </Section>
          <Section title="Week by week" description={label}>
            <ChartContainer config={{ accuracy: { label: "Called %", color: "var(--color-chart-2)" } }} className="h-44 w-full rounded-xl border border-border bg-card p-3">
              <LineChart data={b.weekly.filter((w) => w.n >= 20).map((w) => ({ week: w.week.slice(5), accuracy: Math.round(w.accuracy * 1000) / 10, n: w.n }))} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis domain={[50, 100]} tickLine={false} axisLine={false} width={48} unit="%" />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Line dataKey="accuracy" stroke="var(--color-accuracy)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
            <p className="mt-2 text-xs text-muted-foreground">Weeks with at least 20 matches. Early-season weeks are harder: ratings lean on last season.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
