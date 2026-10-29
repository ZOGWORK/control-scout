// The home page's hero lines (the headline that changes every 10 minutes): what the owner console edits
// (server/heroLines.ts, table hero_lines) and what the home page and its server first paint show.
// Each line has two parts: the plain words, then the words in the accent colour on their own line.
// With no line saved, or none switched on, or the database out of reach, the built-in HOME_HEADLINES show.
import { HOME_HEADLINES } from "./boot.js";

/** A line as the home page draws it: [plain part, accent part]. */
export type HeroLine = readonly [string, string];

/** Longest part, in characters: the longest built-in part is 25, and the hero is sized to its longest line. */
export const HERO_PART_MAX = 40;
/** Most lines kept (one every 10 minutes: eight hours' worth). */
export const HERO_LINES_MAX = 48;

/** The built-in lines, used whenever no saved line is switched on. */
export const DEFAULT_HERO_LINES: readonly HeroLine[] = HOME_HEADLINES;

/** One saved line, as the owner console lists it. */
export interface HeroLineRow {
  id: number;
  position: number;
  plain: string;
  accent: string;
  enabled: boolean;
  updatedAt: string;
}

/** GET /api/home/headlines: the lines the home page rotates through now (`custom`: the owner's, not the built-in ones). */
export interface HeroLinesResponse { lines: HeroLine[]; custom: boolean }

/** GET /api/owner/hero-lines. */
export interface OwnerHeroLines {
  /** Every saved line in order, on or off (empty: the built-in lines are in use). */
  rows: HeroLineRow[];
  /** What the home page shows now, and which of those lines is up now. */
  live: HeroLinesResponse & { index: number };
  defaults: HeroLine[];
}

/** Tidy one part: single spaces, no line breaks, trimmed. */
export const cleanHeroPart = (s: string) => s.replace(/\s+/g, " ").trim();

/** Why a line can't be saved, or null when it can. */
export function heroLineProblem(plain: unknown, accent: unknown): string | null {
  if (typeof plain !== "string" || typeof accent !== "string") return "A line needs a plain part and a coloured part.";
  const p = cleanHeroPart(plain), a = cleanHeroPart(accent);
  if (!p || !a) return "Both parts need some words.";
  if (p.length > HERO_PART_MAX || a.length > HERO_PART_MAX) return `Each part can be up to ${HERO_PART_MAX} characters.`;
  return null;
}

/** A list of lines read from somewhere untrusted (the first paint's JSON, an API answer): valid lines only, or null. */
export function heroLinesFrom(x: unknown): HeroLine[] | null {
  if (!Array.isArray(x) || !x.length || x.length > HERO_LINES_MAX) return null;
  const out: HeroLine[] = [];
  for (const l of x) {
    if (!Array.isArray(l) || l.length !== 2 || heroLineProblem(l[0], l[1])) return null;
    out.push([cleanHeroPart(l[0]), cleanHeroPart(l[1])]);
  }
  return out;
}

/** The id of the first paint's JSON block carrying the owner's lines (only when they're not the built-in ones). */
export const HERO_LINES_ID = "cs-hero";
