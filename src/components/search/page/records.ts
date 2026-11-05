// A question card's records read as facts for the /search page's summary (FTC One Search, Part B Phase 2): each
// championship line's season, division, rank, record and OPR (server/api/searchQuestions.ts eventLine writes them:
// detail "2021–22 · Apr 19–23, 2022 · Houston, TX", results "Ranked #20", "4-4-0 in quals", "OPR 124.8"), the stats
// a banner shows (computed here, for any team, never typed in), and a team's season standing for "how good is X".
import type { SearchCard, SearchCardLine, TeamSummary } from "../../../shared/api";

export interface Appearance {
  /** "rec-2021": the anchor its card on the page carries (the timeline jumps to it). */
  id: string;
  /** The season's first year (2021 for 2021–22). */
  season: number;
  seasonLabel: string;
  /** The season's game ("CENTERSTAGE"), as the server names it (SearchCardLine.game); null when not given. */
  game: string | null;
  /** "2023–24 CENTERSTAGE": the season said with its game, where a card or a stat names one. */
  seasonName: string;
  /** "FIRST Championship - Houston - … - Franklin Division" → title "Franklin Division", badges ["FIRST Championship"]. */
  name: string;
  title: string;
  badges: string[];
  division: string | null;
  when: string | null;
  place: string | null;
  rank: number | null;
  record: string | null;
  opr: number | null;
  /** What else the line says (awards, "Played the finals"). */
  more: string[];
  href?: string;
}

const SEASON = /^(\d{4})[–-](\d{2})$/;

/** An event's long name as a title and badges: a division's own name up front, the event it belongs to as a badge.
 *  Names without a division stay whole (nothing is guessed). */
export function eventName(name: string): { title: string; badges: string[] } {
  const parts = name.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (parts.length < 2 || !/\bdivision\b/i.test(last)) return { title: name, badges: [] };
  return { title: last, badges: [parts[0]] };
}

export function appearance(l: SearchCardLine): Appearance | null {
  const detail = (l.detail ?? "").split(" · ").map((s) => s.trim());
  const sm = detail.map((d) => SEASON.exec(d)).find(Boolean);
  if (!sm) return null;
  const season = Number(sm[1]);
  const rest = detail.filter((d) => !SEASON.test(d));
  const results = l.results ?? [];
  let rank: number | null = null, record: string | null = null, opr: number | null = null;
  const more: string[] = [];
  for (const r of results) {
    let m: RegExpExecArray | null;
    if ((m = /^Ranked #(\d+)$/.exec(r))) rank = Number(m[1]);
    else if ((m = /^(\d+-\d+-\d+) in quals$/.exec(r))) record = m[1];
    else if ((m = /^OPR (-?\d+(?:\.\d+)?)$/.exec(r))) opr = Number(m[1]);
    else more.push(r);
  }
  const { title, badges } = eventName(l.text);
  return {
    id: `rec-${season}`, season, seasonLabel: sm[0], game: l.game ?? null, seasonName: l.game ? `${sm[0]} ${l.game}` : sm[0], name: l.text, title, badges,
    division: title !== l.text ? title.replace(/\s+division$/i, "") : null,
    when: rest[0] ?? null, place: rest[1] ?? null, rank, record, opr, more, href: l.href,
  };
}

/** The card's records as appearances, oldest first (one per season), when every line reads as one. */
export function appearances(card: SearchCard | undefined): Appearance[] {
  if (!card || (card.kind !== "worlds" && card.kind !== "states") || !card.lines.length) return [];
  const out = card.lines.map(appearance);
  if (out.some((a) => !a)) return [];
  return (out as Appearance[]).sort((a, b) => a.season - b.season);
}

export interface Stat { label: string; value: string; note?: string }

/** The banner's stats, each computed from the records and left out when it can't be (never a zero standing in):
 *  total = how many; streak = the longest run of back-to-back seasons; best rank = the lowest division rank;
 *  win rate = every recorded game's wins (a tie half) over games played, across the trips; most frequent division =
 *  the mode (only when one repeats; ties all named). Never a peak OPR: each season's game scores on its own scale.
 *  `where`: what the trips were to ("Worlds"), naming the win rate. */
export function appearanceStats(apps: Appearance[], where?: string): Stat[] {
  if (!apps.length) return [];
  const out: Stat[] = [{ label: "Total appearances", value: String(apps.length) }];
  let best = { len: 1, from: 0 }, run = { len: 1, from: 0 };
  for (let i = 1; i < apps.length; i++) {
    run = apps[i].season === apps[i - 1].season + 1 ? { len: run.len + 1, from: run.from } : { len: 1, from: i };
    if (run.len > best.len) best = { ...run };
  }
  out.push({ label: "Consecutive", value: String(best.len), note: best.len > 1 ? `${apps[best.from].seasonName} to ${apps[best.from + best.len - 1].seasonName}` : apps[best.from].seasonName });
  const ranked = apps.filter((a) => a.rank != null);
  if (ranked.length) { const b = ranked.reduce((x, y) => (y.rank! < x.rank! ? y : x)); out.push({ label: "Best division rank", value: `#${b.rank}`, note: b.seasonName }); }
  const games = apps.map((a) => /^(\d+)-(\d+)-(\d+)$/.exec(a.record ?? "")).filter((m): m is RegExpExecArray => !!m).map((m) => m.slice(1, 4).map(Number));
  if (games.length) {
    const [w, l, t] = games.reduce((s, g) => s.map((v, i) => v + g[i]), [0, 0, 0]);
    const rate = winRate(`${w}-${l}-${t}`);
    if (rate != null) out.push({ label: where ? `Win rate at ${where}` : "Win rate", value: `${rate.toFixed(1)}%`, note: `${w}–${l}–${t} in quals` });
  }
  const counts = new Map<string, number>();
  for (const a of apps) if (a.division) counts.set(a.division, (counts.get(a.division) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  if (top > 1) { const names = [...counts].filter(([, n]) => n === top).map(([d]) => d); out.push({ label: "Most frequent division", value: names.join(" / "), note: `${top}× ${names.length > 1 ? "each" : ""}`.trim() }); }
  return out;
}

/** Standing tiers by world OPR rank percentile (rank ÷ ranked teams): the band a team's percentile falls in. */
export const TIERS: { upTo: number; name: string }[] = [
  { upTo: 5, name: "Elite" }, { upTo: 15, name: "Excellent" }, { upTo: 35, name: "Strong" }, { upTo: 60, name: "Solid" }, { upTo: 100, name: "Developing" },
];

/** "Top 4.7%": rank ÷ ranked teams × 100, rounded half up to one decimal (388 of 8,308 → 4.7). */
export const percentile = (rank: number, of: number) => Math.round((rank / of) * 1000) / 10;
export const tierOf = (pct: number) => TIERS.find((t) => pct <= t.upTo)!;

/** "20-4-0" → wins over games played, a tie counting as half a win; null for no games. */
export function winRate(record: string | null): number | null {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(record ?? "");
  if (!m) return null;
  const [w, l, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return w + l + t ? Math.round(((w + t / 2) / (w + l + t)) * 1000) / 10 : null;
}

export interface Standing { season: number; record: string | null; opr: number | null; rank: number | null; of: number | null; pct: number | null; tier: string | null; winRate: number | null }

export function standing(s: TeamSummary, season: number): Standing {
  const pct = s.oprRank != null && s.of ? percentile(s.oprRank, s.of) : null;
  return { season, record: s.record, opr: s.opr, rank: s.oprRank, of: s.of, pct, tier: pct != null ? tierOf(pct).name : null, winRate: winRate(s.record) };
}

/** Whether a standing has anything to show (a record, an OPR or a rank). */
export const hasNumbers = (s: Standing) => !!s.record || s.opr != null || (s.rank != null && !!s.of);

export { isQualityQuestion } from "../../../shared/searchPage";
