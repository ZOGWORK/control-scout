// Formatting helpers shared by the app's pages (src/lib/format.ts re-exports them) and the server's light pages
// (server/lite/render.ts), so a number or a date reads the same in both and the two never drift.

// Win odds: one rule for the app, the share cards and the light pages (src/shared/share.ts).
export { oddsPct } from "./share.js";

export const pct = (p: number | null | undefined, digits = 0) => (p == null || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(digits)}%`);

export const num = (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(digits).replace(/\.0+$/, ""));
export const int = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString());

/**
 * Where a rank out of n sits, as the share of teams ranked at or above it: "top 4%", and further
 * down "top 69%". Always "top", never "bottom": a team's own page shouldn't call it the bottom of
 * the field. `capital` starts it with a capital letter ("Top 4%"). No rank → null.
 */
export function rankPct(rank: number | null | undefined, of: number | null | undefined, capital = false): string | null {
  if (!rank || !of || rank < 1) return null;
  const r = Math.min(rank, of);
  const top = Math.max(1, Math.ceil((r * 100) / of)); // teams ranked r or better; multiply first: (7 / 100) * 100 is 7.000000000000001
  const label = `top ${top}%`;
  return capital ? label[0].toUpperCase() + label.slice(1) : label;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: string) => `${MONTH[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

export function dateRange(start: string | null | undefined, end?: string | null): string {
  if (!start) return "Date TBA";
  if (!end || end === start) return `${md(start)}, ${start.slice(0, 4)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${md(start)}–${Number(end.slice(8, 10))}, ${end.slice(0, 4)}`;
  return `${md(start)} – ${md(end)}, ${end.slice(0, 4)}`;
}

/** "Venue, City, State": each part trimmed of stray commas and spaces first (FIRST's data has venues like
 *  "Livingston High School,"), so the joined line never shows ",,". Empty parts drop out. */
export const place = (...xs: (string | null | undefined)[]) =>
  xs.map((x) => (x ?? "").replace(/^[\s,]+|[\s,]+$/g, "")).filter(Boolean).join(", ");

/** Match time (FIRST: event-local, no zone) → "Sat 10:42". */
export function matchTime(t: string | null | undefined): string {
  if (!t) return "";
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(t);
  const d = new Date(hasZone ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit", ...(hasZone ? {} : { timeZone: "UTC" }) };
  return d.toLocaleString(undefined, opts);
}

/** matchTime with the calendar date: "Sat, Nov 7, 9:30 AM" (a rescheduled match may move days, not just hours). */
export function matchDateTime(t: string | null | undefined): string {
  if (!t) return "";
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(t);
  const d = new Date(hasZone ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(hasZone ? {} : { timeZone: "UTC" }) });
}

export const seasonLabel = (s: number) => `${s}–${String((s + 1) % 100).padStart(2, "0")}`;

const AWARD_LABEL: Record<string, string> = {
  Inspire: "Inspire", Think: "Think", Connect: "Connect", Innovate: "Innovate", Control: "Control", Motivate: "Motivate", Design: "Design",
  Reach: "Reach", Sustain: "Sustain", JudgesChoice: "Judges' Choice", Compass: "Compass", DeansList: "Dean's List", Winner: "Winning Alliance",
  Finalist: "Finalist Alliance", Volunteer: "Volunteer",
};
export function awardLabel(type: string, placement: number): string {
  const base = AWARD_LABEL[type] ?? type;
  if (type === "Winner" || type === "Finalist") return base;
  return placement > 1 ? `${base} ${placement === 2 ? "2nd" : placement === 3 ? "3rd" : `${placement}th`}` : base;
}
