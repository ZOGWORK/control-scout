// Formatting helpers shared by every page.

export const pct = (p: number | null | undefined, digits = 0) => (p == null || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(digits)}%`);

/**
 * Probabilities never show as a flat 0% / 100% — a simulation that never (or
 * always) saw an outcome hasn't proven it impossible (or certain). Pass
 * `decided` only when the outcome has actually happened.
 */
export function oddsPct(p: number | null | undefined, decided = false): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (!decided && p < 0.005) return "<1%";
  if (!decided && p > 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

export const num = (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(digits).replace(/\.0+$/, ""));
export const int = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString());

/** "top 4%" from a rank out of n. */
export function topPct(rank: number | null | undefined, of: number | null | undefined): string | null {
  if (!rank || !of) return null;
  const pc = Math.max(1, Math.ceil((rank / of) * 100));
  return `top ${pc}%`;
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
