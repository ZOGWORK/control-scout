// The power-rankings file format (docs/power-rankings.md): parse, validate, compare weeks, scaffold.
//
//   ---
//   title: Power rankings, week 42
//   season: 2025
//   week: 2026-w42
//   published: 2026-10-19
//   intro: |
//     A paragraph or two of markdown.
//   ---
//
//   ## 1. 4215 Hypnotic Robotics
//   The blurb, in markdown.
//
//   ## 2. 18360 {+3}
//   …
//
// An entry's heading is "## <rank>. <team number>", then anything (the team's name, to make
// the file easy to read: ignored, the live name is shown), then optionally the author's own
// movement in braces ({+3}, {-2}, {=}, {new}), used only for a season's first week (later
// weeks compute it from the previous file). Pure: no files, no database.
import { POWER_RANKINGS_SIZE, isWeekId, type BlurbAuthor, type Movement, type PowerRankingsStats } from "../../src/shared/powerRankings.js";

export interface RankingEntry { rank: number; team: number; blurb: string; movement: Movement | null }

export interface RankingDoc {
  week: string;
  season: number;
  title: string;
  published: string;
  intro: string;
  sample: boolean;
  entries: RankingEntry[];
  /**
   * Set for an automatically published week (./generated.ts): its intro and blurbs are plain text,
   * each with who wrote it; `rev` changes with every edit. Absent for a markdown file.
   */
  generated?: {
    introSource: BlurbAuthor;
    sources: BlurbAuthor[];
    rev: string;
    /** The New York date of its last daily check, when there was one (only the current week is checked). */
    updated: string | null;
    /** The week its movement (in `entries`) was frozen against, and the teams that dropped out then. */
    comparedWith: string | null;
    droppedOut: { team: number; lastRank: number }[];
    /** The season its numbers come from (the packet's), when it isn't `season` (week 2026-w42 ranked on 2025–26). */
    dataSeason: number;
    /** Each entry's name and numbers as the week was written (its packet), in entry order: what the page shows,
     *  so the heading, the stat line, the order and the blurb always agree and a past week never changes. */
    shown: { name: string | null; stats: PowerRankingsStats | null }[];
  };
}

export type ParseResult = { ok: true; doc: RankingDoc } | { ok: false; errors: string[] };

/** Most a blurb may be (characters of markdown): they're meant to be short. */
export const BLURB_MAX = 700;
export const INTRO_MAX = 1500;
const KEYS = new Set(["title", "season", "week", "published", "intro", "sample"]);
const REQUIRED = ["title", "season", "week", "published", "intro"];

/** A front-matter block: "key: value" lines, a value in quotes, or "key: |" and indented lines below. */
function frontMatter(block: string, errors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!m) { errors.push(`front-matter line ${i + 2}: expected "key: value", got "${line.trim()}"`); continue; }
    const key = m[1].toLowerCase();
    let value = m[2].trim();
    if (!KEYS.has(key)) { errors.push(`front-matter: unknown key "${m[1]}" (expected ${[...KEYS].join(", ")})`); continue; }
    if (key in out) { errors.push(`front-matter: "${key}" is given twice`); continue; }
    if (value === "|" || value === ">") {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i]);
      const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
      const body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n").trim();
      value = value === ">" ? body.replace(/\n(?!\n)/g, " ") : body;
    } else if (/^(["']).*\1$/.test(value) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const MOVE = /\{\s*(new|=|[+-]\d{1,3})\s*\}\s*$/i;
function parseMovement(s: string): Movement {
  const v = s.toLowerCase();
  if (v === "new") return { kind: "new" };
  if (v === "=" || Number(v) === 0) return { kind: "same" };
  const n = Number(v);
  return n > 0 ? { kind: "up", by: n } : { kind: "down", by: -n };
}

/** Is this a real calendar date, "YYYY-MM-DD"? */
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * Parse and validate one file. `file` is its name ("2026-w42.md"): the week in it must match.
 * Every problem is reported at once, each naming where it is, so an author can fix them in one go.
 */
export function parseRankings(text: string, file: string): ParseResult {
  const errors: string[] = [];
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!fm) return { ok: false, errors: [`${file}: the file must start with front-matter between two "---" lines`] };
  const meta = frontMatter(fm[1], errors);
  for (const k of REQUIRED) if (!meta[k]) errors.push(`front-matter: "${k}" is missing`);

  const fileWeek = file.replace(/^.*[\\/]/, "").replace(/\.md$/i, "");
  const week = (meta.week ?? "").toLowerCase();
  if (meta.week && !isWeekId(week)) errors.push(`front-matter: week "${meta.week}" isn't an ISO week like 2026-w42`);
  else if (meta.week && week !== fileWeek) errors.push(`front-matter: week ${week} doesn't match the file name (${fileWeek}.md)`);
  const season = Number(meta.season);
  if (meta.season && !(/^\d{4}$/.test(meta.season) && season >= 2019 && season <= 2100)) errors.push(`front-matter: season "${meta.season}" must be a year like 2025 (the season's first year)`);
  if (meta.published && !isDate(meta.published)) errors.push(`front-matter: published "${meta.published}" must be a date like 2026-10-19`);
  if (meta.title && meta.title.length > 120) errors.push(`front-matter: the title is ${meta.title.length} characters (at most 120)`);
  if (meta.intro && meta.intro.length > INTRO_MAX) errors.push(`front-matter: the intro is ${meta.intro.length} characters (at most ${INTRO_MAX})`);
  if (meta.intro && /\bTODO\b/.test(meta.intro)) errors.push(`front-matter: the intro still says TODO`);
  if (meta.sample &&!/^(true|false)$/.test(meta.sample)) errors.push(`front-matter: sample must be true or false`);

  // The body: "## " headings start entries; nothing else may come before the first.
  const body = src.slice(fm[0].length);
  const bodyStart = src.slice(0, fm[0].length).split("\n").length; // the body's first line number
  const lines = body.split("\n");
  const entries: RankingEntry[] = [];
  let current: { entry: RankingEntry; line: number; text: string[] } | null = null;
  const finish = () => {
    if (!current) return;
    const blurb = current.text.join("\n").trim();
    const where = `entry #${current.entry.rank} (line ${current.line})`;
    if (!blurb) errors.push(`${where}: the blurb is empty`);
    else if (/\bTODO\b/.test(blurb)) errors.push(`${where}: the blurb still says TODO`);
    else if (blurb.length > BLURB_MAX) errors.push(`${where}: the blurb is ${blurb.length} characters (at most ${BLURB_MAX})`);
    entries.push({ ...current.entry, blurb });
    current = null;
  };
  lines.forEach((line, i) => {
    const n = bodyStart + i;
    if (/^##\s/.test(line)) {
      finish();
      // The number ends at a space or the end ("19066.5" or "4215x" is no team, never team 19066 or 4215).
      const h = /^##\s+(\d+)\.\s+(?:team\s+)?(\d+)(?=\s|$)(.*)$/i.exec(line.trim());
      if (!h) { errors.push(`line ${n}: an entry heading must look like "## 1. 4215" (got "${line.trim()}")`); current = { entry: { rank: NaN, team: NaN, blurb: "", movement: null }, line: n, text: [] }; return; }
      const rank = Number(h[1]), team = Number(h[2]);
      if (!(team >= 1 && team <= 999_999)) errors.push(`line ${n}: ${h[2]} isn't a valid FTC team number (1 to 999999)`);
      const mv = MOVE.exec(h[3]);
      current = { entry: { rank, team, blurb: "", movement: mv ? parseMovement(mv[1]) : null }, line: n, text: [] };
      return;
    }
    if (current) current.text.push(line);
    else if (line.trim()) errors.push(`line ${n}: text before the first entry (put it in the intro, or start the entry with "## 1. <team>")`);
  });
  finish();

  if (entries.length !== POWER_RANKINGS_SIZE) errors.push(`found ${entries.length} entries; a week has exactly ${POWER_RANKINGS_SIZE}`);
  entries.forEach((e, i) => {
    if (Number.isFinite(e.rank) && e.rank !== i + 1) errors.push(`entry ${i + 1} is numbered ${e.rank}: entries go 1 to ${POWER_RANKINGS_SIZE} in order`);
  });
  const seen = new Map<number, number>();
  for (const e of entries) {
    if (!Number.isFinite(e.team)) continue;
    const at = seen.get(e.team);
    if (at != null) errors.push(`team ${e.team} is listed twice (#${at} and #${e.rank})`);
    else seen.set(e.team, e.rank);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    doc: { week, season, title: meta.title, published: meta.published, intro: meta.intro, sample: meta.sample === "true", entries },
  };
}

/**
 * Each entry's movement against the previous week's list (same season): up/down by the places
 * it moved, the same place, or new. With no previous week, the author's own note (or none).
 */
export function movements(doc: Pick<RankingDoc, "entries">, previous: Pick<RankingDoc, "entries"> | null): (Movement | null)[] {
  if (!previous) return doc.entries.map((e) => e.movement);
  const before = new Map(previous.entries.map((e) => [e.team, e.rank]));
  return doc.entries.map((e) => {
    const was = before.get(e.team);
    if (was == null) return { kind: "new" };
    if (was === e.rank) return { kind: "same" };
    return was > e.rank ? { kind: "up", by: was - e.rank } : { kind: "down", by: e.rank - was };
  });
}

/** The previous week's teams that this week leaves out, in their old order. */
export function droppedOut(doc: Pick<RankingDoc, "entries">, previous: Pick<RankingDoc, "entries"> | null): { team: number; lastRank: number }[] {
  if (!previous) return [];
  const now = new Set(doc.entries.map((e) => e.team));
  return previous.entries.filter((e) => !now.has(e.team)).map((e) => ({ team: e.team, lastRank: e.rank }));
}

export interface ScaffoldTeam { team: number; name: string | null; rating: number | null; opr: number | null; wins: number; losses: number; ties: number }

const one = (x: number | null) => (x == null ? "–" : x.toFixed(1));

/**
 * A new week's file with the top teams filled in (npm run power-rankings:new): every blurb is a
 * TODO line with the team's numbers for reference, which the validator refuses until it's written.
 */
export function scaffold(o: { week: string; season: number; published: string; teams: ScaffoldTeam[] }): string {
  const n = Number(o.week.slice(6));
  const head = [
    "---",
    `title: Power rankings, week ${n}`,
    `season: ${o.season}`,
    `week: ${o.week}`,
    `published: ${o.published}`,
    "intro: |",
    "  TODO: a paragraph on the week: what changed at the top, who moved and why.",
    "---",
    "",
  ];
  const entries = o.teams.slice(0, POWER_RANKINGS_SIZE).map((t, i) => [
    `## ${i + 1}. ${t.team}${t.name ? ` ${t.name.replace(/[{}\n]/g, "")}` : ""}`,
    `TODO: blurb. (Rating ${one(t.rating)}, OPR ${one(t.opr)}, record ${t.wins}-${t.losses}-${t.ties}.)`,
    "",
  ].join("\n"));
  return `${head.join("\n")}\n${entries.join("\n")}`;
}
