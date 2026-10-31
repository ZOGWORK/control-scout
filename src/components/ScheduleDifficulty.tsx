// Schedule difficulty (src/shared/scheduleDifficulty.ts): how hard each team's qualification draw is next to
// the rest of the field. On the event page it's a column of the Rankings table (a tap gives the plain line); on a
// team page, one card per event. Always said in words beside the number: its opponents' and partners' average
// rating against the field's, and where that puts it ("3rd-hardest of 24"). Mid-event, what's left of the
// schedule leads and the full schedule sits next to it.
import { Link } from "react-router-dom";
import type { TeamEventRow, TeamSchedule } from "../shared/api";
import { scheduleLine, scheduleRankText, scheduleWord, type ScheduleSide } from "../shared/scheduleDifficulty";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { SCHEDULE_STAT_KEYS } from "../shared/statCatalog";
import { Section } from "./page";
import { cn } from "./cn";
import { useFlag } from "../lib/flags";

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
// Event page: the Rankings table's Schedule columns
// ---------------------------------------------------------------------------

/** The record columns (src/shared/statCatalog.ts) that hold schedule difficulty. */
export const SCHEDULE_STATS: ReadonlySet<string> = new Set(SCHEDULE_STAT_KEYS);

/**
 * Each team's place by full-schedule difficulty within one event's whole table (1 = hardest, ties shared from both
 * ends, as scheduleDifficulty ranks them), for the cell's "3rd-hardest of 24". Empty for a filtered or multi-event
 * table, where a place among the rows shown would mislead.
 */
export function schedulePlaces(rows: { team?: number; stats: Record<string, unknown> }[]): Map<number, Pick<ScheduleSide, "rank" | "of" | "easyRank">> {
  const vs = rows.flatMap((r) => (typeof r.stats.scheduleDifficulty === "number" && r.team != null ? [{ team: r.team, v: r.stats.scheduleDifficulty }] : []));
  return new Map(vs.map(({ team, v }) => [team, {
    rank: 1 + vs.filter((o) => o.v > v + 1e-9).length, of: vs.length, easyRank: 1 + vs.filter((o) => o.v < v - 1e-9).length,
  }]));
}

/**
 * One Schedule cell: the signed points, and for the full schedule a tap (or hover) for the plain line, so the
 * number is never on its own. `rank`: where it sits in the field, when the caller knows (the live fallback table).
 */
export function ScheduleValue({ stat, v, opponents, partners, rank }: { stat: string; v: unknown; opponents?: unknown; partners?: unknown; rank?: Pick<ScheduleSide, "rank" | "of" | "easyRank"> }) {
  if (typeof v !== "number" || !Number.isFinite(v)) return <>—</>;
  const text = signedPts(v);
  if (stat !== "scheduleDifficulty" || typeof opponents !== "number" || typeof partners !== "number") return <>{text}</>;
  return (
    <Popover>
      <PopoverTrigger className="rounded underline decoration-current/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Schedule ${text}: ${scheduleLine({ opponents, partners })}`} data-schedule-cell>
        {text}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[min(20rem,90vw)] p-3 text-left text-sm font-normal text-foreground">
        <p className="flex items-center gap-2"><span className="font-semibold">{rank ? cap(scheduleRankText(rank)) : "Schedule difficulty"}</span></p>
        <p className="mt-1 text-muted-foreground">{scheduleLine({ opponents, partners })}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{text} points harder than an average draw: strong opponents and weak partners make it harder.</p>
      </PopoverContent>
    </Popover>
  );
}

const cap = (x: string) => `${x[0].toUpperCase()}${x.slice(1)}`;

// ---------------------------------------------------------------------------
// Team page
// ---------------------------------------------------------------------------

export function TeamScheduleSection({ team, schedule, events }: { team: number; schedule: TeamSchedule[]; events: TeamEventRow[] }) {
  const on = useFlag("scheduleDifficulty");
  if (!schedule.length || !on) return null;
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
