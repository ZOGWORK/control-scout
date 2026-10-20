// The one rule for which part of the prediction ledger leads, shared by the server (TrackRecord.headline)
// and every card that shows the ledger (home track record, methodology scoreboard), so they can never
// disagree: the season replay leads until a season has LIVE_THRESHOLD scored live calls, then live does.
// Live (logged before the match) and replay numbers are never blended; the other one stays a click away.
import type { AccuracyBlock, TrackRecord } from "./api";

/** Scored live calls a season needs before live leads instead of the replay. */
export const LIVE_THRESHOLD = 300;
/** Replayed matches a season needs before its replay can lead (a few weeks in, the newest season's is too thin). */
export const REPLAY_HEADLINE_MIN = 1000;

export type LedgerKind = "live" | "backtest";

type Season = Pick<TrackRecord["seasons"][number], "season" | "live" | "backtest">;

/**
 * What leads: the newest season with LIVE_THRESHOLD scored live calls, else the newest season whose
 * replay has REPLAY_HEADLINE_MIN matches. Null when neither exists yet.
 */
export function pickHeadline(seasons: Season[]): TrackRecord["headline"] {
  const newest = [...seasons].sort((a, b) => b.season - a.season);
  const live = newest.find((s) => s.live && s.live.n >= LIVE_THRESHOLD);
  if (live?.live) return { kind: "live", season: live.season, accuracy: live.live.accuracy, n: live.live.n };
  const replay = newest.find((s) => s.backtest && s.backtest.n >= REPLAY_HEADLINE_MIN);
  if (replay?.backtest) return { kind: "backtest", season: replay.season, accuracy: replay.backtest.accuracy, n: replay.backtest.n };
  return null;
}

/** Where a ledger card opens: the headline, else the newest season with anything scored (its replay first). */
export function ledgerDefault(t: Pick<TrackRecord, "headline" | "seasons">): { season: number; kind: LedgerKind } | null {
  if (t.headline) return { season: t.headline.season, kind: t.headline.kind };
  const s = [...t.seasons].sort((a, b) => b.season - a.season).find((x) => (x.backtest?.n ?? 0) > 0 || (x.live?.n ?? 0) > 0);
  if (!s) return null;
  return { season: s.season, kind: (s.backtest?.n ?? 0) > 0 ? "backtest" : "live" };
}

/** The newest season with live calls and how many it has scored, for "N of 300 so far". */
export function liveProgress(t: Pick<TrackRecord, "seasons">): { season: number; label: string; n: number } | null {
  const s = [...t.seasons].sort((a, b) => b.season - a.season).find((x) => (x.live?.n ?? 0) > 0);
  return s ? { season: s.season, label: s.label, n: s.live!.n } : null;
}

/** Correct and missed decisive calls: both out of `decided` (ties and 50:50 calls are neither). */
export function ledgerSplit(b: Pick<AccuracyBlock, "decided" | "upsets">): { correct: number; missed: number; decided: number } | null {
  if (typeof b.decided !== "number" || b.decided <= 0) return null;
  return { correct: b.decided - b.upsets, missed: b.upsets, decided: b.decided };
}

/** Brier improvement over always saying 50% (0.2 = 20% better); null when the baseline is 0 (only ties scored). */
export function brierSkill(b: Pick<AccuracyBlock, "brier" | "baselineBrier">): number | null {
  return b.baselineBrier > 0 ? 1 - b.brier / b.baselineBrier : null;
}

/** The headline rule in one sentence, saying which mode leads now and how far the newest live season has got. */
export function headlineRule(t: Pick<TrackRecord, "headline" | "seasons" | "liveThreshold">): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const h = t.headline;
  if (h?.kind === "live") {
    const label = t.seasons.find((s) => s.season === h.season)?.label ?? String(h.season);
    return `Live calls lead: ${label} has ${n(h.n)} scored (the season replay leads until a season has ${n(t.liveThreshold)}).`;
  }
  const p = liveProgress(t);
  return `The season replay leads until a season has ${n(t.liveThreshold)} scored live calls${p ? ` (${p.label}: ${n(p.n)} so far)` : ""}, then live does.`;
}

/** Which mode a number is, in words every ledger surface uses. */
export const LEDGER_MODE: Record<LedgerKind, { tab: string; title: string; detail: string }> = {
  live: { tab: "Logged live", title: "Live calls, logged before each match", detail: "called before each match" },
  backtest: { tab: "Season replay", title: "Season replay, scored", detail: "replayed with only earlier matches, not calls made in advance" },
};
