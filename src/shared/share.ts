// Share cards for a matchup (server/share/card.ts draws them): the words on
// the card and the addresses that point at it. Shared by the server (the PNG
// and the link-preview tags) and the app (the share button), so the card, its
// alt text and the page that unfurls into it always say the same thing.

/**
 * A probability as a whole percentage, never a flat 0% / 100% before the
 * outcome is known: a simulation that never (or always) saw an outcome hasn't
 * proven it impossible (or certain), so it stops at 1% and 99%. Pass `decided`
 * only when the outcome has actually happened.
 */
export function oddsPct(p: number | null | undefined, decided = false): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (!decided && p < 0.015) return "1%";
  if (!decided && p > 0.985) return "99%";
  return `${Math.round(p * 100)}%`;
}

/** An alliance as people say it: "4215", "4215 & 16379", "4215, 16379 & 21058". */
export function allianceText(teams: readonly number[]): string {
  const t = teams.map(String);
  return t.length <= 1 ? (t[0] ?? "") : `${t.slice(0, -1).join(", ")} & ${t[t.length - 1]}`;
}

export interface ShareMatchup {
  red: readonly number[];
  blue: readonly number[];
  /** P(red wins). */
  pRed: number;
  /** P(blue wins); 1 − pRed when not given (no ties). */
  pBlue?: number;
  /** The match has been played: the call is in the past tense. */
  played?: boolean;
}

/** Who the card leads with: the favourite (red on an exact coin flip), with its chance and the other side. */
export function favourite(m: ShareMatchup): { side: "red" | "blue"; teams: readonly number[]; other: readonly number[]; p: number } {
  const pBlue = m.pBlue ?? 1 - m.pRed;
  return pBlue > m.pRed
    ? { side: "blue", teams: m.blue, other: m.red, p: pBlue }
    : { side: "red", teams: m.red, other: m.blue, p: m.pRed };
}

/** "Our model gives 4215 & 16379 a 73% win chance vs 33950 & 21058" ("gave" once the match is played). */
export function shareHeadline(m: ShareMatchup): string {
  const f = favourite(m);
  return `Our model ${m.played ? "gave" : "gives"} ${allianceText(f.teams)} a ${oddsPct(f.p)} win chance vs ${allianceText(f.other)}`;
}

/** A confidence tier in words, as the card says it ("high confidence"). */
const TIER_WORDS: Record<string, string> = { provisional: "provisional confidence", moderate: "moderate confidence", confident: "high confidence" };
export const tierWords = (t: string): string => TIER_WORDS[t] ?? `${t} confidence`;

export interface ShareCardQuery {
  season: number;
  red: readonly number[];
  blue: readonly number[];
  /** An event's code, for its name on the card. */
  event?: string;
  /** A match at that event, by its key (level:series:number): its own call, label and result. */
  match?: string;
  /** square: 1080×1080 (Instagram); landscape (the default) is 1200×630 (link previews). */
  format?: "landscape" | "square";
}

export const SHARE_SIZES = { landscape: { width: 1200, height: 630 }, square: { width: 1080, height: 1080 } } as const;

/** The card image's path: /api/share/match.png?season=…&red=…&blue=…[&event=…&match=…][&format=square]. */
export function shareImagePath(q: ShareCardQuery): string {
  const p = new URLSearchParams({ season: String(q.season), red: q.red.join(","), blue: q.blue.join(",") });
  if (q.event) p.set("event", q.event);
  if (q.event && q.match) p.set("match", q.match);
  if (q.format === "square") p.set("format", "square");
  return `/api/share/match.png?${p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":")}`;
}

/** The page a shared matchup links to: the match on its event page, or the matchup in the Predict Lab. */
export function sharePagePath(q: ShareCardQuery): string {
  if (q.event && q.match) return `/events/${q.season}/${encodeURIComponent(q.event)}?tab=matches&match=${encodeURIComponent(q.match)}`;
  return `/predict?mode=match&season=${q.season}&red=${q.red.join(",")}&blue=${q.blue.join(",")}`;
}

/** A file name for the downloaded card: control-scout-4215-16379-vs-33950-21058.png. */
export function shareFileName(q: ShareCardQuery): string {
  return `control-scout-${q.red.join("-")}-vs-${q.blue.join("-")}${q.format === "square" ? "-square" : ""}.png`;
}
