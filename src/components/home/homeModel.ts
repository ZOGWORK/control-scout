// What the home page's prediction record and usage panel show, worked out apart
// from their markup so the rules can be tested: live calls and replays never mix,
// correct and missed share one denominator, and an unavailable feed is never a zero.
import type { AccuracyBlock, TrackRecord } from "../../shared/api";
import type { PublicUsage } from "../../shared/home";

export type Evidence = "live" | "backtest";

export interface RecordView {
  kind: Evidence;
  season: number;
  seasonLabel: string;
  block: AccuracyBlock;
  /** Correct and missed decisive calls (both of `decided`), or null when the response predates that count. */
  split: { correct: number; missed: number; decided: number } | null;
  /** Live calls short of the sample the headline waits for. */
  early: boolean;
}

/** The newest season with this kind of evidence (the headline's own season first, when it's that kind). */
export function recordFor(t: TrackRecord, kind: Evidence): RecordView | null {
  const pick = (t.headline?.kind === kind ? t.seasons.find((s) => s.season === t.headline!.season && s[kind]) : null)
    ?? [...t.seasons].sort((a, b) => b.season - a.season).find((s) => s[kind] && s[kind]!.n > 0);
  const block = pick?.[kind];
  if (!pick || !block) return null;
  const decided = typeof block.decided === "number" ? block.decided : null;
  return {
    kind, season: pick.season, seasonLabel: pick.label, block,
    split: decided != null && decided > 0 ? { correct: decided - block.upsets, missed: block.upsets, decided } : null,
    early: kind === "live" && block.n < t.liveThreshold,
  };
}

/** Which evidence opens first: the headline's (it already applies the live threshold). */
export const defaultEvidence = (t: TrackRecord): Evidence => t.headline?.kind ?? (recordFor(t, "live") ? "live" : "backtest");

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
