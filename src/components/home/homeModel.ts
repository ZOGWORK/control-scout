// What the home page's prediction record and usage panel show, worked out apart
// from their markup so the rules can be tested: live calls and replays never mix,
// correct and missed share one denominator, and an unavailable feed is never a zero.
import type { AccuracyBlock, ReplayCoverage, TrackRecord } from "../../shared/api";
import type { PublicUsage } from "../../shared/home";
import { ledgerDefault, ledgerSplit, type LedgerKind } from "../../shared/ledger";

export type Evidence = LedgerKind;

export interface RecordView {
  kind: Evidence;
  season: number;
  seasonLabel: string;
  block: AccuracyBlock;
  /** Correct and missed decisive calls (both of `decided`), or null when the response predates that count. */
  split: { correct: number; missed: number; decided: number } | null;
  /** Live calls short of the sample the headline waits for: still calibrating this season. */
  early: boolean;
  /** Every scored call so far was a tie or a 50:50 call: there's no percentage to show yet (accuracy is a stand-in 0). */
  noneDecided: boolean;
  /** This is the number the headline rule picks (src/shared/ledger.ts). */
  isHeadline: boolean;
  /** For a replay: how many of the season's scored matches it covers (absent in older responses). */
  coverage: ReplayCoverage | null;
  /**
   * Live only, when the season's calls came from more than one engine version: the versions in the figure
   * (oldest first), and the serving engine's own share of them when it made any. The big number is the
   * blend of all of them, so it says so; the serving engine's figure is the secondary line.
   */
  engines: { versions: string[]; current: { engine: string; n: number; accuracy: number } | null } | null;
}

/**
 * The season this kind of evidence shows (the headline's own season first, when it's that kind). Live: the newest
 * season with live calls. Replay: the newest season other than the one being logged live (the newest season with
 * live calls; a finished season keeps its saved live calls, so having them isn't what marks it in progress). So the
 * last full season shows (DECODE's replay while 2026–27 is logged live) and a partial replay of the season in progress
 * never stands in for a whole season's; the newest replay of all only when no other season has one.
 */
export function recordFor(t: TrackRecord, kind: Evidence): RecordView | null {
  const byNewest = [...t.seasons].sort((a, b) => b.season - a.season);
  const newest = byNewest.filter((s) => s[kind] && s[kind]!.n > 0);
  const loggingLive = byNewest.find((s) => s.live && s.live.n > 0)?.season;
  const pick = (t.headline?.kind === kind ? t.seasons.find((s) => s.season === t.headline!.season && s[kind]) : null)
    ?? (kind === "backtest" ? newest.find((s) => s.season !== loggingLive) : undefined)
    ?? newest[0];
  const block = pick?.[kind];
  if (!pick || !block) return null;
  return {
    kind, season: pick.season, seasonLabel: pick.label, block,
    split: ledgerSplit(block),
    early: kind === "live" && block.n < t.liveThreshold,
    noneDecided: block.decided === 0,
    isHeadline: t.headline?.kind === kind && t.headline.season === pick.season,
    coverage: kind === "backtest" ? pick.replay ?? null : null,
    engines: kind === "live" ? enginesOf(pick.liveByEngine, t.engineVersion) : null,
  };
}

const semver = (v: string) => v.split(".").map(Number);
const byVersion = (a: string, b: string) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };

function enginesOf(rows: TrackRecord["seasons"][number]["liveByEngine"], serving: string): RecordView["engines"] {
  const used = (rows ?? []).filter((r) => r.n > 0);
  if (used.length < 2) return null;
  const cur = used.find((r) => r.engine === serving);
  return { versions: used.map((r) => r.engine).sort(byVersion), current: cur ? { engine: cur.engine, n: cur.n, accuracy: cur.accuracy } : null };
}

/** Which evidence opens first: the same rule as every ledger card (the replay until a season has LIVE_THRESHOLD live calls). */
export const defaultEvidence = (t: TrackRecord): Evidence => ledgerDefault(t)?.kind ?? "backtest";

export type UsageView =
  | { kind: "available"; totals: NonNullable<PublicUsage["totals"]>; daily: PublicUsage["daily"]; from: string; to: string; partialDay: string; measuredFrom: string | null; generatedAt: string }
  | { kind: "unavailable"; reason: NonNullable<PublicUsage["reason"]> | "unreachable"; message: string };

const UNAVAILABLE: Record<NonNullable<PublicUsage["reason"]> | "unreachable", string> = {
  "not-published": "Public usage totals aren’t published yet.",
  "no-data": "Nothing has been recorded yet.",
  error: "The usage totals couldn’t be read just now.",
  unreachable: "The usage totals couldn’t be loaded.",
};

/** The panel's state from the response (or its absence: a failed request is "unreachable", never zero). */
export function usageView(u: PublicUsage | null | undefined): UsageView {
  if (!u) return { kind: "unavailable", reason: "unreachable", message: UNAVAILABLE.unreachable };
  if (u.status !== "available" || !u.totals) {
    const reason = u.reason ?? "error";
    return { kind: "unavailable", reason, message: UNAVAILABLE[reason] };
  }
  return { kind: "available", totals: u.totals, daily: u.daily, from: u.measuredFrom ?? u.from, to: u.to, partialDay: u.to, measuredFrom: u.measuredFrom, generatedAt: u.generatedAt };
}

/** "Oct 17" from a YYYY-MM-DD UTC day (read as UTC, so it never shifts a day in the visitor's zone). */
export const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** An event's state as the calendar says it: "Live" only once results are coming in on its days. */
export function eventState(e: { status: "upcoming" | "live" | "finished"; matchesPlayed: number; matchesTotal: number }): { label: string; tone: "live" | "today" | "scheduled" | "done" } {
  if (e.status === "finished") return { label: "Completed", tone: "done" };
  if (e.status === "upcoming") return { label: "Scheduled", tone: "scheduled" };
  return e.matchesPlayed > 0 ? { label: "Live", tone: "live" } : { label: "On today, no results yet", tone: "today" };
}
