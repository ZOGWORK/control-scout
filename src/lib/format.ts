// Formatting helpers shared by every page.

export const pct = (p: number | null | undefined, digits = 0) => (p == null || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(digits)}%`);

/**
 * Probabilities never show as a flat 0% / 100% — a simulation that never (or
 * always) saw an outcome hasn't proven it impossible (or certain) — so they
 * stop at 1% and 99%, shown as plain percentages (no "<" / ">"). Pass
 * `decided` only when the outcome has actually happened.
 */
export function oddsPct(p: number | null | undefined, decided = false): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (!decided && p < 0.015) return "1%";
  if (!decided && p > 0.985) return "99%";
  return `${Math.round(p * 100)}%`;
}

export const num = (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(digits).replace(/\.0+$/, ""));
export const int = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString());

/**
 * Where a rank out of n sits, as a share of teams: "top 4%" (the share ranked at or above it) up to
 * and including 50%; past that, "bottom 9%" (the share ranked at or below it), so a low rank never
 * reads "top 91%". `capital` starts it with a capital letter ("Top 4%"). No rank → null.
 */
export function rankPct(rank: number | null | undefined, of: number | null | undefined, capital = false): string | null {
  if (!rank || !of || rank < 1) return null;
  const r = Math.min(rank, of);
  const share = (n: number) => Math.max(1, Math.ceil((n * 100) / of)); // multiply first: (7 / 100) * 100 is 7.000000000000001
  const top = share(r); // teams ranked r or better
  const label = top <= 50 || r === 1 ? `top ${top}%` : `bottom ${share(of - r + 1)}%`; // teams ranked r or worse
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

export const place = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(", ");

/** Match time (FIRST: event-local, no zone) → "Sat 10:42". */
export function matchTime(t: string | null | undefined): string {
  if (!t) return "";
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(t);
  const d = new Date(hasZone ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit", ...(hasZone ? {} : { timeZone: "UTC" }) };
  return d.toLocaleString(undefined, opts);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** To the second, for live freshness: "just now", "40 s ago", "3 min ago" (then like ago()). */
export function agoSeconds(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return ago(iso);
}

/** Short relative time for attributions: "just now", "2m ago", "3h ago", "4d ago", then the date. */
export function agoShort(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(ms).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}

export const seasonLabel =(s: number) => `${s}–${String((s + 1) % 100).padStart(2, "0")}`;

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
