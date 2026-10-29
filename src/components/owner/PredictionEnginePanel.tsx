// The owner console's Predictions & ledger, top half: the engine in production (the champion), live calls
// against the replay for each season (never blended), each engine version's own live calls, the shadow model
// scored on the same live calls, and the simulation settings. All read-only: the console never changes the
// engine, its weights or its calibration, and never promotes a shadow model.
// Also the calibration-by-tier block the ledger below uses (TierCalibrationList).
import { Cpu, Crown, Dices, FlaskConical, History, Radio, ShieldCheck } from "lucide-react";
import { Section, EmptyState } from "../page";
import { StatTile, Meter } from "../StatTile";
import { Async } from "../states";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { cn } from "../cn";
import { useApi } from "../../lib/api";
import { ago, int, pct, seasonLabel } from "../../lib/format";
import { TIER_WORD } from "../../shared/tierWords";
import type { OwnerLedgerScore, OwnerPredictionEngine, TierCalibration } from "../../shared/ownerPredictions";

export const ENGINE_PATH = "/api/owner/predictions/engine";

function Score({ s, tone }: { s: OwnerLedgerScore | null; tone: "live" | "replay" }) {
  if (!s) return <p className="text-sm text-muted-foreground">{tone === "live" ? "No live calls scored this season yet." : "No replay for this season on this server yet."}</p>;
  const skill = s.baselineBrier > 0 ? 1 - s.brier / s.baselineBrier : 0;
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-xs text-muted-foreground">Calls</dt><dd className="font-semibold tabular-nums text-foreground">{int(s.n)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Called right</dt><dd className={cn("font-semibold tabular-nums", tone === "live" ? "text-success" : "text-info")}>{pct(s.accuracy, 1)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Brier</dt><dd className="font-semibold tabular-nums text-foreground">{s.brier.toFixed(3)} <span className="text-xs font-normal text-muted-foreground">({skill >= 0 ? "+" : ""}{pct(skill, 0)} on 50%)</span></dd></div>
    </dl>
  );
}

function SeasonCard({ s }: { s: OwnerPredictionEngine["seasons"][number] }) {
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card p-4">
      <h3 className="font-medium text-foreground">{s.label}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-success/30 bg-success/[0.05] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-success"><Radio className="size-3.5" aria-hidden /> Live, logged before each match</p>
          <Score s={s.live} tone="live" />
        </div>
        <div className="rounded-lg border border-info/30 bg-info/[0.05] p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-info"><History className="size-3.5" aria-hidden /> Replay, each match from the data before it</p>
          <Score s={s.replay} tone="replay" />
        </div>
      </div>
      {s.liveByEngine.length > 1 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Live calls by the engine version that made them</p>
          <Table>
            <TableHeader><TableRow><TableHead>Engine</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Right</TableHead><TableHead className="text-right">Brier</TableHead></TableRow></TableHeader>
            <TableBody>
              {s.liveByEngine.map((e) => (
                <TableRow key={e.engine}>
                  <TableCell className="font-mono text-xs">v{e.engine}</TableCell>
                  <TableCell className="text-right tabular-nums">{int(e.n)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(e.accuracy, 1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.brier.toFixed(3)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {s.shadow.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            Served model against the shadow model, on the same live calls <Badge variant="info">Read-only</Badge>
          </p>
          <ul className="grid gap-2">
            {s.shadow.map((x) => {
              const better = x.shadow.brier < x.served.brier;
              return (
                <li key={`${x.servedModel}|${x.shadowModel}`} className="rounded-lg border border-border/70 p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="success"><Crown aria-hidden /> {x.servedModel}</Badge>
                    <span className="text-muted-foreground">vs</span>
                    <Badge variant="secondary"><FlaskConical aria-hidden /> {x.shadowModel}</Badge>
                    <span className="text-muted-foreground">· {int(x.n)} calls</span>
                  </p>
                  <p className="mt-1.5 text-muted-foreground">
                    Brier <span className="tabular-nums text-foreground">{x.served.brier.toFixed(3)}</span> served, <span className="tabular-nums text-foreground">{x.shadow.brier.toFixed(3)}</span> shadow
                    {" · "}right <span className="tabular-nums text-foreground">{pct(x.served.accuracy, 1)}</span> against <span className="tabular-nums text-foreground">{pct(x.shadow.accuracy, 1)}</span>.
                    {better ? " The shadow model scores better here; changing the served model is an engine release, never a switch in this console." : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

export function PredictionEnginePanel() {
  const state = useApi<OwnerPredictionEngine>(ENGINE_PATH);
  return (
    <Async state={state}>
      {(e) => (
        <>
          <Section title="Engine in production" description="The champion is the only engine that serves predictions. Everything here is read-only: the engine, its weights and its calibration change only through an engine release.">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile tone="accent" icon={Crown} label="Champion" value={<span className="font-mono">v{e.engineVersion}</span>} hint="The engine this server runs" />
              <StatTile tone="emerald" icon={Cpu} label="Served model" value={<span className="break-all font-mono text-base">{e.servedModel ?? "—"}</span>} hint={e.lastLiveCall ? `Newest live call ${ago(e.lastLiveCall)}` : "No live call logged yet"} />
              <StatTile tone="violet" icon={FlaskConical} label="Shadow model" value={<span className="break-all font-mono text-base">{e.shadowModel ?? "None"}</span>} hint="Scored beside each live call, never shown" />
              <StatTile tone="sky" icon={ShieldCheck} label="Public headline" value={e.headline ? pct(e.headline.accuracy, 1) : "—"}
                hint={e.headline ? `${e.headline.kind === "live" ? "Live" : "Replay"}, ${seasonLabel(e.headline.season)}, ${int(e.headline.n)} calls` : `Waiting for ${int(e.liveThreshold)} calls`} />
            </div>
          </Section>
          <Section title="Live against replay" description="Live calls were logged before each match; the replay predicts each match from the data before it. They're never added together.">
            {e.seasons.length
              ? <ul className="grid gap-3">{e.seasons.map((s) => <SeasonCard key={s.season} s={s} />)}</ul>
              : <EmptyState icon={History} title="No scored calls yet" description="Live calls show once matches are played; the replay once the stats job has run." />}
          </Section>
          <Section title="Simulation settings" description="The number of simulations behind each kind of odds. Values only: they're set in code and ship with a release.">
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {e.simulation.map((x) => (
                <li key={x.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300"><Dices className="size-4" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">{x.label}</p>
                    <p className="font-semibold tabular-nums text-foreground">{int(x.value)} <span className="text-xs font-normal text-muted-foreground">{x.unit}</span></p>
                    <p className="text-xs text-muted-foreground">{x.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </Async>
  );
}

const TIER_TONE: Record<TierCalibration["tier"], { said: string; won: string; chip: string }> = {
  provisional: { said: "bg-warning/70", won: "bg-warning", chip: "bg-warning/15 text-warning" },
  moderate: { said: "bg-info/70", won: "bg-info", chip: "bg-info/15 text-info" },
  confident: { said: "bg-success/70", won: "bg-success", chip: "bg-success/15 text-success" },
};

/** Calibration by the confidence tier each call shows publicly: how sure the favourite was against how often it won. */
export function TierCalibrationList({ tiers }: { tiers: TierCalibration[] }) {
  if (!tiers.length) return <EmptyState icon={ShieldCheck} title="No calls to group yet" description="Each tier shows once it has scored calls." />;
  return (
    <ul className="grid gap-2" aria-label="Calibration by confidence tier">
      {tiers.map((t) => {
        const gap = t.actual - t.predicted;
        const tone = TIER_TONE[t.tier];
        return (
          <li key={t.tier} className="rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="flex items-center gap-2 text-sm">
                <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", tone.chip)}>{TIER_WORD[t.tier]}</span>
                <span className="tabular-nums text-muted-foreground">{int(t.n)} calls · Brier {t.brier.toFixed(3)}</span>
              </p>
              <p className={cn("text-sm tabular-nums", Math.abs(gap) < 0.03 ? "text-success" : "text-warning")}>
                {Math.abs(gap) < 0.005 ? "On the line" : `${gap > 0 ? "Won more" : "Won less"} than said by ${pct(Math.abs(gap), 1)}`}
              </p>
            </div>
            <div className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
              <div className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2"><span>Said</span><Meter parts={[{ pc: t.predicted * 100, cls: tone.said }]} /><span className="text-right tabular-nums text-foreground">{pct(t.predicted, 1)}</span></div>
              <div className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2"><span>Fav. won</span><Meter parts={[{ pc: t.actual * 100, cls: tone.won }]} /><span className="text-right tabular-nums text-foreground">{pct(t.actual, 1)}</span></div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
