// Automatic power rankings, the pure part: the fact packet Bruno writes from (the contract of Control
// Point's POST /internal/bruno/power-rankings), the fact check every blurb must pass before it's
// published, and the data-only templates that stand in when it doesn't. No database, no network.
//
// The fact check (docs/power-rankings.md, "How the fact check works"):
//   - every number in a blurb must be one of that team's packet values (rank, prior rank, movement,
//     rating, rating change, record, OPR, and numbers inside its name, last event and result), allowing
//     rounding (118 for 118.4) and a sign ("+12" for 12); numbers from the season and week are allowed
//     anywhere, and "top N" is fine when the team's rank is within N (N up to 25);
//   - digits with a suffix ("3rd", "#3", "9-1") count as numbers, and so do the words two to twenty
//     and second to tenth ("one" and "first" are too common in plain English to judge);
//   - a record written "9-1" or "9-1-0" must be the team's season record;
//   - any other number fails, so another team's number (in the packet or not) fails too;
//   - so does more than 60 words, and any mention of another scouting or stats site or a web address.
// A blurb that fails is replaced by templateBlurb(); an intro that fails by templateIntro().
import { POWER_RANKINGS_SIZE, publishedLabel } from "../../src/shared/powerRankings.js";

export interface PacketTeam {
  team: number;
  name: string;
  rank: number;
  /** Rank in the previous published week of the same season; null when new to the list (or no previous week). */
  priorRank: number | null;
  /** Places gained since then (negative: dropped); null when new or there's no previous week. */
  movement: number | null;
  rating: number;
  /** Rating change since the previous published week (when it recorded ratings); else null. */
  ratingDelta: number | null;
  record: { wins: number; losses: number; ties: number } | null;
  opr: number | null;
  lastEvent: { name: string; result: string | null } | null;
  notes?: string;
}

export interface FactPacket {
  season: number;
  week: string;
  teams: PacketTeam[];
  notes?: string;
}

/**
 * The packet as stored with a generated week: the facts Bruno saw plus what the page needs to show
 * the same comparison later (the week movement was counted against, and who dropped out then).
 */
export type StoredPacket = FactPacket & { comparedWith: string | null; droppedOut?: { team: number; lastRank: number }[] };

/** Bruno's answer (already shape-checked by Control Point; checked again here). */
export interface BrunoOutput { intro: string; blurbs: { team: number; text: string }[] }

export const MAX_WORDS = 60;
export const MAX_INTRO_WORDS = 100;

const SITES = [
  /ftc\s*-?\s*scout(?!\w)/i, /ftcscout/i, /orange\s+alliance/i, /\btoa\b/i, /ftc\s*-?\s*stats/i, /scoutradioz/i,
  /statbotics/i, /ftc\s*-?\s*events/i, /\bthe\s+blue\s+alliance\b/i, /\btba\b/i,
  /https?:\/\//i, /\bwww\./i, /\b[a-z0-9-]+\.(com|org|net|io|app|dev|gg|info|co)\b/i,
];

const WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** The numbers written in a text: digits (with "#", signs, decimals, thousands commas, ordinal suffixes) and number words. */
export function numbersIn(text: string): { value: number; raw: string; decimals: number }[] {
  const out: { value: number; raw: string; decimals: number }[] = [];
  // "9-1-0" is three numbers, not 9 and -1.
  const t = text.replace(/(\d)\s*[-–]\s*(?=\d)/g, "$1 ");
  for (const m of t.matchAll(/[+\-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[+\-−]?\d+(?:\.\d+)?/g)) {
    const raw = m[0];
    const clean = raw.replace(/[,+\-−]/g, "");
    out.push({ value: Number(clean), raw, decimals: clean.includes(".") ? clean.split(".")[1].length : 0 });
  }
  for (const m of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    if (m[0] in WORDS) out.push({ value: WORDS[m[0]], raw: m[0], decimals: 0 });
  }
  return out;
}

/** Does a written number stand for a known value (allowing rounding to what was written)? */
function matches(n: { value: number; decimals: number }, known: number[]): boolean {
  const tol = n.decimals === 0 ? 0.5 : 0.5 * 10 ** -n.decimals;
  return known.some((v) => Math.abs(Math.abs(v) - n.value) <= tol + 1e-9);
}

const packetNumbers = (p: FactPacket) => {
  const week = Number(p.week.slice(6));
  // "2025-26" and "2025–2026" for the season; the week number; the list's size.
  return [p.season, p.season + 1, (p.season + 1) % 100, week, POWER_RANKINGS_SIZE];
};

/** Every value a team's blurb may mention. */
export function teamNumbers(t: PacketTeam): number[] {
  const nums: number[] = [t.team, t.rank, t.rating];
  for (const v of [t.priorRank, t.movement, t.ratingDelta, t.opr]) if (v != null) nums.push(v);
  if (t.record) nums.push(t.record.wins, t.record.losses, t.record.ties, t.record.wins + t.record.losses + t.record.ties);
  for (const s of [t.name, t.lastEvent?.name, t.lastEvent?.result, t.notes]) if (s) nums.push(...numbersIn(s).map((n) => n.value));
  return nums;
}

export interface Check { ok: boolean; reasons: string[] }

function common(text: string, maxWords: number): string[] {
  const reasons: string[] = [];
  if (!text.trim()) reasons.push("empty");
  const words = wordCount(text);
  if (words > maxWords) reasons.push(`${words} words (at most ${maxWords})`);
  for (const re of SITES) if (re.test(text)) { reasons.push("mentions another site or a web address"); break; }
  return reasons;
}

/** "top 10" / "top ten": a claim about the rank (digits or a number word). */
const TOP = new RegExp(String.raw`\btop[\s-]+(\d{1,2}|${Object.keys(WORDS).join("|")})\b`, "gi");
const topValue = (w: string) => (/^\d+$/.test(w) ? Number(w) : WORDS[w.toLowerCase()] ?? NaN);

/** Each "top N" claim: true when the team is within it (and N is at most the list's size). */
function topClaims(text: string, rank: number | null): { ok: Set<string>; bad: string[] } {
  const ok = new Set<string>();
  const bad: string[] = [];
  for (const m of text.matchAll(TOP)) {
    const n = topValue(m[1]);
    if (n <= POWER_RANKINGS_SIZE && (rank == null || rank <= n)) ok.add(m[1].toLowerCase());
    else bad.push(`"${m[0]}"`);
  }
  return { ok, bad };
}

/** The text with each true "top N" claim reduced to "top" (so its N isn't checked again as a bare number). */
const withoutTrueTops = (text: string, ok: (n: string) => boolean) => text.replace(TOP, (all, n: string) => (ok(n) ? "top" : all));

const RECORD = /\b(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/g;

/** A "9-1" or "9-1-0" in a blurb is a record claim: it must be the team's season record. Returns the text without the records that match. */
function records(text: string, team: PacketTeam, reasons: string[]): string {
  return text.replace(RECORD, (all, w, l, t) => {
    const r = team.record;
    if (r && Number(w) === r.wins && Number(l) === r.losses && (t === undefined || Number(t) === r.ties)) return " ";
    reasons.push(`record "${all}" isn't the team's ${r ? `${r.wins}-${r.losses}-${r.ties}` : "(none)"}`);
    return " ";
  });
}

/** Check one blurb against its team's facts (and the packet's own season/week numbers). */
export function checkBlurb(text: string, team: PacketTeam, packet: FactPacket): Check {
  const reasons = common(text, MAX_WORDS);
  const known = [...teamNumbers(team), ...packetNumbers(packet)];
  const top = topClaims(text, team.rank);
  for (const b of top.bad) reasons.push(`${b} doesn't fit rank ${team.rank}`);
  // A false claim keeps its number, so it's reported as unknown too.
  const withoutTop = withoutTrueTops(text, (n) => top.ok.has(n.toLowerCase()));
  for (const n of numbersIn(records(withoutTop, team, reasons))) if (!matches(n, known)) reasons.push(`unknown number "${n.raw}"`);
  return { ok: reasons.length === 0, reasons };
}

/** Check the intro: any packet number, from any team, is fine there, and the publish date (`friday`, "YYYY-MM-DD"). */
export function checkIntro(text: string, packet: FactPacket, friday?: string): Check {
  const reasons = common(text, MAX_INTRO_WORDS);
  const known = [...packet.teams.flatMap(teamNumbers), ...packetNumbers(packet), ...(friday ? [Number(friday.slice(8, 10)), Number(friday.slice(0, 4))] : [])];
  const withoutTop = withoutTrueTops(text, (n) => topValue(n) <= POWER_RANKINGS_SIZE);
  for (const n of numbersIn(withoutTop)) if (!matches(n, known)) reasons.push(`unknown number "${n.raw}"`);
  return { ok: reasons.length === 0, reasons };
}

const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${one(Math.abs(x))}`;
const record = (r: NonNullable<PacketTeam["record"]>) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;

/**
 * A team's blurb from its numbers alone: "Up 4 to #3, 9-1 this season, last at the Texas Championship
 * (Winning alliance); rating 118.4 (+12.0), OPR 98.1." `compared`: there is a previous week, so a
 * team without a prior rank is new to the list.
 */
export function templateBlurb(t: PacketTeam, compared: boolean): string {
  const head = t.movement != null
    ? t.movement > 0 ? `Up ${t.movement} to #${t.rank}` : t.movement < 0 ? `Down ${-t.movement} to #${t.rank}` : `Holds #${t.rank}`
    : compared && t.priorRank == null ? `New to the top ${POWER_RANKINGS_SIZE} at #${t.rank}` : `#${t.rank}`;
  let s = head;
  if (t.record && t.record.wins + t.record.losses + t.record.ties > 0) s += `, ${record(t.record)} this season`;
  if (t.lastEvent) s += `, last at ${t.lastEvent.name}${t.lastEvent.result ? ` (${t.lastEvent.result})` : ""}`;
  s += `; rating ${one(t.rating)}${t.ratingDelta != null ? ` (${signed(t.ratingDelta)})` : ""}${t.opr != null ? `, OPR ${one(t.opr)}` : ""}.`;
  return s;
}

/** The intro from the numbers alone. `friday`: the publish date, "YYYY-MM-DD". */
export function templateIntro(p: FactPacket, friday: string, compared: boolean): string {
  const lead = p.teams[0];
  const name = (t: PacketTeam) => `${t.team} ${t.name}`.trim();
  const out = [`This week's top ${p.teams.length}, from the live world ranking as of ${publishedLabel(friday)}.`];
  if (lead) out.push(`${name(lead)} leads with a rating of ${one(lead.rating)}.`);
  if (compared) {
    const riser = [...p.teams].filter((t) => (t.movement ?? 0) > 0).sort((a, b) => b.movement! - a.movement! || a.rank - b.rank)[0];
    if (riser) out.push(`${name(riser)} made the biggest climb, up ${riser.movement} to #${riser.rank}.`);
    const fresh = p.teams.filter((t) => t.priorRank == null).length;
    if (fresh) out.push(`${fresh} ${fresh === 1 ? "team is" : "teams are"} new to the list.`);
  }
  return out.join(" ");
}

export interface Composed {
  intro: string;
  introSource: "bruno" | "template";
  entries: { rank: number; team: number; text: string; source: "bruno" | "template"; rejected?: string[] }[];
}

/**
 * The week's text: Bruno's blurbs that pass the fact check, the template for every other team (no
 * answer, a missing blurb, or a failed check), and the same for the intro. `bruno` null: Control Point
 * was unreachable, unset or answered with something unusable, so every blurb is the template.
 */
export function compose(packet: FactPacket, bruno: BrunoOutput | null, friday: string, compared: boolean): Composed {
  const byTeam = new Map<number, string>();
  for (const b of bruno?.blurbs ?? []) if (typeof b?.text === "string" && Number.isInteger(b?.team) && !byTeam.has(b.team)) byTeam.set(b.team, b.text.replace(/\s+/g, " ").trim());
  const entries = packet.teams.map((t) => {
    const text = byTeam.get(t.team);
    if (text) {
      const c = checkBlurb(text, t, packet);
      if (c.ok) return { rank: t.rank, team: t.team, text, source: "bruno" as const };
      return { rank: t.rank, team: t.team, text: templateBlurb(t, compared), source: "template" as const, rejected: c.reasons };
    }
    return { rank: t.rank, team: t.team, text: templateBlurb(t, compared), source: "template" as const, ...(bruno ? { rejected: ["no blurb"] } : {}) };
  });
  const introText = typeof bruno?.intro === "string" ? bruno.intro.replace(/\s+/g, " ").trim() : "";
  const introOk = !!introText && checkIntro(introText, packet, friday).ok;
  return { intro: introOk ? introText : templateIntro(packet, friday, compared), introSource: introOk ? "bruno" : "template", entries };
}
