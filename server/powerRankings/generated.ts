// The automatically published weeks (table power_rankings_generated, written by ./auto.ts), read back
// as the same RankingDoc shape a markdown file parses to, so the pages, archive, SEO, sitemap and
// boot-shell HTML serve both alike (./store.ts merges them; a hand-written file for the week wins).
import { all, get, run } from "../db.js";
import { registerCache } from "../caches.js";
import type { BlurbAuthor } from "../../src/shared/powerRankings.js";
import type { RankingDoc } from "./format.js";
import type { PacketTeam, StoredPacket } from "./factCheck.js";
import type { Movement, PowerRankingsStats } from "../../src/shared/powerRankings.js";

export type GeneratedStatus = "pending" | "published" | "hidden";

export interface GeneratedEntry {
  rank: number;
  team: number;
  text: string;
  source: BlurbAuthor;
  /** Why Bruno's blurb was replaced by the template (fact-check reasons), for the owner portal. */
  rejected?: string[];
}

export interface GeneratedWeek {
  season: number;
  week: string;
  published: string;
  /** The New York date of its last daily check (./refresh.ts), null when never checked since it went out. */
  updated: string | null;
  /** Owner-written blurbs of teams a daily check took out of the list, kept for if they come back this week. */
  parked: { team: number; text: string }[];
  status: GeneratedStatus;
  intro: string;
  introSource: BlurbAuthor;
  entries: GeneratedEntry[];
  packet: StoredPacket;
  generatedAt: string;
  editedBy: string | null;
  editedAt: string | null;
  /** The row's version: +1 on every write. */
  rev: number;
}

interface Row {
  season: number; week: string; published: string; updated: string | null; parked: string | null; status: string; intro: string; intro_source: string;
  entries: string; packet: string; generated_at: string; edited_by: string | null; edited_at: string | null; rev: number;
}

const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

function fromRow(r: Row): GeneratedWeek {
  return {
    season: Number(r.season), week: r.week, published: r.published, updated: r.updated ?? null, parked: parse<{ team: number; text: string }[]>(r.parked ?? "[]", []), status: r.status as GeneratedStatus,
    intro: r.intro, introSource: r.intro_source as BlurbAuthor, entries: parse<GeneratedEntry[]>(r.entries, []),
    packet: parse<StoredPacket>(r.packet, { season: Number(r.season), week: r.week, teams: [], comparedWith: null }),
    generatedAt: r.generated_at, editedBy: r.edited_by, editedAt: r.edited_at, rev: Number(r.rev ?? 0),
  };
}

/** Every generated week (any status), oldest first. */
export async function listGenerated(): Promise<GeneratedWeek[]> {
  return (await all<Row>("SELECT * FROM power_rankings_generated ORDER BY week, season")).map(fromRow);
}

export async function getGenerated(season: number, week: string): Promise<GeneratedWeek | null> {
  const r = await get<Row>("SELECT * FROM power_rankings_generated WHERE season = ? AND week = ?", [season, week]);
  return r ? fromRow(r) : null;
}

/** "Power rankings, week 43" (as the scaffold titles a hand-written week). */
export const generatedTitle = (week: string) => `Power rankings, week ${Number(week.slice(6))}`;

/** A team's movement as frozen in the packet (what its blurb was written from). */
function frozenMovement(t: PacketTeam | undefined, compared: boolean): Movement | null {
  if (!compared || !t) return null;
  if (t.movement == null) return t.priorRank == null ? { kind: "new" } : null;
  return t.movement > 0 ? { kind: "up", by: t.movement } : t.movement < 0 ? { kind: "down", by: -t.movement } : { kind: "same" };
}

/**
 * What a team's line shows, from the packet its blurb was written from (never the live numbers): the
 * name, the rating and its world rank (the packet's rank is the team's place in the live world ranking
 * then), the OPR and the record. The packet is rebuilt only by the current week's daily check
 * (./refresh.ts), so a past week's lines are frozen with its text.
 */
export function shownOf(t: PacketTeam | undefined): { name: string | null; stats: PowerRankingsStats | null } {
  if (!t) return { name: null, stats: null };
  const name = t.name.trim() && t.name !== `Team ${t.team}` ? t.name : null;
  const r = t.record;
  return {
    name,
    stats: r && r.wins + r.losses + r.ties > 0
      ? { rating: t.rating, ratingRank: t.rank, opr: t.opr, wins: r.wins, losses: r.losses, ties: r.ties }
      : null,
  };
}

/**
 * A published generated week as a RankingDoc (its text is plain: rendered escaped, never as markdown).
 * Its movement is the frozen one, so arrows and blurbs agree even if the earlier week changes later.
 */
export function toDoc(g: GeneratedWeek): RankingDoc {
  const byTeam = new Map(g.packet.teams.map((t) => [t.team, t]));
  const compared = !!g.packet.comparedWith;
  return {
    week: g.week, season: g.season, title: generatedTitle(g.week), published: g.published, intro: g.intro, sample: false,
    entries: g.entries.map((e) => ({ rank: e.rank, team: e.team, blurb: e.text, movement: frozenMovement(byTeam.get(e.team), compared) })),
    generated: {
      introSource: g.introSource, sources: g.entries.map((e) => e.source), rev: revOf(g), updated: g.updated,
      comparedWith: g.packet.comparedWith ?? null, droppedOut: (g.packet.droppedOut ?? []).map((d) => ({ team: d.team, lastRank: d.lastRank })),
      dataSeason: Number(g.packet.season ?? g.season), shown: g.entries.map((e) => shownOf(byTeam.get(e.team))),
    },
  };
}

// The published rows, for a few seconds (every page view reads them); a write here drops them at once.
let cache: { at: number; docs: Promise<RankingDoc[]> } | null = null;
export function invalidateGenerated() { cache = null; }
registerCache("Generated power rankings", invalidateGenerated);

/** The published generated weeks as RankingDocs, oldest first. */
export function generatedDocs(): Promise<RankingDoc[]> {
  if (cache && Date.now() - cache.at < 15_000) return cache.docs;
  const docs = all<Row>("SELECT * FROM power_rankings_generated WHERE status = 'published' ORDER BY week, season")
    .then((rows) => rows.map((r) => toDoc(fromRow(r))))
    // No table yet (a database before migration 28) or a read error: no generated weeks, never a broken page.
    .catch((e) => { console.warn(`[power-rankings] generated weeks unavailable: ${(e as Error).message}`); cache = null; return [] as RankingDoc[]; });
  cache = { at: Date.now(), docs };
  return docs;
}

/** A week's version: changes with every write (generation, regeneration, edit, hide/show). */
export const revOf = (g: Pick<GeneratedWeek, "rev">) => String(g.rev);

/**
 * Owner edit: replace the intro and/or some blurbs (each becomes the owner's). `rev`: the version the
 * editor opened (revOf); if the week changed since (another save, a regeneration), nothing is written
 * and "conflict" comes back, so two overlapping saves can never undo each other.
 */
export async function editGenerated(season: number, week: string, change: { intro?: string; blurbs?: { team: number; text: string }[] }, rev: string, at = new Date().toISOString()): Promise<GeneratedWeek | "conflict" | null> {
  const g = await getGenerated(season, week);
  if (!g || g.status === "pending") return null;
  if (revOf(g) !== rev) return "conflict";
  const intro = change.intro ?? g.intro;
  const introSource = change.intro != null && change.intro !== g.intro ? "owner" : g.introSource;
  const byTeam = new Map((change.blurbs ?? []).map((b) => [b.team, b.text]));
  const entries = g.entries.map((e) => {
    const text = byTeam.get(e.team);
    return text != null && text !== e.text ? { rank: e.rank, team: e.team, text, source: "owner" as const } : e;
  });
  // The version guard makes read-change-write safe: a save that raced another loses, visibly.
  const n = await run(`UPDATE power_rankings_generated SET intro = ?, intro_source = ?, entries = ?, edited_by = 'owner', edited_at = ?, rev = rev + 1 WHERE season = ? AND week = ? AND rev = ?`,
    [intro, introSource, JSON.stringify(entries), at, season, week, Number(rev)]);
  invalidateGenerated();
  return n ? getGenerated(season, week) : "conflict";
}

/** Owner: hide a published week, or show a hidden one again. */
export async function setGeneratedStatus(season: number, week: string, status: "published" | "hidden", at = new Date().toISOString()): Promise<GeneratedWeek | null> {
  const n = await run("UPDATE power_rankings_generated SET status = ?, edited_by = 'owner', edited_at = ?, rev = rev + 1 WHERE season = ? AND week = ? AND status IN ('published', 'hidden')", [status, at, season, week]);
  invalidateGenerated();
  return n ? getGenerated(season, week) : null;
}
