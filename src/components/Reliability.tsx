// Reliability index on the pages where picks are made (team page, Compare, pick lists, pre-match report):
// always labelled an estimate, with its parts and sample size one tap away. The public number uses match data
// only; a workspace's members may also see the blend with their own notes, marked as such.
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import type { Reliability, ReliabilityNotes } from "../shared/reliability";
import { blendedIndex, RELIABILITY_PRIOR, reliabilityWord } from "../shared/reliability";
import { Section } from "./page";
import { StatTile } from "./StatTile";
import { num, pct } from "../lib/format";
import { cn } from "./cn";

/** Under this many matches the index leans on the field average, and says so. */
export const RELIABILITY_SMALL = 10;

/** "1 match", "3 matches", "2 entries". */
export const plural = (n: number, w: string) => `${n} ${n === 1 ? w : /(ch|sh|s|x)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`}`;

/** Plain-language parts, each with its raw count. */
export function reliabilityParts(r: Reliability): { label: string; value: string; note: string }[] {
  return [
    { label: "No-shows", value: `${r.noShows} of ${r.matches}`, note: "Listed for a qualification match but not on the field." },
    { label: "Disqualified", value: `${r.dqs}`, note: "Matches the team was disqualified in." },
    { label: "Near-zero matches", value: `${r.nearZero}`, note: "Estimated: alliance score minus the partner's OPR came to almost nothing. Defense or a partner carrying the alliance can look the same, so this is a hint, not proof of a dead robot." },
    { label: "Swing", value: `±${num(r.parts.swing, 2)}`, note: "How much its estimated contribution moves from match to match, in average-robot units." },
    { label: "Penalties", value: `${num(r.parts.penaltyRatio, 2)}×`, note: "Penalty points its alliances gave away per robot, against the season average (1× = average)." },
    { label: "Predictability", value: r.parts.predictabilityRatio > 0 ? `${num(r.parts.predictabilityRatio, 2)}×` : "Not counted", note: "Spread of the engine's live-call misses on its matches, against the field (1× = average; a team with no live calls yet reads as average). Not counted in a season with no scored live calls." },
  ];
}

export function ReliabilityTile({ r, className }: { r: Reliability; className?: string }) {
  const small = r.matches < RELIABILITY_SMALL;
  return (
    <StatTile tone="emerald" icon={ShieldCheck} className={className} label="Reliability (estimate)"
      value={<>{r.index}<span className="text-base font-medium text-muted-foreground"> / 100</span></>}
      hint={<>{plural(r.matches, "qual match")}{r.fieldIndex != null && <> · field {r.fieldIndex} · {reliabilityWord(r.index, r.fieldIndex)}</>}{small && " · small sample"}</>} />
  );
}

/** The team page's section: the index, its parts, and (for a workspace's members) the blend with their notes. */
export function ReliabilitySection({ r, notes, workspaceName }: { r: Reliability | null | undefined; notes?: ReliabilityNotes | null; workspaceName?: string | null }) {
  return (
    <Section title="Reliability" description={<>How dependable this robot has been: no-shows, DQs, near-zero matches, swing, penalties and how predictable its matches are. An estimate from match results only. <Link to="/methodology#reliability" className="underline">How it's computed</Link></>}>
      {!r ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground max-sm:py-4">No qualification matches to estimate reliability from this season yet.</p>
      ) : (
        <div data-testid="reliability" className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <div className="space-y-3 self-start">
            <ReliabilityTile r={r} />
            {notes && notes.matchEntries > 0 && <BlendedTile r={r} notes={notes} workspaceName={workspaceName ?? null} />}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {reliabilityParts(r).map((x) => (
                <div key={x.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{x.label}</dt>
                  <dd className="font-medium tabular-nums">{x.value}</dd>
                  <dd className="text-[11px] text-muted-foreground">{x.note}</dd>
                </div>
              ))}
            </dl>
            <p className={cn("mt-3 rounded-lg p-2 text-xs text-muted-foreground", r.matches < RELIABILITY_SMALL ? "bg-warning/[0.08]" : "bg-muted/40")}>
              Every part is pulled toward the season average as if the team had {RELIABILITY_PRIOR} more matches at it{r.matches < RELIABILITY_SMALL ? ": with this few matches, the index says more about the field than about this team" : ""}. Last {r.recent.matches}: {plural(r.recent.noShows, "no-show")}, {plural(r.recent.nearZero, "near-zero match", )}.
            </p>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Members of a workspace only: the index with their own match notes (broken / disabled / no-show) folded in. */
export function BlendedTile({ r, notes, workspaceName }: { r: Reliability; notes: ReliabilityNotes; workspaceName: string | null }) {
  return (
    <div data-testid="reliability-blended" className="rounded-xl border border-violet-500/30 bg-violet-500/[0.06] p-4">
      <p className="text-sm text-muted-foreground">With {workspaceName ? `${workspaceName}'s` : "your workspace's"} notes</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{blendedIndex(r, notes)}<span className="text-base font-medium text-muted-foreground"> / 100</span></p>
      <p className="mt-1 text-xs text-muted-foreground">
        Includes your workspace's scouting: {notes.flagged} of {plural(notes.matchEntries, "match entry")} marked broken, disabled or no-show ({pct(notes.matchEntries ? notes.flagged / notes.matchEntries : 0)}). Only your workspace's members see this.
      </p>
    </div>
  );
}

/** Compact "84" for tables and pick rows, with the sample in its title. */
export function ReliabilityCell({ index, matches, className }: { index: number | null | undefined; matches?: number | null; className?: string }) {
  if (index == null) return <span className={className}>—</span>;
  return <span className={cn("tabular-nums text-success", className)} title={`Reliability estimate ${index}/100 from ${matches ?? 0} qualification matches`}>{index}</span>;
}
