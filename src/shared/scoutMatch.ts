// Match-by-match scouting (the Scout redesign, docs/mockups/scout-redesign.html): what a scouting
// session watches, an event's schedule as the scout screen uses it, and one spelling for match labels.
// Pure and shared, so the server's export and filters can read labels the same way.
import type { MatchView } from "./api";

export type AllianceSide = "red" | "blue";
export type SlotId = "red1" | "red2" | "blue1" | "blue2";
export const SLOTS: readonly SlotId[] = ["red1", "red2", "blue1", "blue2"];

/** What a scout watches each match: one team slot, one alliance (its teams as tabs), or all four (quick mode). */
export type Watching = { kind: "slot"; slot: SlotId } | { kind: "alliance"; side: AllianceSide } | { kind: "all" };
export const DEFAULT_WATCHING: Watching = { kind: "alliance", side: "red" };

export const slotLabel = (s: SlotId) => `${s.startsWith("red") ? "Red" : "Blue"} ${s.endsWith("1") ? 1 : 2}`;
export function watchingLabel(w: Watching): string {
  return w.kind === "all" ? "All 4 teams" : w.kind === "alliance" ? `${w.side === "red" ? "Red" : "Blue"} alliance` : slotLabel(w.slot);
}

/** A watching value read from storage or a link, or null when it isn't one. */
export function parseWatching(v: unknown): Watching | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "all") return { kind: "all" };
  if (o.kind === "alliance" && (o.side === "red" || o.side === "blue")) return { kind: "alliance", side: o.side };
  if (o.kind === "slot" && SLOTS.includes(o.slot as SlotId)) return { kind: "slot", slot: o.slot as SlotId };
  return null;
}

/**
 * One spelling per match, so entries typed by different people line up: "12", "q12", "Q 012" and "qm12"
 * are all "Q12". Other labels (M2-1, F1, Practice) are trimmed, uppercased and lose inner spaces and
 * leading zeros in their numbers. Empty: null.
 */
export function normalizeMatchLabel(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  const qual = /^(?:QM?|QUAL|QUALIFICATION)?0*(\d+)$/.exec(s);
  if (qual) return `Q${Number(qual[1])}`;
  return s.replace(/(^|[^0-9])0+(?=\d)/g, "$1");
}

/** A scheduled match as the scout screen shows it. `label` uses the schedule's own spelling (Q12, M2-1, F1). */
export interface ScheduleMatch {
  key: string;
  label: string;
  level: "qual" | "playoff";
  /** Event-local time as FIRST reports it (no zone), for display. */
  time: string | null;
  startsAt: string | null;
  played: boolean;
  red: number[];
  blue: number[];
}

/** An event's matches in play order (quals, then playoffs), with their teams. */
export function scheduleFromMatches(matches: readonly MatchView[]): ScheduleMatch[] {
  const order = (m: MatchView) => (m.level === "qual" ? 0 : 1);
  return [...matches]
    .sort((a, b) => order(a) - order(b) || (a.startsAt && b.startsAt && a.startsAt !== b.startsAt ? (a.startsAt < b.startsAt ? -1 : 1) : 0) || a.series - b.series || a.number - b.number)
    .map((m) => ({
      key: m.key, label: m.label, level: m.level, time: m.time, startsAt: m.startsAt, played: m.played,
      red: m.red.teams.map((t) => t.number), blue: m.blue.teams.map((t) => t.number),
    }));
}

/** A team in a match the scout is watching, with its alliance and station (1 or 2). */
export interface WatchedTeam { team: number; side: AllianceSide; station: number }

/** The teams of a match this scout watches, red first. A slot the schedule leaves empty is skipped. */
export function teamsWatched(m: Pick<ScheduleMatch, "red" | "blue">, w: Watching): WatchedTeam[] {
  const side = (s: AllianceSide): WatchedTeam[] => m[s].map((team, i) => ({ team, side: s, station: i + 1 }));
  const all = [...side("red"), ...side("blue")];
  if (w.kind === "all") return all;
  if (w.kind === "alliance") return all.filter((t) => t.side === w.side);
  const s: AllianceSide = w.slot.startsWith("red") ? "red" : "blue", station = w.slot.endsWith("1") ? 1 : 2;
  return all.filter((t) => t.side === s && t.station === station);
}

/** Which teams already have an entry in each match at an event: normalized label → teams. */
export function scoutedByMatch(entries: readonly { eventCode: string | null; matchLabel: string | null; kind: string; team: number; deleted?: boolean }[], eventCode: string): Map<string, Set<number>> {
  const code = eventCode.trim().toUpperCase(), out = new Map<string, Set<number>>();
  for (const e of entries) {
    if (e.deleted || e.kind !== "match" || (e.eventCode ?? "").toUpperCase() !== code) continue;
    const label = normalizeMatchLabel(e.matchLabel);
    if (!label) continue;
    let set = out.get(label);
    if (!set) out.set(label, (set = new Set()));
    set.add(e.team);
  }
  return out;
}

export type MatchProgress = "done" | "partial" | "todo";
/** done: every watched team has an entry; partial: some do; todo: none. */
export function matchProgress(m: ScheduleMatch, w: Watching, scouted: Map<string, Set<number>>): MatchProgress {
  const teams = teamsWatched(m, w), have = scouted.get(normalizeMatchLabel(m.label) ?? "");
  const n = have ? teams.filter((t) => have.has(t.team)).length : 0;
  return teams.length > 0 && n === teams.length ? "done" : n > 0 ? "partial" : "todo";
}

/** Where the scout screen opens: the first match after the last one done or partly done (so a skipped match stays behind), else the first not done. -1: no schedule. */
export function nextMatchIndex(schedule: readonly ScheduleMatch[], w: Watching, scouted: Map<string, Set<number>>): number {
  if (!schedule.length) return -1;
  let last = -1;
  schedule.forEach((m, i) => { if (matchProgress(m, w, scouted) !== "todo") last = i; });
  if (last >= 0 && last < schedule.length - 1) return last + 1;
  const open = schedule.findIndex((m) => matchProgress(m, w, scouted) !== "done");
  return open === -1 ? schedule.length - 1 : open;
}
