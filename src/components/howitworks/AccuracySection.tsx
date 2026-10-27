// Section 05: how good is it? This is also the track record (/predict/accuracy
// redirects here). Two clearly separated sources:
//  - Control Scout's own ledger (GET /api/predict/accuracy): live and backtest
//    blocks per season, never blended; shown with loading / empty / error states.
//  - The prediction engine's published held-out test (tuned on 2024–25, tested
//    on 2025–26), shipped with @control-scout/predict-engine (FITTED_MODEL.accuracy)
//    or, where the model file doesn't carry it, Control Point's write-up of the
//    same test. Every figure says which one it is.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, History, Hourglass, Radio } from "lucide-react";
import { BONUS_CONFIDENCE_RULE, BONUS_MIN_SAMPLES, BONUS_WINDOW, CONFIDENCE_RULE } from "@control-scout/predict-engine";
import { useApi } from "../../lib/api";
import { useCurrentSeason } from "../../lib/meta";
import type { AccuracyBlock, BonusAccuracy, ReplayCoverage, TrackRecord } from "../../shared/api";
import { brierSkill, headlineRule, LEDGER_MODE, ledgerDefault, type LedgerKind } from "../../shared/ledger";
import { pct } from "../../lib/format";
import { cn } from "../cn";
import { Badge } from "../ui/basic";
import { MatchList } from "../predict";
import { ErrorState, Skeleton } from "../states";
import { EmptyState } from "../page";
import { HBars } from "./charts";
import { Legend } from "./MatchFigures";
import { MODEL } from "./math";
import { Chart, CountUp, Figure, Prose, Reveal, ScrollX, Seg, SectionHead, useTip } from "./ui";
import { TIER_WORD, tierWord } from "../../shared/tierWords";
import type { ConfidenceTier } from "../../shared/api";

interface EngineAccuracy {
  testSeason: string;
  matches: { count: number; liveAccuracy: number; liveBrier: number; preEventAccuracy: number; oprAccuracy: number; oprBrier: number; scoreRange80Coverage: number };
  advancement: {
    events: number;
    pre: { brier: number }; quals: { brier: number }; selected: { brier: number }; naiveTopRanked: { brier: number };
    calibrationPre: { predicted: number; actual: number; n: number }[];
  };
}
const ENG = MODEL.accuracy as EngineAccuracy;

/** The label every engine-test figure carries. */
export const ENGINE_TEST = "the prediction engine's held-out test (tuned on 2024–25, tested on 2025–26)";

function EngineTag() {
  return <Badge variant="secondary" className="w-fit"><FlaskConical /> Engine held-out test · tuned 2024–25, tested 2025–26</Badge>;
}

type Kind = LedgerKind;
/** Below this many decided matches, the season under way is still early: the ledger says its figures are moving. */
export const EARLY_DECIDED = 3000;
interface Sel { season: number; kind: Kind }

export function AccuracySection() {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  const t = state.data;
  const withData = t?.seasons.filter((s) => s.live || s.backtest) ?? [];
  // The same opening rule as the home page's track record (src/shared/ledger.ts).
  const fallback: Sel | null = t ? ledgerDefault(t) : null;
  const [picked, setPicked] = useState<Sel | null>(null);
  const sel = picked ?? fallback;
  const season = t?.seasons.find((s) => s.season === sel?.season);
  const block = sel && season ? season[sel.kind] : null;
  const desc = sel && season ? `${season.label} · ${sel.kind === "live" ? "logged live" : "season replay"}` : "";
  const isHeadline = !!sel && t?.headline?.kind === sel.kind && t.headline.season === sel.season;
  const current = useCurrentSeason();
  // The season under way, early on: its figures rest on few matches and are still moving. Last season's final
  // figure of the same kind says where a full season ended up.
  // Early by the whole season's matches (the replay covers every played match; live calls only some), not by
  // the selected record's sample.
  const seasonMatches = season ? Math.max(season.replay?.scored ?? 0, season.backtest?.decided ?? 0, season.live?.decided ?? 0) : 0;
  const early = !!sel && !!block && sel.season === current && seasonMatches < EARLY_DECIDED;
  const lastSeason = sel ? t?.seasons.find((s) => s.season === sel.season - 1) : undefined;
  // Last season's figure of the same record type when it has one, else its replay, always named as which.
  const lastKind: Kind | null = sel && lastSeason ? (lastSeason[sel.kind] ? sel.kind : lastSeason.backtest ? "backtest" : null) : null;
  const lastBlock = lastSeason && lastKind ? lastSeason[lastKind] : null;

  const pickSeason = (v: string) => {
    const s = t?.seasons.find((x) => x.season === Number(v));
    if (!s) return;
    const kind: Kind = sel?.kind === "live" && s.live ? "live" : s.backtest ? "backtest" : "live";
    setPicked({ season: s.season, kind });
  };
  const selectors = t && sel && withData.length > 0 ? (
    <div className="flex flex-wrap items-center gap-2">
      <Seg label="Season" value={String(sel.season)} onChange={pickSeason} options={withData.map((s) => ({ value: String(s.season), label: s.label.split(" ")[0] }))} />
      <Seg label="Record type" value={sel.kind} onChange={(k) => setPicked({ season: sel.season, kind: k })}
        options={[
          { value: "live", label: <ModeTab icon={<Radio className="size-3" />} label={LEDGER_MODE.live.tab} n={season?.live?.n} />, disabled: !season?.live },
          { value: "backtest", label: <ModeTab icon={<History className="size-3" />} label={LEDGER_MODE.backtest.tab} n={season?.backtest?.n} />, disabled: !season?.backtest },
        ]} />
    </div>
  ) : null;

  const apiState = (node: (b: AccuracyBlock) => ReactNode, skeleton: ReactNode) =>
    state.error ? <ErrorState error={state.error} onRetry={state.reload} />
      : !t ? skeleton
        : !block ? <EmptyState icon={Radio} title={withData.length ? (sel?.kind === "live" ? "No live calls scored for this season yet" : "No replayed matches for this season yet") : "No scored predictions yet"} description="Predictions are scored as soon as match results arrive. Live calls are logged before each match; the season replay predicts each played match again using only earlier matches." />
          : node(block);

  return (
    <section id="accuracy" className="scroll-mt-bar-20 pt-20">
      <SectionHead num="05" eyebrow="The scoreboard" title="How good is it, really?" />
      <Prose>
        <p>A prediction model can look brilliant on the data it learned from. So every engine setting was tuned on the <strong>2024–25</strong> season, then locked, and tested on <strong>2025–26</strong>, a season it had never seen. Every prediction was made using only matches that had already happened at that moment, exactly as it would be live.</p>
        <p>There are two scoreboards on this page, and they're never mixed. <strong>Control Scout's own ledger</strong> scores this site's predictions two ways, never mixed: <em>live</em> calls written down before each match, and a <em>season replay</em> (a backtest) that predicts every played match again in order, using only the matches before it. <strong>The engine's held-out test</strong> is the published result of tuning and testing the shared engine, the same numbers Control Point reports.</p>
      </Prose>

      {/* Control Scout's ledger */}
      <Reveal className="mx-auto my-8 max-w-5xl">
        <div id="ledger" className="scroll-mt-bar-24 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="hiw-gold-text text-[11px] font-bold uppercase tracking-[0.14em]">Control Scout's ledger</p>
              <p className="mt-0.5 font-display text-base font-semibold text-foreground sm:text-lg">{sel ? LEDGER_MODE[sel.kind].title : "Every scored prediction"}{season && <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">· {season.label}</span>}</p>
              {sel && block && <Badge variant={sel.kind === "live" ? "success" : "secondary"} className="mt-2 w-fit">{sel.kind === "live" ? <><Radio /> Logged live · {block.n < t!.liveThreshold ? "still calibrating" : "called before each match"}</> : <><History /> Season replay · not calls made in advance</>}{isHeadline && " · the headline"}</Badge>}
            </div>
            {selectors}
          </div>
          {early && block && (
            <p role="note" className="mb-3 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/[0.07] px-3 py-2.5 text-sm text-text-base/90">
              <Hourglass className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
              <span>
                <strong>Early season: a work in progress.</strong> Only {seasonMatches.toLocaleString("en-US")} matches scored this season so far, and most robots have played few this season, so many calls lean on last season's ratings. These numbers move as results arrive, and accuracy usually climbs as the season fills in
                {lastBlock && lastSeason && lastKind && lastBlock.decided > 0 ? <>: {lastSeason.label.split(" ")[0]}'s {lastKind === "live" ? "live calls" : "season replay"} ended at <strong>{pct(lastBlock.accuracy, 1)}</strong> over {lastBlock.decided.toLocaleString("en-US")} decided matches.</> : "."}
              </span>
            </p>
          )}
          {apiState((b) => (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4" role="list">
              <StatCell tone="gold" value={b.decided > 0 ? <CountUp value={b.accuracy * 100} decimals={1} suffix="%" /> : "—"}
                label={b.decided > 0 ? `of ${b.decided.toLocaleString("en-US")} decided matches called right (${LEDGER_MODE[sel?.kind ?? "backtest"].detail})` : "no decided match yet: every scored call was a tie or a 50:50 call"} />
              <StatCell tone="blue" value={<CountUp value={b.brier} decimals={3} />} label={`Brier score (lower is better; a coin flip scores ${b.baselineBrier.toFixed(3)})`} />
              <SkillCell block={b} />
              <StatCell value={<CountUp value={b.n} />} label={`${sel?.kind === "live" ? "live calls scored" : "matches replayed"} · ${(b.decided - b.upsets).toLocaleString("en-US")} right, ${b.upsets.toLocaleString("en-US")} missed`} />
              <p role="listitem" className="col-span-full bg-card px-4 py-2.5 font-mono text-xs text-muted-foreground">
                Log loss {b.logLoss.toFixed(3)} (lower is better; a coin flip scores 0.693) · qualifiers {b.byLevel.qual.n ? `${pct(b.byLevel.qual.accuracy, 1)} right (${b.byLevel.qual.n.toLocaleString("en-US")})` : "none scored"} · playoffs {b.byLevel.playoff.n ? `${pct(b.byLevel.playoff.accuracy, 1)} right (${b.byLevel.playoff.n.toLocaleString("en-US")})` : "none scored"}
              </p>
              {sel?.kind === "backtest" && season?.replay && <CoverageLine c={season.replay} />}
              {sel?.kind === "live" && (season?.liveByEngine?.length ?? 0) > 1 && (
                // Each engine version's own pre-match calls, so a new version is never judged on an old one's record.
                <p role="listitem" className="col-span-full bg-card px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  By engine version: {season!.liveByEngine!.map((e) => `v${e.engine} ${pct(e.accuracy, 1)} right, Brier ${e.brier.toFixed(3)} (${e.n.toLocaleString("en-US")})`).join(" · ")}
                </p>
              )}
            </div>
          ),<div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Loading the track record">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>)}
          <p className="mt-3 text-sm text-muted-foreground">Live calls and the season replay are reported separately and never blended.{t && ` ${headlineRule(t)}`}</p>
        </div>
      </Reveal>

      {/* Engine test headline */}
      <Reveal className="mx-auto my-8 max-w-5xl">
        <div className="mb-2.5"><EngineTag /></div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4" role="list" aria-label={`Headline numbers from ${ENGINE_TEST}`}>
          <StatCell tone="gold" value={<CountUp value={ENG.matches.liveAccuracy * 100} decimals={1} suffix="%" />} label="of matches called right with live ratings" />
          <StatCell tone="good" value={<CountUp value={ENG.matches.scoreRange80Coverage * 100} decimals={0} suffix="%" />} label="of real scores inside the 80% range (honest ranges)" />
          <StatCell tone="blue" value={<CountUp value={ENG.advancement.selected.brier} decimals={3} />} label="advancement Brier after alliance selection (lower is better)" />
          <StatCell value={<CountUp value={ENG.matches.count} />} label={`test matches · ${ENG.advancement.events} advancing events`} />
        </div>
      </Reveal>

      <Prose>
        <p>Accuracy isn't the whole story. The <strong>Brier score</strong> measures how close the probabilities were: 0 is perfect, and a coin flip gets 0.25. It rewards saying 90% when you're sure and 55% when you're not.</p>
      </Prose>

      <Figure narrow label="Figure 8 · engine test" title="Match predictions vs. simple baselines (2025–26, Brier, lower is better)"
        caption={<>From {ENGINE_TEST}. OPR from a team's last event is what many teams use today. Live ratings beat it by a wide margin. The season-average baseline is surprisingly strong, but it's only available once a team has played this season, and it has no notion of uncertainty, partners or awards.</>}>
        <ScrollX label="Brier comparison chart">
          <HBars
            label={`Bar chart of Brier scores: coin flip 0.248, last-event OPR ${ENG.matches.oprBrier.toFixed(3)}, rating frozen at event start 0.199, season-average score 0.188, live rating ${ENG.matches.liveBrier.toFixed(3)}.`}
            max={0.26} fmt={(v) => v.toFixed(3)} ticks={[0, 0.05, 0.1, 0.15, 0.2, 0.25]} left={170}
            rows={[
              { label: "Coin flip", v: 0.248, tone: "muted", dim: true },
              { label: "Last-event OPR", v: ENG.matches.oprBrier, tone: "muted" },
              { label: "Rating, event start", v: 0.199, tone: "gold", dim: true },
              { label: "Season-average score", v: 0.188, tone: "muted" },
              { label: "Rating, live", v: ENG.matches.liveBrier, tone: "gold", strong: true },
            ]}
          />
        </ScrollX>
      </Figure>

      <ExpChart />
      <Calibration block={block} desc={desc} loading={!t && !state.error} error={!!state.error} />
      {block && <WeekChart block={block} desc={desc} />}
      <StageChart />

      <Prose id="confidence" className="mt-12">
        <h3>Confidence tiers</h3>
        <p>Every prediction carries a tier. These thresholds are a <strong>stated rule, not a fitted value</strong>:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Rough guess:</strong> at least one robot has fewer than {CONFIDENCE_RULE.provisionalBelow} matches this season, so its rating is mostly last season's.</li>
          <li><strong>Solid:</strong> every robot has at least {CONFIDENCE_RULE.confidentMinMatches} matches, and rating uncertainty is under {Math.round(CONFIDENCE_RULE.confidentMaxRatingShare * 100)}% of the total uncertainty.</li>
          <li><strong>Fair:</strong> everything in between.</li>
        </ul>
        <p>If the tiers mean anything, solid calls should be right more often than rough guesses. Here's how they've done in Control Scout's ledger{desc ? ` (${desc})` : ""}:</p>
      </Prose>
      <Reveal className="mx-auto mt-4 max-w-2xl">
        {apiState((b) => <Tiers block={b} />, <Skeleton className="h-32 rounded-xl" />)}
      </Reveal>

      <Prose id="bonus" className="mt-12 scroll-mt-bar-20">
        <h3>Bonus ranking points</h3>
        <p>Next to the win odds of a qualification match, each alliance gets its chance of earning each of the season's bonus ranking points. It's the same math the event simulator uses: an alliance's chance at a bonus rises with its non-penalty score, and the engine averages that over the whole spread of scores the alliance could put up (game noise plus how well its robots are known). <strong>Expected RP</strong> is 3 for a win and 1 for a tie, weighted by their chances, plus the bonus chances. A tie's chance comes from how close the match is expected to be: about 1–1.5% in an even match, less in a lopsided one. The win chance shown counts a tie as half a win.</p>
        <p>How much score a bonus takes drifts during a season, so the chance curve is fitted to the season's latest {BONUS_WINDOW.toLocaleString("en-US")} recorded qualification alliances, once there are at least {BONUS_MIN_SAMPLES}. The tier stays a rough guess below {BONUS_CONFIDENCE_RULE.provisionalBelow.toLocaleString("en-US")} alliances and at most fair below {BONUS_CONFIDENCE_RULE.confidentMin.toLocaleString("en-US")}. Bonus calls are logged and scored like win calls, one call per alliance per bonus. The season replay fits the curve only on results from before each match.</p>
      </Prose>
      <Reveal className="mx-auto mt-4 max-w-3xl">
        {t && sel && season?.bonus ? <BonusLedger b={season.bonus[sel.kind]} kind={sel.kind} desc={desc} /> : t && sel ? <p className="text-center text-sm text-muted-foreground">No bonus ranking points in {season?.label ?? "this season"}.</p> : <Skeleton className="h-32 rounded-xl" />}
      </Reveal>

      <Prose id="ranges" className="mt-12 scroll-mt-bar-20">
        <h3>Score ranges</h3>
        <p>Every predicted score comes with a range, written <strong>118 ±14</strong>. It's an <strong>80% range</strong>: about 8 in 10 real scores should land inside it. It widens when a robot has played only a few matches this season or its results swing a lot from match to match, and it narrows in playoffs, where scores are steadier. Engine 3.2 refitted how wide they are: after the 2.7–2.11 changes made expected scores sharper, the old ranges held about 85% of real scores. Replayed over 2025–26, the new ones hold 81.4% and are about 10 points narrower. The width was fitted on 2024–25; only the playoff setting was chosen after looking at 2025–26 (to keep playoff ranges as wide as before), so that season isn't a fully independent check.</p>
        <p>The ranges are scored the same way as the win calls. If far more than 80% of scores land inside, the ranges are wider than they need to be; if far fewer do, they're overconfident. Here's how they've done in Control Scout's ledger{desc ? ` (${desc})` : ""}:</p>
      </Prose>
      <Reveal className="mx-auto mt-4 max-w-2xl">
        {apiState((b) => <Ranges block={b} />, <Skeleton className="h-32 rounded-xl" />)}
      </Reveal>

      {t && t.recentCalls.length > 0 && (
        <>
          <Prose id="recent" className="mt-12">
            <h3>Latest live calls</h3>
            <p>The most recent matches Control Scout predicted before they were played, with how each one turned out. Engine v{t.engineVersion}.</p>
          </Prose>
          <Reveal className="mx-auto mt-4 max-w-3xl">
            <MatchList matches={t.recentCalls} newestFirst />
          </Reveal>
        </>
      )}
    </section>
  );
}

/** Bonus RP calls of the selected season and record type (live and replay never blended). */
function BonusLedger({ b, kind, desc }: { b: BonusAccuracy | null; kind: Kind; desc: string }) {
  if (!b) return <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{kind === "live" ? "No live bonus calls scored for this season yet." : "No replayed bonus calls for this season yet."}</p>;
  const skill = b.baseRateBrier > 0 ? 1 - b.brier / b.baseRateBrier : null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="bonus-ledger">
      <div className="grid grid-cols-3 gap-px bg-border" role="list">
        <StatCell tone="blue" value={<CountUp value={b.brier} decimals={3} />} label="Brier per bonus call (lower is better)" />
        <StatCell tone={skill == null ? undefined : skill > 0 ? "good" : "bad"} value={skill == null ? "—" : <CountUp value={skill * 100} decimals={0} suffix="%" />} label={`better than always saying each bonus's rate (Brier ${b.baseRateBrier.toFixed(3)})`} />
        <StatCell value={<CountUp value={b.n} />} label={`bonus calls · ${b.matches.toLocaleString("en-US")} matches`} />
      </div>
      <ul className="divide-y divide-border border-t border-border text-sm">
        {b.bySlot.map((s) => (
          <li key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2">
            <span className="min-w-0">
              <span className="font-medium">{s.label}</span>
              <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><span className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, s.actual * 100)}%` }} /></span>
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">said {pct(s.predicted, 0)} · earned {pct(s.actual, 0)} · Brier {s.brier.toFixed(3)}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{desc} · {kind === "live" ? "logged before each match" : "season replay, not calls made in advance"}</p>
    </div>
  );
}

function ModeTab({ icon, label, n }: { icon: ReactNode; label: string; n: number | undefined }) {
  return <span className="inline-flex items-center gap-1">{icon}{label}{n != null && <span className="font-mono text-[11px] font-normal tabular-nums opacity-75">{n.toLocaleString("en-US")}</span>}</span>;
}

/** Brier skill: the same formula as everywhere else (src/shared/ledger.ts); no number when only ties were scored. */
function SkillCell({ block }: { block: AccuracyBlock }) {
  const skill = brierSkill(block);
  return <StatCell tone={skill == null ? undefined : skill > 0 ? "good" : "bad"} value={skill == null ? "—" : <CountUp value={skill * 100} decimals={0} suffix="%" />} label="skill: Brier improvement over always saying 50%" />;
}

/** How much of the season the replay covers, and why the rest isn't in it. */
export function CoverageLine({ c }: { c: ReplayCoverage }) {
  const n = (x: number) => x.toLocaleString("en-US");
  const skipped = c.scored - c.replayed;
  return (
    <p role="listitem" className="col-span-full bg-card px-4 py-2.5 text-xs text-muted-foreground">
      <b className="font-semibold text-foreground">{n(c.replayed)} of {n(c.scored)} scored matches replayed.</b>
      {skipped > 0 ? <>
        {c.shortHanded > 0 && ` ${n(c.shortHanded)} skipped because an alliance didn't have two robots on the field (a no-show or a one-robot alliance), so there's no 2-on-2 call to replay. Live calls are logged from the schedule beforehand, so they can include these matches.`}
        {(c.eventSkipped ?? 0) > 0 && ` ${n(c.eventSkipped)} were at remote or hybrid events, which the replay leaves out.`}
        {c.other > 0 && ` ${n(c.other)} not replayed yet: scored since the replay was last rebuilt.`}
      </> : " Every scored match is in the replay."}
    </p>
  );
}

type Tone = "gold" | "good" | "bad" | "blue";
// Gold as text uses the text shade (deep amber in light, where the bright fill fails contrast).
const TONE: Record<Tone, string> = { gold: "text-accent-text", good: "text-success", bad: "text-destructive", blue: "text-blue-alliance" };

function StatCell({ value, label, tone }: { value: ReactNode; label: string; tone?: Tone }) {
  return (
    <div role="listitem" className="grid min-w-0 content-start gap-1 bg-card p-4">
      <b className={cn("font-display text-3xl font-bold leading-none tabular-nums sm:text-4xl", tone ? TONE[tone] : "text-foreground")}>{value}</b>
      <span className="text-[0.8125rem] leading-snug text-muted-foreground">{label}</span>
    </div>
  );
}

function Tiers({ block }: { block: AccuracyBlock }) {
  const tip = useTip();
  const rows = (["provisional", "moderate", "confident"] as const).map((k) => ({ k, ...block.byTier[k] })).filter((r) => r.n > 0);
  if (!rows.length) return <p className="text-sm text-muted-foreground">No tiered calls in this block yet.</p>;
  return (
    <div className="grid gap-2 rounded-2xl border border-border bg-card p-4">
      {rows.map((r) => (
        <div key={r.k} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
          <span className="text-foreground">{TIER_WORD[r.k as ConfidenceTier] ?? r.k}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full" role="group" aria-label={`${tierWord(r.k)} bar`}>
            <rect x={0} y={0} width={100} height={10} rx={2} fill="var(--color-muted)" />
            <rect x={0} y={0} width={Math.max(1, r.accuracy * 100)} height={10} rx={2} fill={r.k === "confident" ? "var(--color-accent)" : r.k === "moderate" ? "color-mix(in srgb, var(--color-accent) 60%, transparent)" : "var(--hiw-muted)"}
              {...tip(`${TIER_WORD[r.k as ConfidenceTier] ?? r.k}: ${pct(r.accuracy, 1)} right over ${r.n.toLocaleString("en-US")} matches (Brier ${r.brier.toFixed(3)})`)} />
          </svg>
          <span className="text-right font-mono tabular-nums text-foreground">{pct(r.accuracy, 1)}</span>
        </div>
      ))}
      <p className="font-mono text-xs text-muted-foreground">{rows.map((r) => `${tierWord(r.k)}: ${r.n.toLocaleString("en-US")} matches`).join(" · ")}</p>
    </div>
  );
}

/** Interval coverage: how many real scores landed inside the stated range, overall and by tier. */
function Ranges({ block }: { block: AccuracyBlock }) {
  const g = block.ranges;
  if (!g) return <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No call in this block stated a score range yet. Ranges are logged with every call from engine 2.2 on; earlier calls stated none, and none is added to them afterwards.</p>;
  const target = pct(g.level, 0);
  const off = g.coverage - g.level;
  const verdict = Math.abs(off) <= 0.03 ? "on target" : off > 0 ? "wider than needed" : "overconfident";
  const tiers = (["provisional", "moderate", "confident"] as const).map((k) => ({ k, ...g.byTier[k] })).filter((r) => r.n > 0);
  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-4" data-ranges>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3" role="list">
        <StatCell tone={verdict === "on target" ? "good" : "bad"} value={<CountUp value={g.coverage * 100} decimals={1} suffix="%" />} label={`of real scores inside the stated ${target} range (${verdict})`} />
        <StatCell value={`${pct(g.below, 0)} / ${pct(g.above, 0)}`} label="landed below / above the range" />
        <StatCell value={<CountUp value={g.width} decimals={0} />} label={`average range width in points, over ${g.n.toLocaleString("en-US")} alliance scores`} />
      </div>
      {tiers.length > 0 && <p className="font-mono text-xs text-muted-foreground">By confidence tier (target {target}): {tiers.map((r) => `${tierWord(r.k)} ${pct(r.coverage, 1)} (${r.n.toLocaleString("en-US")})`).join(" · ")}</p>}
    </div>
  );
}

function ExpChart() {
  const tip = useTip();
  const data: [string, number, number, number][] = [["0", 65.1, 57.0, 2867], ["1–3", 70.2, 56.3, 7941], ["4–9", 73.7, 66.3, 11506], ["10+", 74.8, 71.8, 15081]];
  const L = 50, R = 620, T = 14, B = 206, lo = 50, hi = 80;
  const y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
  const gw = (R - L) / data.length, bw = 44;
  return (
    <Figure narrow label="Figure 9 · engine test" title="It learns fast: accuracy by matches already played"
      caption={<>From {ENGINE_TEST}. Grouped by the fewest prior matches among the four robots in the match. Early in a season, carrying last season over (as a z-score) is what keeps the engine well ahead of OPR, which has almost nothing to go on yet.</>}>
      <ScrollX label="Accuracy by experience chart">
        <Chart viewBox="0 0 640 250" interactive label="Grouped bars: with 0 prior matches live accuracy 65%, 1 to 3 matches 70%, 4 to 9 matches 74%, 10 or more 75%. Last-event OPR is 57%, 56%, 66% and 72%.">
          {[50, 55, 60, 65, 70, 75, 80].map((v) => <g key={v}><line x1={L} x2={R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v}%</text></g>)}
          {data.map(([lab, a, o, n], i) => {
            const cx = L + gw * i + gw / 2;
            return (
              <g key={lab}>
                <rect x={cx - bw - 3} y={y(a)} width={bw} height={B - y(a)} rx={3} fill="var(--color-accent)" className="bar-v" style={{ ["--i" as string]: i * 2 }} {...tip(`${lab} prior matches: engine ${a}% (${n.toLocaleString("en-US")} matches)`)} />
                <rect x={cx + 3} y={y(o)} width={bw} height={B - y(o)} rx={3} fill="var(--hiw-muted)" opacity={0.55} className="bar-v" style={{ ["--i" as string]: i * 2 + 1 }} {...tip(`${lab} prior matches: last-event OPR ${o}%`)} />
                <text x={cx - bw / 2 - 3} y={y(a) - 6} textAnchor="middle" className="t-ink fade-late">{a.toFixed(0)}%</text>
                <text x={cx + bw / 2 + 3} y={y(o) - 6} textAnchor="middle" className="fade-late">{o.toFixed(0)}%</text>
                <text x={cx} y={B + 18} textAnchor="middle" className="t-ink">{lab}</text>
              </g>
            );
          })}
          <text x={(L + R) / 2} y={B + 36} textAnchor="middle">prior matches this season (fewest of the four robots) · axis starts at 50%</text>
        </Chart>
      </ScrollX>
      <Legend items={[["var(--color-accent)", "Engine, live ratings"], ["color-mix(in srgb, var(--hiw-muted) 55%, transparent)", "Last-event OPR"]]} />
    </Figure>
  );
}

type CalView = "both" | "match" | "adv";

function Calibration({ block, desc, loading, error }: { block: AccuracyBlock | null; desc: string; loading: boolean; error: boolean }) {
  const tip = useTip();
  const [view, setView] = useState<CalView>("both");
  const L = 60, R = 340, T = 14, B = 280;
  const sz = Math.min(R - L, B - T);
  const x = (p: number) => L + p * sz, y = (p: number) => B - p * sz;
  const bins = block?.reliability.filter((r) => r.n > 0) ?? [];
  const adv = ENG.advancement.calibrationPre;
  const matchNote = error ? "couldn't load this site's ledger" : loading ? "loading this site's ledger…" : !block ? "no scored calls yet" : `${desc}, ${block.n.toLocaleString("en-US")} matches`;
  return (
    <Figure narrow label="Figure 10" title={<>Does "70%" mean 70%? Calibration</>}
      actions={<Seg label="Which predictions" value={view} onChange={setView} options={[{ value: "both", label: "Both" }, { value: "match", label: "Match odds" }, { value: "adv", label: "Advancement" }]} />}
      caption={<>Each dot groups predictions of about the same probability and shows how often that outcome really happened. Dots on the diagonal mean the numbers can be taken at face value. The gold dots are Control Scout's own ledger (switch season and live/backtest above); the blue diamonds are pre-event advancement odds from {ENGINE_TEST}. Hover, tap or focus a dot for its numbers.</>}>
      <ScrollX label="Calibration chart" min={300}>
        <div className="mx-auto max-w-[460px]">
        <Chart viewBox="0 0 350 330" interactive label="Calibration chart: predicted probability on the x axis, how often it actually happened on the y axis. Dots near the diagonal mean honest odds.">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => (
            <g key={p}>
              <line x1={x(p)} x2={x(p)} y1={y(0)} y2={y(1)} className="grid" />
              <line x1={x(0)} x2={x(1)} y1={y(p)} y2={y(p)} className="grid" />
              <text x={x(p)} y={B + 16} textAnchor="middle">{Math.round(p * 100)}%</text>
              <text x={L - 8} y={y(p) + 4} textAnchor="end">{Math.round(p * 100)}%</text>
            </g>
          ))}
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--hiw-line)" strokeWidth={3} />
          <text x={x(0.5)} y={B + 34} textAnchor="middle">predicted</text>
          <text x={16} y={y(0.5)} textAnchor="middle" transform={`rotate(-90 16 ${y(0.5)})`}>actually happened</text>
          <text x={x(0.04)} y={y(0.93)} className="t-ink">on the line = honest odds</text>
          <g className="fade" opacity={view === "match" ? 0.08 : 1}>
            {adv.map((a, i) => (
              <g key={i} className="pop" style={{ ["--i" as string]: i + 10 }}>
                <rect x={x(a.predicted) - 6} y={y(a.actual) - 6} width={12} height={12} fill="var(--hiw-blue)" transform={`rotate(45 ${x(a.predicted)} ${y(a.actual)})`}
                  {...tip(`Advancement (engine test): predicted ${Math.round(a.predicted * 100)}% → happened ${Math.round(a.actual * 100)}% (${a.n.toLocaleString("en-US")} team-events)`)} />
              </g>
            ))}
          </g>
          <g className="fade" opacity={view === "adv" ? 0.08 : 1}>
            {bins.map((b, i) => (
              <circle key={b.lo} cx={x(b.predicted)} cy={y(b.actual)} r={7} fill="var(--color-accent)" stroke="var(--color-card)" strokeWidth={1.5} className="pop" style={{ ["--i" as string]: i }}
                {...tip(`Match odds (${desc}): predicted ${(b.predicted * 100).toFixed(1)}% → red won ${(b.actual * 100).toFixed(1)}% (${b.n.toLocaleString("en-US")} matches)`)} />
            ))}
          </g>
        </Chart>
        </div>
      </ScrollX>
      <Legend items={[["var(--color-accent)", `Match win odds · Control Scout ledger (${matchNote})`], ["var(--hiw-blue)", "Advancement odds before the event · engine test"], ["var(--hiw-line)", "Perfect calibration"]]} />
      {error && <p className={cn("mt-2 text-sm text-muted-foreground")}>The match dots need this site's track record, which couldn't be loaded. The advancement diamonds come with the engine and still show.</p>}
    </Figure>
  );
}

/** Accuracy per week for the selected ledger block (weeks with at least 20 scored matches). */
function WeekChart({ block, desc }: { block: AccuracyBlock; desc: string }) {
  const tip = useTip();
  const weeks = block.weekly.filter((w) => w.n >= 20);
  if (weeks.length < 2) return null;
  // Axis from 50% (chance), extended down in 10-point steps if a week did worse, so poor weeks are never flattened.
  const lo = Math.min(50, Math.floor(Math.min(...weeks.map((w) => w.accuracy * 100)) / 10) * 10), hi = 100;
  const L = 50, R = 620, T = 14, B = 206;
  const x = (i: number) => L + (i / (weeks.length - 1)) * (R - L);
  const y = (a: number) => B - ((a * 100 - lo) / (hi - lo)) * (B - T);
  const ticks = Array.from({ length: (hi - lo) / 10 + 1 }, (_, i) => lo + i * 10);
  const path = weeks.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(w.accuracy).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(weeks.length / 8));
  return (
    <Figure id="weekly" narrow label="Figure 10b" title="Week by week"
      caption={<>Control Scout's ledger ({desc}), weeks with at least 20 scored matches. Early-season weeks are harder: ratings still lean on last season. Hover, tap or focus a point for its numbers.</>}>
      <ScrollX label="Accuracy by week chart">
        <Chart viewBox="0 0 640 240" interactive label={`Line chart of the share of matches called right each week, from ${pct(weeks[0].accuracy)} in the first week to ${pct(weeks[weeks.length - 1].accuracy)} in the last.`}>
          {ticks.map((v) => <g key={v}><line x1={L} x2={R} y1={y(v / 100)} y2={y(v / 100)} className="grid" /><text x={L - 8} y={y(v / 100) + 4} textAnchor="end">{v}%</text></g>)}
          <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinejoin="round" className="fade" />
          {weeks.map((w, i) => (
            <g key={w.week}>
              <circle cx={x(i)} cy={y(w.accuracy)} r={4.5} fill="var(--color-accent)" stroke="var(--color-card)" strokeWidth={1.5} className="pop" style={{ ["--i" as string]: i }}
                {...tip(`Week of ${w.week}: ${pct(w.accuracy, 1)} called right (${w.n.toLocaleString("en-US")} matches)`)} />
              {i % every === 0 && <text x={x(i)} y={B + 18} textAnchor="middle">{w.week.slice(5)}</text>}
            </g>
          ))}
          <text x={(L + R) / 2} y={B + 32} textAnchor="middle">week starting (month-day){lo === 50 ? " · axis starts at 50%" : ""}</text>
        </Chart>
      </ScrollX>
    </Figure>
  );
}

function StageChart() {
  const a = ENG.advancement;
  return (
    <Figure narrow label="Figure 11 · engine test" title="Advancement odds sharpen as the event unfolds (Brier, lower is better)"
      caption={<>From {ENGINE_TEST}, over {a.events} advancing events. Even before a single match is played, the engine beats the naive guess that can only be made after quals. Before the event, its rank estimates are off by about 5 places on average, and the 10–90% rank range catches the real rank 86% of the time.</>}>
      <ScrollX label="Advancement Brier by stage chart">
        <HBars
          label={`Bar chart: advancement Brier is ${a.pre.brier.toFixed(3)} before the event, ${a.quals.brier.toFixed(3)} after quals, ${a.selected.brier.toFixed(3)} after alliance selection, versus ${a.naiveTopRanked.brier.toFixed(3)} for a naive top-ranked-teams-advance guess that already needs the quals results.`}
          max={0.17} fmt={(v) => v.toFixed(3)} ticks={[0, 0.05, 0.1, 0.15]} left={190} rowH={38}
          rows={[
            { label: "Before the event", v: a.pre.brier, tone: "gold", dim: true },
            { label: "After quals", v: a.quals.brier, tone: "gold" },
            { label: "After alliance selection", v: a.selected.brier, tone: "gold", strong: true },
            { label: "Naive: top ranks advance", v: a.naiveTopRanked.brier, tone: "muted" },
          ]}
        />
      </ScrollX>
    </Figure>
  );
}
