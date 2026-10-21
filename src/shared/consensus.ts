// Scout consensus (v1.6 Task 1): one workspace's entries on one team in one season, rolled up into what
// the team's scouts agree on. Pure, so the server (server/scout/consensus.ts) and tests share it.
// Docs: docs/shared-accounts.md, "Scout consensus".
//
// Rules:
// - Input: the workspace's live (non-deleted) entries for the team and season, each read with the fields
//   of the template it was made with (its own template version, or the built-in default). Entries of
//   another workspace never get here: the server reads one workspace at a time.
// - Answers are grouped by kind ("match" / "pit") and field id across template versions, so an admin's
//   later template change (a new label, a wider rating scale) doesn't split one field in two. The label
//   shown is the one from the most recently updated entry that has the field.
// - Numbers:
//   - rating fields: the average of the answers given (0 = not rated, skipped). An entry rated on another
//     scale counts in proportion: each answer is placed on 1..max of its own template, then the average
//     is put on the newest template's scale (`max`).
//   - counter fields: the plain average of the answers given.
//   Match fields come before pit fields, each in the newest entry's field order.
// - Strengths and weaknesses come from the ratings: an answer in the top quarter of its scale (4 or 5 of
//   5) counts that field as a strength once, one in the bottom quarter (1 or 2 of 5) as a weakness once.
//   Each list is the fields with the most such answers, top CONSENSUS_TOP_TAGS, with their counts.
// - Tags: a choice's answer ("End park: Full") and a yes / no field answered yes ("Played defense"),
//   counted once per entry, top CONSENSUS_TOP_TAGS by count. Text answers are never aggregated.
// - entries: live entries counted (match + pit); scouts: distinct authors; lastUpdated: the newest
//   live entry's updatedAt (ms), null with no entries.
import type { ScoutField, TemplateKind } from "./scoutTemplate";
import { isFailureField, type ReliabilityNotes } from "./reliability";

export const CONSENSUS_TOP_TAGS = 5;
/** Teams per consensus request (compare shows 4, a match report 4: room to spare, never a whole event). */
export const CONSENSUS_MAX_TEAMS = 24;

/** One averaged field. */
export interface ConsensusNumber {
  kind: TemplateKind; id: string; label: string; type: "rating" | "counter";
  /** The average, on the field's newest scale (ratings) or as answered (counters). */
  avg: number;
  /** A rating's scale (1..max); absent for counters. */
  max?: number;
  /** Answers averaged. */
  n: number;
}
export interface ConsensusTag { label: string; count: number }

export interface TeamConsensus {
  team: number;
  entries: number; matchEntries: number; pitEntries: number;
  scouts: number;
  lastUpdated: number | null;
  ratings: ConsensusNumber[];
  counters: ConsensusNumber[];
  strengths: ConsensusTag[];
  weaknesses: ConsensusTag[];
  tags: ConsensusTag[];
  /**
   * Reliability notes: match entries, and how many marked the robot broken / disabled / no-show (a yes/no field
   * whose label says so, like the built-in "Broke down / disabled"). Feeds the blended reliability index this
   * workspace's members see. Present only when the workspace has match entries on the team.
   */
  reliabilityNotes?: ReliabilityNotes;
}

/** GET /api/scout/workspaces/:id/consensus: one per team asked for, in the order asked. */
export interface ConsensusResponse { workspaceId: string; season: number; teams: TeamConsensus[] }

/** An entry as the aggregation reads it (with the fields of the template it was made with). */
export interface ConsensusEntry {
  team: number; kind: TemplateKind; authorAccountId: number; updatedAt: number;
  data: Record<string, unknown>;
  fields: ScoutField[];
}

export const emptyConsensus = (team: number): TeamConsensus => ({
  team, entries: 0, matchEntries: 0, pitEntries: 0, scouts: 0, lastUpdated: null, ratings: [], counters: [], strengths: [], weaknesses: [], tags: [],
});

const STRONG = 0.75, WEAK = 0.25;

/** The consensus of one team's entries (all of one workspace and season). */
export function aggregateConsensus(team: number, entries: ConsensusEntry[], top = CONSENSUS_TOP_TAGS): TeamConsensus {
  const out = emptyConsensus(team);
  if (!entries.length) return out;
  // Newest first: the first label seen for a field is the newest one.
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  type Num = { kind: TemplateKind; id: string; label: string; type: "rating" | "counter"; max?: number; sum: number; n: number };
  const nums = new Map<string, Num>();
  // A field's label: the newest entry's that has the field (entries go newest first), even when an older one
  // gave the answer being counted.
  const labels = new Map<string, string>();
  const scales = new Map<string, number>(); // a rating's newest scale, likewise
  type Tag = { field: string; option?: string; count: number; order: number };
  const tally = (m: Map<string, Tag>, field: string, option?: string) => {
    const key = option === undefined ? field : `${field}=${option}`;
    const t = m.get(key);
    if (t) t.count++; else m.set(key, { field, ...(option === undefined ? {} : { option }), count: 1, order: m.size });
  };
  const strengths = new Map<string, Tag>(), weaknesses = new Map<string, Tag>(), tags = new Map<string, Tag>();
  const authors = new Set<number>();
  let flagged = 0;
  for (const e of sorted) {
    out.entries++;
    if (e.kind === "match" && e.fields.some((f) => isFailureField(f) && e.data[f.id] === true)) flagged++;
    if (e.kind === "pit") out.pitEntries++; else out.matchEntries++;
    authors.add(e.authorAccountId);
    out.lastUpdated = Math.max(out.lastUpdated ?? 0, e.updatedAt);
    for (const f of e.fields) {
      const v = e.data[f.id];
      const key = `${e.kind}:${f.id}`;
      if (!labels.has(key)) labels.set(key, f.label);
      if (f.type === "rating" && !scales.has(key)) scales.set(key, f.max ?? 5);
      if (f.type === "rating" || f.type === "counter") {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        let value = v;
        if (f.type === "rating") {
          const max = f.max ?? 5;
          if (v < 1 || max < 2) continue; // 0: not rated
          // 0..1 along this template's scale; mapped onto the newest scale below.
          const frac = (Math.min(v, max) - 1) / (max - 1);
          value = frac;
          if (frac >= STRONG) tally(strengths, key);
          if (frac <= WEAK) tally(weaknesses, key);
        }
        const k = `${key}:${f.type}`;
        const cur = nums.get(k);
        if (cur) { cur.sum += value; cur.n++; } else nums.set(k, { kind: e.kind, id: f.id, label: labels.get(key)!, type: f.type, ...(f.type === "rating" ? { max: scales.get(key)! } : {}), sum: value, n: 1 });
      } else if (f.type === "choice") {
        if (typeof v !== "string" || !v || !(f.options ?? []).includes(v)) continue;
        tally(tags, key, v);
      } else if (f.type === "toggle") {
        if (v === true) tally(tags, key);
      }
    }
  }
  const ranked = (m: Map<string, Tag>) => [...m.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, top)
    .map(({ field, option, count }) => ({ label: option === undefined ? labels.get(field)! : `${labels.get(field)}: ${option}`, count }));
  const round = (x: number) => Math.round(x * 100) / 100;
  for (const x of nums.values()) {
    const avg = x.type === "rating" ? 1 + (x.sum / x.n) * (x.max! - 1) : x.sum / x.n;
    const n: ConsensusNumber = { kind: x.kind, id: x.id, label: x.label, type: x.type, avg: round(avg), ...(x.max ? { max: x.max } : {}), n: x.n };
    (x.type === "rating" ? out.ratings : out.counters).push(n);
  }
  // Match fields first, then pit (each in the newest entry's field order).
  const byKind = (a: ConsensusNumber, b: ConsensusNumber) => Number(a.kind === "pit") - Number(b.kind === "pit");
  out.ratings.sort(byKind);
  out.counters.sort(byKind);
  out.scouts = authors.size;
  out.strengths = ranked(strengths);
  out.weaknesses = ranked(weaknesses);
  out.tags = ranked(tags);
  if (out.matchEntries) out.reliabilityNotes = { matchEntries: out.matchEntries, flagged };
  return out;
}
