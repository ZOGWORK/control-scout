// The automatically published weeks (table power_rankings_generated, written by ./auto.ts), read back
// as the same RankingDoc shape a markdown file parses to, so the pages, archive, SEO, sitemap and
// boot-shell HTML serve both alike (./store.ts merges them; a hand-written file for the week wins).
import { all, get, run } from "../db.js";
import { registerCache } from "../caches.js";
import type { BlurbAuthor } from "../../src/shared/powerRankings.js";
import type { RankingDoc } from "./format.js";
import type { FactPacket } from "./factCheck.js";

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
  status: GeneratedStatus;
  intro: string;
  introSource: BlurbAuthor;
  entries: GeneratedEntry[];
  packet: FactPacket;
  generatedAt: string;
  editedBy: string | null;
  editedAt: string | null;
}

interface Row {
  season: number; week: string; published: string; status: string; intro: string; intro_source: string;
  entries: string; packet: string; generated_at: string; edited_by: string | null; edited_at: string | null;
}

const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

function fromRow(r: Row): GeneratedWeek {
  return {
    season: Number(r.season), week: r.week, published: r.published, status: r.status as GeneratedStatus,
    intro: r.intro, introSource: r.intro_source as BlurbAuthor, entries: parse<GeneratedEntry[]>(r.entries, []),
    packet: parse<FactPacket>(r.packet, { season: Number(r.season), week: r.week, teams: [] }),
    generatedAt: r.generated_at, editedBy: r.edited_by, editedAt: r.edited_at,
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

/** A published generated week as a RankingDoc (its text is plain: rendered escaped, never as markdown). */
export function toDoc(g: GeneratedWeek): RankingDoc {
  return {
    week: g.week, season: g.season, title: generatedTitle(g.week), published: g.published, intro: g.intro, sample: false,
    entries: g.entries.map((e) => ({ rank: e.rank, team: e.team, blurb: e.text, movement: null })),
    generated: { introSource: g.introSource, sources: g.entries.map((e) => e.source), rev: g.editedAt ?? g.generatedAt },
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

/** Owner edit: replace the intro and/or some blurbs (each becomes the owner's). */
export async function editGenerated(season: number, week: string, change: { intro?: string; blurbs?: { team: number; text: string }[] }, at = new Date().toISOString()): Promise<GeneratedWeek | null> {
  const g = await getGenerated(season, week);
  if (!g || g.status === "pending") return null;
  const intro = change.intro ?? g.intro;
  const introSource = change.intro != null && change.intro !== g.intro ? "owner" : g.introSource;
  const byTeam = new Map((change.blurbs ?? []).map((b) => [b.team, b.text]));
  const entries = g.entries.map((e) => {
    const text = byTeam.get(e.team);
    return text != null && text !== e.text ? { rank: e.rank, team: e.team, text, source: "owner" as const } : e;
  });
  await run("UPDATE power_rankings_generated SET intro = ?, intro_source = ?, entries = ?, edited_by = 'owner', edited_at = ? WHERE season = ? AND week = ?",
    [intro, introSource, JSON.stringify(entries), at, season, week]);
  invalidateGenerated();
  return getGenerated(season, week);
}

/** Owner: hide a published week, or show a hidden one again. */
export async function setGeneratedStatus(season: number, week: string, status: "published" | "hidden", at = new Date().toISOString()): Promise<GeneratedWeek | null> {
  const n = await run("UPDATE power_rankings_generated SET status = ?, edited_by = 'owner', edited_at = ? WHERE season = ? AND week = ? AND status IN ('published', 'hidden')", [status, at, season, week]);
  invalidateGenerated();
  return n ? getGenerated(season, week) : null;
}
