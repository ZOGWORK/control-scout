// Schedule difficulty (src/shared/scheduleDifficulty.ts): how hard each team's qualification draw is next to
// the rest of the field. On the event page's Rankings tab, every team, hardest first; on a team page, one
// line per event. Always said in words beside the number: its opponents' and partners' average rating against
// the field's, and where that puts it ("3rd-hardest of 24"). Mid-event, what's left of the schedule leads and
// the full schedule sits next to it.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Dices } from "lucide-react";
import type { EventDetail, TeamEventRow, TeamSchedule } from "../shared/api";
import { scheduleLine, scheduleRankText, scheduleWord, type ScheduleDifficulty, type ScheduleSide } from "../shared/scheduleDifficulty";
import { ToggleGroup, ToggleGroupItem } from "./ui/controls";
import { Button } from "./ui/button";
import { Section } from "./page";
import { TeamNo } from "./EventGlance";
import { cn } from "./cn";

/** Rows shown before "Show all". */
const FIRST = 8;

const WORD_TONE: Record<ReturnType<typeof scheduleWord>, { chip: string; bar: string; text: string }> = {
  Hard: { chip: "bg-danger/15 text-danger-text", bar: "bg-danger", text: "text-danger-text" },
  Tough: { chip: "bg-warning/15 text-warning-text", bar: "bg-warning", text: "text-warning-text" },
  Average: { chip: "bg-muted text-muted-foreground", bar: "bg-muted-foreground/60", text: "text-foreground" },
  Kind: { chip: "bg-info/15 text-info-text", bar: "bg-info", text: "text-info-text" },
  Easy: { chip: "bg-success/15 text-success-text", bar: "bg-success", text: "text-success-text" },
};

/** What the measurement on past seasons found (docs/schedule-difficulty.md), said once under the card. */
const EVIDENCE = "Across the 2023–2025 seasons (43,000 team finishes), a schedule one step harder than average (one standard deviation) cost a team about 2 places in the final qualification ranking against its rating.";

const signedPts = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(1)}`;

function WordChip({ z, className }: { z: number; className?: string }) {
  const w = scheduleWord(z);
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", WORD_TONE[w].chip, className)} data-schedule-word={w}>{w}</span>;
}

/** A diverging strip: easier to the left of the middle, harder to the right, capped at ±2.5 SD. */
function Strip({ z }: { z: number }) {
  const w = scheduleWord(z);
  const pct = Math.min(1, Math.abs(z) / 2.5) * 50;
  return (
    <div className="relative h-1.5 rounded-full bg-muted" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
      <span className={cn("absolute inset-y-0 rounded-full", WORD_TONE[w].bar)} style={z >= 0 ? { left: "50%", width: `${Math.max(1, pct)}%` } : { right: "50%", width: `${Math.max(1, pct)}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event page
// ---------------------------------------------------------------------------

type View = "remaining" | "full";

export function ScheduleDifficultyCard({ d, team }: { d: EventDetail; team: number | null }) {
  const sd = d.scheduleDifficulty;
  const open = !!sd && sd.played > 0 && sd.played < sd.scheduled && sd.teams.some((t) => t.remaining);
  const [view, setView] = useState<View>("remaining");
  const [all, setAll] = useState(false);
  if (!sd) return null;
  const v: View = open ? view : "full";
  const sideOf = (t: ScheduleDifficulty["teams"][number]) => (v === "remaining" ? t.remaining : t.full);
  const rows = sd.teams.filter((t) => sideOf(t)).sort((a, b) => sideOf(a)!.rank - sideOf(b)!.rank || a.team - b.team);
  const names = new Map(d.field.map((f) => [f.team, f.name]));
  // The first rows, plus the team asked for (?team=) wherever it sits.
  const shown = all ? rows : rows.filter((t, i) => i < FIRST || t.team === team);
  const left = sd.scheduled - sd.played;
  return (
    <section aria-labelledby="schedule-difficulty" data-schedule-difficulty={v} className="relative mb-6 max-sm:mb-4 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-60 rounded-full bg-danger opacity-10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-16 -bottom-24 size-60 rounded-full bg-success opacity-10 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text"><Dices className="size-4" aria-hidden /></span>
          <h2 id="schedule-difficulty" className="font-display text-lg font-semibold text-foreground">Schedule difficulty</h2>
          {open ? (
            <ToggleGroup type="single" value={v} onValueChange={(x) => x && setView(x as View)} aria-label="Which matches">
              <ToggleGroupItem size="sm" value="remaining">Still to play ({left})</ToggleGroupItem>
              <ToggleGroupItem size="sm" value="full">Full schedule ({sd.scheduled})</ToggleGroupItem>
            </ToggleGroup>
          ) : (
            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{sd.played === 0 ? "Full schedule, before the first match" : `All ${sd.scheduled} qualification matches`}</span>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          How each team's qualification draw compares with the rest of the field: its opponents' and partners' average rating
          against the field's average of {sd.fieldMean.toFixed(1)} points per robot. Strong opponents and weak partners make it harder. Hardest first.
          {v === "remaining" && " Only the matches still to play; the full schedule is one tap away."}
        </p>
        <ol className="mt-4 grid gap-2 lg:grid-cols-2">
          {shown.map((t) => <EventRow key={t.team} team={t.team} name={names.get(t.team) ?? null} s={sideOf(t)!} season={d.event.season} mine={t.team === team} other={v === "remaining" ? t.full : t.remaining} otherLabel={v === "remaining" ? "Full schedule" : "Still to play"} />)}
        </ol>
        {rows.length > shown.length || all ? (
          <Button variant="outline" size="sm" className="mt-3" aria-expanded={all} onClick={() => setAll(!all)} data-schedule-more>
            {all ? "Show fewer" : `Show all ${rows.length} teams`} <ChevronDown className={cn("transition-transform motion-reduce:transition-none", all && "rotate-180")} aria-hidden />
          </Button>
        ) : null}
        <p className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          Ratings are the model's non-penalty points per robot; a team with no result yet this season starts from last season's.
          The baseline for each team is the field without itself. {EVIDENCE}
        </p>
      </div>
    </section>
  );
}

function EventRow({ team, name, s, season, mine, other, otherLabel }: { team: number; name: string | null; s: ScheduleSide; season: number; mine: boolean; other: ScheduleSide | null; otherLabel: string }) {
  const w = scheduleWord(s.z);
  return (
    <li className={cn("rounded-xl border border-border/70 bg-background/40 p-3", mine && "border-accent ring-1 ring-accent/40")} data-schedule-row={team}>
      <div className="flex items-start gap-3">
        <span className={cn("w-7 shrink-0 pt-0.5 text-right font-display text-lg font-semibold leading-none tabular-nums", WORD_TONE[w].text)} aria-label={`Schedule rank ${s.rank}`}>{s.rank}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TeamNo team={team} name={name} season={season} className="text-base" />
            {name && <span className="min-w-0 truncate text-sm text-foreground">{name}</span>}
            <WordChip z={s.z} />
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{scheduleLine(s)} <span className="text-foreground">{cap(scheduleRankText(s))}</span> over {s.matches} {s.matches === 1 ? "match" : "matches"}.</p>
          {other && <p className="mt-0.5 text-xs text-muted-foreground">{otherLabel}: {scheduleRankText(other)} ({signedPts(other.difficulty)})</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-display text-xl font-semibold leading-none tabular-nums", WORD_TONE[w].text)}>{signedPts(s.difficulty)}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">pts harder</p>
        </div>
      </div>
      <div className="mt-2 pl-10"><Strip z={s.z} /></div>
    </li>
  );
}

const cap = (x: string) => `${x[0].toUpperCase()}${x.slice(1)}`;

// ---------------------------------------------------------------------------
// Team page
// ---------------------------------------------------------------------------

export function TeamScheduleSection({ team, schedule, events }: { team: number; schedule: TeamSchedule[]; events: TeamEventRow[] }) {
  if (!schedule.length) return null;
  const evBy = new Map(events.map((e) => [e.code, e]));
  // Newest event first, as the event history.
  const rows = [...schedule].reverse();
  return (
    <Section title="Schedule difficulty" description="How hard this team's qualification draw is at each event, next to the rest of the field">
      <div className="grid gap-3 lg:grid-cols-2" data-team-schedule>
        {rows.map((s) => <TeamRow key={s.code} s={s} ev={evBy.get(s.code)} team={team} />)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Ratings are the model's non-penalty points per robot; a team with no result yet this season starts from last season's. {EVIDENCE}</p>
    </Section>
  );
}

function TeamRow({ s, ev, team }: { s: TeamSchedule; ev: TeamEventRow | undefined; team: number }) {
  // Mid-event: what's left leads, the full schedule beside it.
  const lead = s.remaining ?? s.full;
  if (!lead) return null;
  const w = scheduleWord(lead.z);
  const href = ev ? `/events/${ev.season}/${encodeURIComponent(s.code)}?team=${team}&tab=rankings` : null;
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4" data-team-schedule-row={s.code}>
      <div aria-hidden className={cn("pointer-events-none absolute -right-10 -top-14 size-36 rounded-full opacity-15 blur-2xl", WORD_TONE[w].bar)} />
      <div className="relative">
        <p className="truncate text-sm font-medium text-foreground">{href ? <Link to={href} className="hover:text-accent-text">{ev?.name ?? s.code}</Link> : s.code}</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn("font-display text-2xl font-semibold leading-none", WORD_TONE[w].text)}>{cap(scheduleRankText(lead))}</span>
          <WordChip z={lead.z} />
          <span className="text-xs text-muted-foreground">{s.remaining ? `${lead.matches} still to play` : s.played === 0 ? "before the first match" : `${lead.matches} qualification matches`}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{scheduleLine(lead, "its")}</p>
        <div className="mt-2"><Strip z={lead.z} /></div>
        {s.remaining && s.full && <p className="mt-2 text-xs text-muted-foreground">Full schedule: {scheduleRankText(s.full)}. {scheduleLine(s.full, "its")}</p>}
      </div>
    </div>
  );
}
