// Shortlist helpers: the pick order (the bookmarks array's own order), notes,
// the list/grid view choice, and links into Compare. Pure where possible so
// the reorder rules are tested without a browser.
import type { ConfidenceTier, MatchView, ShortlistTeam } from "../shared/api";

/** Move the item at `from` to `to` (both clamped); a new array, the input untouched. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const dest = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(dest, 0, x);
  return out;
}

/** Move a team by `delta` places (negative = up the pick list). Unknown team: unchanged. */
export function moveTeam(list: readonly number[], team: number, delta: number): number[] {
  const i = list.indexOf(team);
  return i < 0 ? [...list] : moveItem(list, i, i + delta);
}

/**
 * Apply an order chosen on a page that shows only part of the list (the first
 * 100 teams): the shown teams take `shown`'s order, the rest keep their place
 * after them. Teams removed meanwhile (on another tab or device) stay removed.
 */
export function applyOrder(list: readonly number[], shown: readonly number[]): number[] {
  const inList = new Set(list);
  const head = shown.filter((t) => inList.has(t));
  const inHead = new Set(head);
  return [...head, ...list.filter((t) => !inHead.has(t))];
}

/** Where a dragged item lands: the slot whose centre is nearest the pointer (works for a list and a grid). */
export function nearestSlot(rects: readonly { left: number; top: number; width: number; height: number }[], x: number, y: number): number {
  let best = -1, dist = Infinity;
  rects.forEach((r, i) => {
    // Distance to the box (0 inside it), then to its centre to break ties between overlapping rows.
    const dx = Math.max(r.left - x, 0, x - (r.left + r.width)), dy = Math.max(r.top - y, 0, y - (r.top + r.height));
    const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
    const d = (dx * dx + dy * dy) * 1e6 + cx * cx + cy * cy;
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

/** Set or clear one team's note (an empty note is removed). */
export function setNote(notes: Readonly<Record<string, string>>, team: number, text: string): Record<string, string> {
  const out = { ...notes };
  const t = text.trim();
  if (t) out[String(team)] = t.slice(0, 500);
  else delete out[String(team)];
  return out;
}

/** Compare link for up to four teams, in the order given. */
export const compareHref = (teams: readonly number[], season?: number) =>
  `/compare?teams=${teams.slice(0, 4).join(",")}${season ? `&season=${season}` : ""}`;

/** CSV rows in pick order, with the pick number and the note. */
export function shortlistCsvRows(rows: readonly ShortlistTeam[], notes: Readonly<Record<string, string>>) {
  return rows.map((r, i) => ({
    Pick: i + 1, Team: r.team, Name: r.name ?? "", From: r.place,
    OPR: r.opr, Auto: r.breakdown.auto, TeleOp: r.breakdown.teleop, Endgame: r.breakdown.endgame,
    "World rank": r.oprRank, Rating: r.rating, "W-L-T": r.record ?? "", "Last event": r.lastEvent?.name ?? "", Note: notes[String(r.team)] ?? "",
  }));
}

export type ShortlistView = "list" | "grid";
const VIEW_KEY = "cs-shortlist-view";
/** The saved view; with none saved, grid on phones and list elsewhere. */
export function readView(phone: boolean): ShortlistView {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === "list" || v === "grid") return v; } catch { /* blocked */ }
  return phone ? "grid" : "list";
}
export function saveView(v: ShortlistView) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* blocked */ } }

export interface PredictionSnapshot {
  /** The team's next predicted match (its logged pre-match call, or today's ratings). */
  next: { m: MatchView; pWin: number; tier: ConfidenceTier } | null;
  /** Mean win chance over its predicted upcoming matches. */
  upcoming: { n: number; pWin: number; tier: ConfidenceTier } | null;
  /** Played matches with a prediction of ONE kind (logged live if any, else backtest; never blended):
   *  the mean predicted win chance next to the real win rate. */
  past: { n: number; kind: "live" | "backtest"; expected: number; actual: number; tier: ConfidenceTier } | null;
}

const TIER_ORDER: ConfidenceTier[] = ["provisional", "moderate", "confident"];
/** The least sure tier among the predictions summarised (an average is only as sure as its weakest call). */
const weakest = (tiers: ConfidenceTier[]) => TIER_ORDER.find((t) => tiers.includes(t)) ?? "provisional";

/** Win-chance snapshot for one team from its season's matches (as /api/teams/:n/matches returns them). */
export function predictionSnapshot(matches: readonly MatchView[], team: number): PredictionSnapshot {
  const sideOf = (m: MatchView) => {
    const r = m.red.teams.find((t) => t.number === team), b = m.blue.teams.find((t) => t.number === team);
    return r ? { side: "red" as const, me: r } : b ? { side: "blue" as const, me: b } : null;
  };
  const up: { m: MatchView; pWin: number; tier: ConfidenceTier }[] = [];
  const done: { pWin: number; won: number; kind: "live" | "backtest"; tier: ConfidenceTier }[] = [];
  for (const m of matches) {
    const s = sideOf(m), p = m.prediction;
    if (!s || !p) continue;
    const pWin = s.side === "red" ? p.pRed : 1 - p.pRed;
    if (!m.played) { if (p.kind === "now" || p.kind === "live") up.push({ m, pWin, tier: p.tier }); continue; }
    // Like the season record: a match it sat out, or a qual played as a surrogate, isn't its own.
    if (!s.me.onField || (m.level === "qual" && s.me.surrogate) || p.kind === "now") continue;
    const red = m.red.score?.total, blue = m.blue.score?.total;
    if (red == null || blue == null) continue;
    const mine = s.side === "red" ? red : blue, theirs = s.side === "red" ? blue : red;
    done.push({ pWin, won: mine > theirs ? 1 : mine === theirs ? 0.5 : 0, kind: p.kind, tier: p.tier });
  }
  up.sort((a, b) => (a.m.startsAt ?? a.m.time ?? "").localeCompare(b.m.startsAt ?? b.m.time ?? ""));
  const kind = done.some((d) => d.kind === "live") ? "live" : "backtest";
  const past = done.filter((d) => d.kind === kind);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    next: up[0] ?? null,
    upcoming: up.length ? { n: up.length, pWin: mean(up.map((u) => u.pWin)), tier: weakest(up.map((u) => u.tier)) } : null,
    past: past.length ? { n: past.length, kind, expected: mean(past.map((d) => d.pWin)), actual: mean(past.map((d) => d.won)), tier: weakest(past.map((d) => d.tier)) } : null,
  };
}

/** The last `n` matches the team played, newest first (the API lists them in time order). */
export function lastPlayed(matches: readonly MatchView[], n = 5): MatchView[] {
  return matches.filter((m) => m.played).slice(-n).reverse();
}
