// Power rankings: a weekly top 25 with short written blurbs (docs/power-rankings.md).
// Each week is a markdown file in content/power-rankings/ (server/powerRankings/); these
// are the shapes the API sends and the week-id rules both sides share.

/** How many teams a week ranks. */
export const POWER_RANKINGS_SIZE = 25;

/** A week's id and URL segment: ISO year and week, "2026-w42". */
export const WEEK_ID = /^(\d{4})-w(\d{2})$/;

/** ISO weeks in a year: 53 when 28 December falls in week 53, else 52. */
export function isoWeeksInYear(year: number): number {
  return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;
}

/** The ISO week a date (UTC) falls in. */
export function isoWeekOf(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; // Monday 1 … Sunday 7
  t.setUTCDate(t.getUTCDate() + 4 - day); // the Thursday of this week decides its year
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7) };
}

/** "2026-w42" for a date (UTC). */
export const weekIdOf = (d: Date) => {
  const { year, week } = isoWeekOf(d);
  return `${year}-w${String(week).padStart(2, "0")}`;
};

/** A real ISO week id (lower case, as in the file names and URLs). */
export function isWeekId(s: string): boolean {
  const m = WEEK_ID.exec(s);
  if (!m) return false;
  const year = Number(m[1]), week = Number(m[2]);
  return year >= 2000 && year <= 2100 && week >= 1 && week <= isoWeeksInYear(year);
}

/** The Monday (UTC, "YYYY-MM-DD") a week id starts on. */
export function weekStart(id: string): string {
  const m = WEEK_ID.exec(id);
  if (!m) throw new Error(`not a week id: ${id}`);
  const year = Number(m[1]), week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = Date.UTC(year, 0, 4 - ((jan4.getUTCDay() || 7) - 1));
  return new Date(monday1 + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Movement against the previous published week: up/down by places, same place, or new to the list. */
export type Movement = { kind: "up" | "down"; by: number } | { kind: "same" } | { kind: "new" };

/** A team's live numbers for the week's season (null when it has no rated matches yet). */
export interface PowerRankingsStats {
  /** The engine's prediction rating (non-penalty points) and its place in the world. */
  rating: number | null;
  ratingRank: number | null;
  opr: number | null;
  wins: number;
  losses: number;
  ties: number;
}

export interface PowerRankingsEntry {
  rank: number;
  team: number;
  name: string | null;
  /** City, state/country, for the line under the name. */
  place: string | null;
  /** The blurb, as sanitized HTML (server/powerRankings/markdown.ts). */
  blurbHtml: string;
  /** Vs the previous published week of the same season; the author's own note when there is none; else null. */
  movement: Movement | null;
  stats: PowerRankingsStats | null;
  /** Who wrote the blurb of an automatically published week (null in a hand-written week). */
  author: BlurbAuthor | null;
}

/**
 * Who wrote a blurb or intro in an automatically published week: Bruno (Control Point's AI, its text
 * passed the fact check), the data-only template (Bruno was unavailable or its text failed the
 * check), or the owner (edited in the owner portal).
 */
export type BlurbAuthor = "bruno" | "template" | "owner";

/** One week in the archive list. */
export interface PowerRankingsSummary {
  week: string;
  season: number;
  title: string;
  published: string;
  /** The top three, for the archive line. */
  top: { team: number; name: string | null }[];
}

export interface PowerRankingsWeek {
  week: string;
  season: number;
  title: string;
  /** "YYYY-MM-DD". */
  published: string;
  /** The intro, as sanitized HTML; and as plain text (descriptions, previews). */
  introHtml: string;
  introText: string;
  /** A development sample (never served in production): the page says so. */
  sample: boolean;
  /** Published automatically (server/powerRankings/auto.ts): how many blurbs each author wrote; null for a hand-written week. */
  generated: { bruno: number; template: number; owner: number; intro: BlurbAuthor } | null;
  entries: PowerRankingsEntry[];
  /** The week its movement is measured against (the previous published week of the same season), if any. */
  comparedWith: string | null;
  /** The published weeks either side (any season), for older/newer links. */
  previous: string | null;
  next: string | null;
  /** Teams in the previous week's list that aren't in this one. */
  droppedOut: { team: number; name: string | null; lastRank: number }[];
  /** The world rankings (/rankings) for the week's season: as they stood that week when there's a
   *  weekly snapshot for its Monday, else the live list. */
  worldRankings: string;
}

/** GET /api/power-rankings (the latest week) and /api/power-rankings/:week. */
export interface PowerRankingsResponse {
  week: PowerRankingsWeek | null;
  /** Every published week, newest first. */
  archive: PowerRankingsSummary[];
}

/** "Friday, Oct 23" for a "YYYY-MM-DD" (the publish line under a week's title). */
export const publishedLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The line an automatically published week carries. Bruno is named only when he wrote some of it;
 * template blurbs are marked "Data summary" next to his (never labelled as his).
 */
export function generatedNote(g: NonNullable<PowerRankingsWeek["generated"]>): string {
  const byBruno = g.bruno > 0;
  if (!byBruno) return "Published automatically from this week's data.";
  return `Blurbs written by Bruno, Control Point's AI, from this week's data.${g.template > 0 ? " Those marked Data summary are built from the numbers alone." : ""}`;
}

/** The time zone automatic weeks are published in: Friday 00:00 there (server/powerRankings/schedule.ts). */
export const PUBLISH_TIME_ZONE = "America/New_York";

/** "Oct 12, 2026" for a "YYYY-MM-DD". */
export const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Week 42 · Oct 12–18, 2026" style label parts for a week id. */
export function weekLabel(id: string): string {
  const m = WEEK_ID.exec(id);
  if (!m) return id;
  const start = weekStart(id);
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const range = sameMonth
    ? `${fmt(start, { month: "short", day: "numeric" })}–${fmt(end, { day: "numeric" })}, ${end.slice(0, 4)}`
    : `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric", year: "numeric" })}`;
  return `Week ${Number(m[2])} · ${range}`;
}

/** "▲ 3", "▼ 2", "–", "New" (plain text, for share text and the static page). */
export function movementText(m: Movement | null): string {
  if (!m) return "";
  if (m.kind === "new") return "New";
  if (m.kind === "same") return "–";
  return `${m.kind === "up" ? "▲" : "▼"} ${m.by}`;
}
