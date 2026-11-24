// Bruno's answer on /search (docs/search.md): a question gets a sentence or three from Bruno AI on top of search's own
// results. Scout sends the question and the facts search found for it (the card's records, the top results, the main
// team's season numbers), each a line of plain text; Bruno writes from those lines only (Control Point's POST
// /internal/bruno/search-answer). Every number in his answer must be one of the facts' (or the question's): an
// answer with any other number is dropped, so a made-up stat never reaches the page. Asked only for a question
// (isBrunoQuestion), only by /search after its results are on screen (GET /api/search/bruno), and cached; off (the
// brunoAnswers switch), unconfigured, failing or slow: no answer, and the page keeps what it has.
// Streamed to a page that asks for it (?stream=1): the answer shows as he writes it, each part checked the same way
// before it's sent (previewOf), and ends at the same answer; the model call, prompt and cache are the same.
import type { SearchAnswer, SearchCardLine, SearchHit } from "../../src/shared/api.js";
import type { LeaderboardRow, StatAnswer, StatBlock, StatLink } from "../../src/shared/searchStat.js";
import { seasonLabel } from "../../src/shared/format.js";
import { SEARCH_PAGE_LIMIT, isBrunoQuestion } from "../../src/shared/search.js";
import { brunoAvailable, brunoSearchAnswer, brunoSearchAnswerStream } from "../auth/controlPoint.js";
import { all, get, kvGet } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { isEnabled } from "../flags.js";
import { answerVideo } from "./answers/video.js";
import { normalize } from "./fuzzy.js";
import { cleanQuery, searchAnswer, type AnswerOptions } from "./searchAnswer.js";
import { pageAnswer } from "./answers/followUps.js";
import { chatWords, pointsBack } from "./query/chat.js";
import { mineAnswer } from "./searchMine.js";
import { pickedQuery, pickedSeasonOf } from "./searchPageAnswer.js";
import { MINE } from "../../src/shared/searchMine.js";
import { searchVersion } from "./searchReads.js";

export const BRUNO_ANSWER_TIMEOUT_MS = 12_000;
/** At most this many facts, and this much text in all: a small, fast prompt. */
export const MAX_FACTS = 40;
export const MAX_FACTS_CHARS = 6000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** `text`: the answer in a sentence; `points`: one short line per record behind it (often none). */
export interface BrunoAnswer { text: string; points: string[] }

/** Answers by normalized question (null: Bruno had nothing to say, or his answer failed the check). Failures aren't kept. */
const cache = new Map<string, { at: number; answer: BrunoAnswer | null }>();
/** What a page sees of an answer while Bruno writes it: the checked part so far, or null (nothing to show yet, or withdrawn). */
export type BrunoPreview = (p: BrunoAnswer | null) => void;
/**
 * Questions being answered right now: a second ask while one is in flight shares it (one model call), and a streamed
 * ask joins its preview where it stands. `preview`: the latest one sent; `watchers`: the streamed asks sharing it.
 */
interface Flight { answer: Promise<BrunoAnswer | null>; preview: BrunoAnswer | null; watchers: Set<BrunoPreview> }
const pending = new Map<string, Flight>();
export const resetBrunoAnswerCache = () => { cache.clear(); pending.clear(); };

const lineText = (l: SearchCardLine) => {
  const more = [l.detail, ...(l.results ?? [])].filter(Boolean).join(" · ");
  return more ? `${l.text}: ${more}` : l.text;
};

/** "Won New Jersey Championship (2024–25): winning alliance 12345 Hypnotic Robotics, 23268 Ultraviolet; Inspire Award
 *  23268 Ultraviolet", or null when no winner is recorded (an event not held yet). */
async function eventWinners(h: SearchHit): Promise<string | null> {
  const [season, code] = h.ref.split(":");
  if (!code) return null;
  const rows = await all<{ type: string; team: number; name: string | null }>(
    "SELECT a.type, a.team, t.name FROM awards a LEFT JOIN teams t ON t.number = a.team WHERE a.season = ? AND a.code = ? AND (a.type = 'Winner' OR (a.type = 'Inspire' AND a.placement = 1)) ORDER BY a.type = 'Inspire', a.placement, a.team",
    [Number(season), code]);
  if (!rows.length) return null;
  const who = (r: { team: number; name: string | null }) => `${r.team}${r.name ? ` ${r.name}` : ""}`;
  const alliance = rows.filter((r) => r.type === "Winner").map(who);
  const inspire = rows.filter((r) => r.type === "Inspire").map(who);
  const parts = [alliance.length ? `winning alliance ${alliance.join(", ")}` : "", inspire.length ? `Inspire Award ${inspire.join(", ")}` : ""].filter(Boolean);
  return `Won ${h.title} (${seasonLabel(Number(season))}): ${parts.join("; ")}.`;
}

const names = (ls?: StatLink[]) => (ls ?? []).map((l) => l.label).join(", ");

/** A leaderboard row's OPR split, on a board ranked by OPR: its phases are the numbers a follow-up asks for ("and
 *  what's their auto opr"). Empty on the other boards, whose `parts` aren't phase OPRs. */
const phaseFacts = (b: Extract<StatBlock, { kind: "leaderboard" }>, r: LeaderboardRow): string => {
  if (b.stat.id !== "opr" || !r.parts) return "";
  const said = ([["Auto OPR", r.parts.auto], ["TeleOp OPR", r.parts.teleop], ["Endgame OPR", r.parts.endgame]] as const)
    .filter(([, v]) => v != null).map(([label, v]) => `${label} ${v}`);
  return said.length ? `, ${said.join(" · ")}` : "";
};

/** One stat block as plain lines: the same rows the page shows, every number as the page has it. */
function blockFacts(b: StatBlock): string[] {
  const title = "title" in b && b.title ? [`${b.title}:`] : [];
  switch (b.kind) {
    case "kpis": return [b.items.map((k) => `${k.label} ${k.value}${k.sub ? ` (${k.sub})` : ""}`).join("; ")];
    case "record": return [...title, `- record ${b.wins}-${b.losses}-${b.ties} (W-L-T)${b.split ? `; quals ${b.split.quals.wins}-${b.split.quals.losses}-${b.split.quals.ties}, playoffs ${b.split.playoffs.wins}-${b.split.playoffs.losses}-${b.split.playoffs.ties}` : ""}`];
    case "matches": return [...title, ...b.rows.map((r) => `- ${r.label}: ${r.own}-${r.opp} ${r.result === "W" ? "won" : r.result === "L" ? "lost" : "tied"}, ${r.event.label} (${r.season})${r.partners?.length ? `, with ${names(r.partners)}` : ""}${r.opponents?.length ? `, vs ${names(r.opponents)}` : ""}`)];
    case "table": return [...title, ...b.rows.map((r) => `- ${b.columns.map((c) => `${c.label} ${r.cells[c.key] ?? "-"}`).join(", ")}${r.teams ? `; red ${names(r.teams.red)} vs blue ${names(r.teams.blue)}` : ""}`)];
    // Where the team is and its OPR phases, so "where are they from, and their auto opr" is answered by the board itself.
    case "leaderboard": return [...title, ...b.rows.map((r) => `- #${r.rank} ${r.team.label}${r.location ? ` (${r.location})` : ""}: ${b.stat.label} ${r.display}${r.record ? `, record ${r.record}` : ""}${phaseFacts(b, r)}`), b.note];
    case "compare": return [...title, `${names(b.teams)}:`, ...b.rows.map((r) => `- ${r.label}: ${r.values.join(" vs ")}${r.gap ? ` (${r.gap})` : ""}`)];
    case "league": return [...title, ...b.rows.map((r) => `- #${r.rank} ${r.team}${r.name ? ` ${r.name}` : ""}${r.wins != null ? `, ${r.wins}-${r.losses ?? 0}-${r.ties ?? 0}` : ""}`)];
    // A forecast is never certain: shown 1% to 99% unless it's decided, as the page shows it, so Bruno can't say 0% or 100%.
    case "chance": { const r = Math.round(b.p * 100); return [`${b.label}: ${b.decided ? r : Math.min(99, Math.max(1, r))}% ${b.who}${b.note ? ` (${b.note})` : ""}`]; }
    case "series": return [...title, b.points.filter((p) => p.y != null).map((p) => `${p.x} ${p.y}${b.unit ? ` ${b.unit}` : ""}`).join("; ")];
    case "bars": return [...title, ...b.groups.map((g) => `- ${g.label}: ${g.items.map((i) => `${i.label} ${i.value ?? "-"}`).join(", ")}`)];
    case "videos": return [...title, ...b.tiles.map((t) => `- ${t.label} ${t.redScore}-${t.blueScore}${t.event ? `, ${t.event}` : ""}`)];
    case "links": return b.items.length ? [...title, b.items.map((l) => l.label).join(", ")] : b.none ? [b.none] : [];
    default: return [];
  }
}

/** A stat answer (who won, records, head-to-heads, highlights …) as plain lines: its headline first, then its blocks. */
export function statFacts(s: StatAnswer): string[] {
  // A stat about one team says which, so its lines that name none (its headline, its numbers) are read as that team's.
  const title = s.heading ?? s.title;
  const who = s.team && !numbers(title).includes(String(s.team.number)) ? ` (team ${`${s.team.number} ${s.team.name ?? ""}`.trim()})` : "";
  const out: string[] = [`${title}${who}:`];
  const h = s.headline;
  if (h) out.push(`${h.value} ${h.label}${h.sub ? ` (${h.sub})` : ""}${h.teams?.length ? `: ${names(h.teams)}` : ""}`);
  if (s.none) out.push(s.none);
  for (const b of s.blocks) out.push(...blockFacts(b));
  if (s.source) out.push(`Source: ${s.source}`);
  return out.filter(Boolean);
}

/** The facts search found for `a` (its answer to the question), as plain lines for Bruno. */
export async function answerFacts(a: SearchAnswer): Promise<string[]> {
  const facts: string[] = [];
  // What the event records cover (the events table's own range, not the seasons the site lists).
  const first = (await get<{ s: number | null }>("SELECT MIN(season) s FROM events"))?.s ?? CURRENT_SEASON;
  facts.push(`Control Scout's event records start with the ${seasonLabel(first)} FTC season; nothing earlier is recorded.`);
  // The answer search gave, first: what the page shows above everything else.
  if (a.verdict) facts.push(`Answer: ${a.verdict.answer}, ${a.verdict.label}`);
  if (a.stat) facts.push(...statFacts(a.stat));
  // Its videos, as the page plays them (public ones only), so he never says there are none when there are.
  const v = await answerVideo(a).catch(() => undefined);
  const clips = v ? [v.main ?? v.watch, ...Object.values(v.rows ?? {})].filter((i): i is NonNullable<typeof i> => !!i && i.kind !== "contributor") : [];
  if (clips.length) facts.push(`Videos on Control Scout for this answer: ${[...new Set(clips.map((i) => i.match ?? (i.kind === "stream" ? "a stream" : "an event recording")))].join(", ")}.`);
  const cardFacts = (c: NonNullable<SearchAnswer["card"]>) => {
    const who = c.team ? ` for team ${`${c.team.number} ${c.team.name ?? ""}`.trim()}` : "";
    facts.push(`${c.title}${who}: ${c.lines.length} found${c.count ? ` (${c.count} ${c.count === 1 ? "time" : "times"})` : ""}.`);
    for (const l of c.lines) facts.push(`- ${lineText(l)}`);
    if (c.none) facts.push(c.none);
    for (const l of c.closest ?? []) facts.push(`- Closest record: ${lineText(l)}`);
  };
  if (a.card) cardFacts(a.card);
  // A compound question's other parts, each answered as asked (server/api/query/clauses.ts): every part's facts.
  for (const c of a.clauses ?? []) { if (c.stat) facts.push(...statFacts(c.stat)); if (c.card) cardFacts(c.card); }
  for (const h of a.hits.slice(0, 5)) {
    const extra = (h.facts ?? []).map((f) => `${f.label} ${f.value}`).join("; ");
    facts.push(`Result: ${h.title}${h.subtitle ? ` (${h.subtitle})` : ""}${extra ? `: ${extra}` : ""}`);
    // An event: who won it (its winning alliance and Inspire Award), so "who won nj states" has an answer to go on.
    if (h.kind === "event") { const w = await eventWinners(h); if (w) facts.push(w); }
  }
  // The main team's latest season, so "how good are they" has numbers to go on.
  const team = a.card?.team?.number ?? (a.hits[0]?.kind === "team" ? Number(a.hits[0].ref) : null);
  if (team) {
    const s = await get<{ season: number; opr_np: number | null; rank_np: number | null; ranked_teams: number | null; wins: number | null; losses: number | null; ties: number | null }>(
      "SELECT season, opr_np, rank_np, ranked_teams, wins, losses, ties FROM team_season_stats WHERE team = ? ORDER BY season DESC LIMIT 1", [team]);
    if (s) {
      const bits = [s.wins != null && s.losses != null ? `record ${s.wins}-${s.losses}-${s.ties ?? 0}` : "", s.opr_np != null ? `OPR ${s.opr_np.toFixed(1)}` : "", s.rank_np != null && s.ranked_teams ? `OPR rank ${s.rank_np} of ${s.ranked_teams}` : ""].filter(Boolean);
      if (bits.length) facts.push(`Team ${team} in ${seasonLabel(s.season)}: ${bits.join(", ")}.`);
    }
  }
  // Bounded: the first lines are the ones that answer.
  const out: string[] = [];
  let size = 0;
  for (const f of facts.slice(0, MAX_FACTS)) {
    if (size + f.length > MAX_FACTS_CHARS) break;
    out.push(f);
    size += f.length + 1;
  }
  return out;
}

/** The numbers in `s`, each whole as written: "101.6", "2025", a record "26-6-0" and a season "2023-24" are one each
 *  (so a "6" can't borrow from a record), with thousands separators dropped (an ordinal too: "1,384th" is 1384) and
 *  every dash read as "-". */
const numbers = (s: string) => (s.replace(/[–—]/g, "-").replace(/(\d),(?=\d{3}(?!\d))/g, "$1").match(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)*/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ""));

/** The numbers in `s` as `numbers` reads them, each with where it starts. */
const numberMarks = (s: string) => [...s.replace(/[–—]/g, "-").replace(/(\d),(?=\d{3}(?!\d))/g, "$1").matchAll(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)*/g)].map((m) => ({ n: m[0].replace(/^0+(?=\d)/, ""), i: m.index! }));

/** Whether every number in `text` is one the facts or the question have (counting words like "three" don't count as
 *  numbers), each with its team (`teams`: the team numbers the answer is about; see ungrounded). */
export function grounded(text: string, facts: string[], question: string, teams?: BrunoTeams): boolean {
  return ungrounded(text, facts, question, teams).length === 0;
}

/** A sentence of an answer: split where one ends (". ", "; "), never inside a number ("101.6"). */
const sentences = (s: string) => s.split(/(?<=[.!?;])\s+/).filter(Boolean);

/** The teams an answer is about: their numbers, each with its name when known (a sentence may name a team by name alone,
 *  "Bad Wolf's OPR"). */
export type BrunoTeams = ReadonlySet<number> | ReadonlyMap<number, string | null>;

/** The numbers in `text` that neither the facts nor the question have (what makes an answer fail `grounded`). With
 *  `teams`, each number is checked with the team its sentence names: it must be in a fact line about that team (a line
 *  naming it, or under a heading line that does) or in one about no team, so "6980's OPR is 142.3" fails when 142.3 is
 *  4215's. A sentence naming no team is checked against every fact. */
export function ungrounded(text: string, facts: string[], question: string, teams?: BrunoTeams): string[] {
  const asked = new Set(numbers(question));
  const known = (n: string, pool: Iterable<string>) => { for (const k of pool) if (k === n || k === n.replace(/\.0+$/, "")) return true; return false; };
  if (!teams?.size) {
    const all = new Set([...asked, ...numbers(facts.join(" "))]);
    return numbers(text).filter((n) => !known(n, all));
  }
  const isTeam = (n: string) => /^\d+$/.test(n) && teams.has(Number(n));
  // A team named by its name alone ("Bad Wolf"), as well as by number: names of four letters or more, whole words.
  const fold = (x: string) => x.toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
  const byName = teams instanceof Map ? [...teams].flatMap(([n, name]) => { const f = fold(name ?? ""); return f.length >= 4 && !/^\d+$/.test(f) ? [{ n, f }] : []; }) : [];
  const teamsIn = (x: string) => { const t = new Set(numbers(x).filter(isTeam).map(Number)); if (byName.length) { const fx = ` ${fold(x)} `; for (const b of byName) if (fx.includes(` ${b.f} `)) t.add(b.n); } return t; };
  // Each fact line with the teams it is about: its own, else those of the last line before it that named any ("Bad Wolf
  // (6980) awards:", "Awards for team 4215: 3 found.", "OPR (team 4215):"), its list items and its other lines alike;
  // a line before any team is named is about no team (anyone's). A compare
  // row under two teams ("- OPR: 142.3 vs 46.9 (+95.4)") gives each side's numbers to its own team, in order.
  let heading: number[] = [];
  const lines = facts.map((f) => {
    const own = [...teamsIn(f)];
    const item = /^\s*-\s/.test(f);
    const about = own.length ? own : heading;
    if (own.length) heading = own;
    const side = new Map<string, number[]>();
    const row = item && !own.length && about.length > 1 ? /^\s*-\s[^:]*:\s*(.*?)\s*(?:\([^)]*\))?\s*$/.exec(f) : null;
    const parts = row ? row[1].split(/\s+vs\.?\s+/) : [];
    if (parts.length === about.length) parts.forEach((p, i) => { for (const n of numbers(p)) side.set(n, [...(side.get(n) ?? []), about[i]]); });
    // A line naming several teams with a number for each ("- Qualification match: 4215 100, 6980 120"): each number the
    // last team's named before it (else the first named), read in order, never every team's.
    else if (own.length > 1) {
      const said = numberMarks(f), low = f.toLowerCase();
      const marks = [...said.filter((m) => isTeam(m.n)).map((m) => ({ i: m.i, t: Number(m.n) })),
        ...byName.flatMap((b) => { const i = low.indexOf(b.f); return i >= 0 ? [{ i, t: b.n }] : []; })].sort((x, y) => x.i - y.i);
      for (const m of said) {
        if (isTeam(m.n) || !marks.length) continue;
        const by = [...marks].reverse().find((x) => x.i < m.i) ?? marks[0];
        if (!side.get(m.n)?.includes(by.t)) side.set(m.n, [...(side.get(m.n) ?? []), by.t]);
      }
    }
    return { nums: new Set(numbers(f)), about, side };
  });
  // The teams a number of a line is about: its side's on a compare row, else the line's.
  const whose = (l: (typeof lines)[number], n: string) => l.side.get(n) ?? l.side.get(n.replace(/\.0+$/, "")) ?? [...l.side].find(([k]) => k.replace(/\.0+$/, "") === n)?.[1] ?? l.about;
  const bad: string[] = [];
  for (const s of sentences(text)) {
    const named = teamsIn(s);
    for (const n of numbers(s)) {
      if (named.has(Number(n)) && isTeam(n)) continue;
      if (known(n, asked)) continue;
      const ok = lines.some((l) => { if (!known(n, l.nums)) return false; const of = whose(l, n); return !named.size || !of.length || of.some((t) => named.has(t)); });
      if (!ok) bad.push(n);
    }
  }
  return bad;
}

/** The teams an answer is about, each with its name: its teams' results, its card's team, its stat's teams and rows,
 *  and the same of each part of a compound question (its clauses, whose facts Bruno is given too). */
export function answerTeams(a: SearchAnswer): Map<number, string | null> {
  const out = new Map<number, string | null>();
  const add = (n: number, name?: string | null) => { if (!out.get(n)) out.set(n, name?.replace(/^\s*\d+\s+/, "").trim() || null); };
  for (const h of a.hits) if (h.kind === "team" && /^\d+$/.test(h.ref)) add(Number(h.ref), h.title);
  for (const x of [a, ...(a.clauses ?? [])]) {
    if (x.card?.team) add(x.card.team.number, x.card.team.name);
    const s = x.stat;
    if (s?.team) add(s.team.number, s.team.name);
    for (const t of s?.teams ?? []) add(t.number, t.name);
    // Every team listed: by the link to its page ("/teams/4215": a board's rows, a match's alliances) or by its
    // number beside its name (a league's rows: team 4215, name "Hypnotic Robotics").
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { for (const x of v) walk(x); return; }
      if (!v || typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      const n = typeof o.href === "string" ? /^\/teams\/(\d+)(?:[/?#]|$)/.exec(o.href)?.[1] : undefined;
      if (n) add(Number(n), typeof o.label === "string" ? o.label : null);
      // An award names its team as teamName (its `name` is the award's).
      else if (typeof o.team === "number" && Number.isInteger(o.team) && o.team > 0) add(o.team, "teamName" in o ? (typeof o.teamName === "string" ? o.teamName : null) : typeof o.name === "string" ? o.name : null);
      for (const x of Object.values(o)) walk(x);
    };
    // The whole card (its awards' and champions' teams, its lines' links) and the whole stat (its headline's teams).
    walk(x.card);
    walk(s);
  }
  return out;
}

/** The page's search choices, and `after`: the search a follow-up points back at ("was that the same in all the
 *  matches you said": the tab's last search), whose answer gives his facts. Taken only for a follow-up
 *  (./query/chat.ts pointsBack), so every other question is answered from its own search as before. */
export type BrunoOptions = Pick<AnswerOptions, "prefer" | "limit" | "learn"> & { after?: string; afterSeason?: number | null; afterMy?: number | null };

/** The earlier search a follow-up reads, or null: only for a question that points back, never the question itself. */
export function followUpOf(q: string, after: string | undefined): string | null {
  const a = cleanQuery(String(after ?? "").slice(0, 200));
  if (!a || normalize(a) === normalize(q) || !pointsBack(chatWords(q))) return null;
  return a;
}

/**
 * Bruno's answer to the question `raw`, or null (not a question, off, unconfigured, nothing to say, failed the
 * check). `flag`: the switch that allows him here (the website's brunoAnswers; the Discord bot's own discordBruno). `opts`: the page's own search choices (its preferred teams, its limit), so he reads the results it shows.
 */
export async function brunoAnswer(raw: string, opts: BrunoOptions = {}, now = Date.now(), onPreview?: BrunoPreview, flag: "brunoAnswers" | "discordBruno" = "brunoAnswers"): Promise<BrunoAnswer | null> {
  // A question by its "?" too ("hypnotic opr?"): read before cleaning, which drops it.
  const q = cleanQuery(raw);
  if (!q || !isBrunoQuestion(raw.trim().slice(0, 200))) return null;
  if (!(await isEnabled(flag).catch(() => false)) || !brunoAvailable()) return null;
  // `learn: false` (the Discord bot): his facts come from the same unlearned search the bot shows, kept apart.
  const after = followUpOf(q, opts.after);
  // Keyed by the search index and the data (a live result at a meet under way moves "data:version", not the index): a
  // question is never answered from before its latest matches. A failed read of either is "0", never an error.
  const k = `${await searchVersion().catch(() => "0")}|${(await kvGet<string>("data:version").catch(() => null)) ?? "0"}|${normalize(q)}|${[...(opts.prefer ?? [])].sort().join(",")}${opts.learn === false ? "|nolearn" : ""}${after ? `|after:${normalize(after)}${opts.afterSeason != null ? `|in:${opts.afterSeason}` : ""}${opts.afterMy != null && MINE.test(after) ? `|my:${opts.afterMy}` : ""}` : ""}`;
  const hit = cache.get(k);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.answer;
  let flight = pending.get(k);
  if (!flight) {
    const f: Flight = { answer: null!, preview: null, watchers: new Set() };
    // Streamed only while a page watches it; the model call is the same either way.
    const show: BrunoPreview = (p) => { f.preview = p; for (const w of f.watchers) w(p); };
    // Only its own entry: a reset while it ran may have let a newer ask take the key.
    f.answer = ask(q, raw.trim(), { ...opts, after: after ?? undefined, afterSeason: after ? pickedSeasonOf(opts.afterSeason) : null }, k, now, onPreview ? show : undefined).finally(() => { if (pending.get(k) === f) pending.delete(k); f.watchers.clear(); });
    pending.set(k, f);
    flight = f;
  } else if (onPreview && flight.preview) onPreview(flight.preview);
  if (onPreview) flight.watchers.add(onPreview);
  return flight.answer;
}

/** A JSON string's value from its opening quote at `s[i]`, as far as it's written: its text, and where it ended (-1: not yet). */
function readString(s: string, i: number): { value: string; end: number } {
  let value = "";
  for (let j = i + 1; j < s.length;) {
    const c = s[j];
    if (c === '"') return { value, end: j + 1 };
    if (c !== "\\") { value += c; j++; continue; }
    const e = s[j + 1];
    if (e === undefined) break;
    if (e === "u") {
      const hex = s.slice(j + 2, j + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      j += 6;
      continue;
    }
    value += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e;
    j += 2;
  }
  return { value, end: -1 };
}

/**
 * What Bruno's reply says so far, read from the start of the agreed JSON ({"text": "…", "points": ["…", …]}) as it's
 * written: the sentence and the points begun, and whether the last of them is still being written (`open`).
 */
export function partialAnswer(raw: string): { text: string; points: string[]; open: boolean } {
  const none = { text: "", points: [], open: true };
  const t = /"text"\s*:\s*/.exec(raw);
  if (!t || raw[t.index + t[0].length] !== '"') return none;
  const text = readString(raw, t.index + t[0].length);
  if (text.end < 0) return { text: text.value, points: [], open: true };
  const points: string[] = [];
  const p = /^\s*,\s*"points"\s*:\s*\[\s*/.exec(raw.slice(text.end));
  if (!p) return { text: text.value, points, open: true };
  let i = text.end + p[0].length;
  for (;;) {
    if (raw[i] !== '"') return { text: text.value, points, open: raw[i] !== "]" };
    const s = readString(raw, i);
    points.push(s.value);
    if (s.end < 0) return { text: text.value, points, open: true };
    i = s.end + (/^\s*,?\s*/.exec(raw.slice(s.end))?.[0].length ?? 0);
  }
}

const tidy = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The part of a reply so far that can be shown while he writes: tidied as the answer is, with a number still being
 * written held back (its next digit could change it), and checked like the answer. undefined: a number in it isn't
 * in the facts (the answer will be dropped, so nothing more of it is shown).
 */
export function previewOf(raw: string, facts: string[], question: string, teams?: BrunoTeams): BrunoAnswer | null | undefined {
  const p = partialAnswer(raw);
  const pieces = [p.text, ...p.points];
  if (p.open) pieces[pieces.length - 1] = pieces[pieces.length - 1].replace(/[\d.,\-–—]+$/, "");
  const [text, ...points] = pieces.map((s, i) => tidy(s, i ? 200 : 600));
  if (!text) return null;
  const shown = { text, points: points.filter(Boolean).slice(0, 6) };
  // Each piece checked on its own, as the answer is (ask): joined, two pieces could read as one sentence.
  return [shown.text, ...shown.points].every((x) => grounded(x, facts, question, teams)) ? shown : undefined;
}

/** `asked`: the words as the page asked /api/search for them (its kept answer is keyed by them, untouched). */
async function ask(q: string, asked: string, opts: BrunoOptions, k: string, now: number, show?: BrunoPreview): Promise<BrunoAnswer | null> {
  const { after, afterSeason, afterMy, ...search } = opts;
  // A follow-up is answered from the search it points back at: that search's facts, said as its. A failed read of
  // them (a database error) is no answer, as a failed model call is, never an error to the page; not cached.
  let facts: string[], teams: BrunoTeams;
  try {
    const read = (x: string) => searchAnswer(x, { ...search, learn: search.learn ?? true });
    if (after) {
      // Read as the page read it: in the season picked on its answer (as /search's ?season=), and "my"/"our" for the
      // My team it was asked with (./searchMine.ts).
      const earlier = afterSeason != null ? await pickedQuery(after, afterSeason) : after;
      const base = await read(earlier);
      const mine = afterMy != null ? await mineAnswer(earlier, base, afterMy, read) : null;
      facts = [`This question follows up the earlier search "${earlier}": the facts below are that search's answer.`, ...(await answerFacts(mine ?? base))];
      teams = answerTeams(mine ?? base);
    } else {
      // The page's own kept answer (pageAnswer: the one /api/search?answer=1 just gave for these words and preferred
      // teams), not a new search of his own. The Discord bot's unlearned search (`learn: false`) still runs its own.
      const found = search.learn === false
        ? await read(q)
        : await pageAnswer(asked, search.limit ?? SEARCH_PAGE_LIMIT, search.prefer ?? new Set());
      facts = await answerFacts(found);
      teams = answerTeams(found);
    }
  } catch (e) {
    console.warn("[search] Bruno's facts unavailable:", (e as Error).message?.slice(0, 120));
    return null;
  }
  let answer: BrunoAnswer | null = null;
  try {
    // Streamed for a page that watches: each new checked part goes to it; once a part fails the check, the page is
    // told to drop what it has, and sees nothing more until the answer (which the same check drops too).
    let last = "";
    let withdrawn = false;
    const onRaw = (raw: string) => {
      if (withdrawn) return;
      const p = previewOf(raw, facts, q, teams);
      if (p === undefined) { withdrawn = true; if (last) show!(null); return; }
      const key = p ? JSON.stringify(p) : "";
      if (key && key !== last) { last = key; show!(p); }
    };
    const r = show ? await brunoSearchAnswerStream(q, facts, BRUNO_ANSWER_TIMEOUT_MS, onRaw) : await brunoSearchAnswer(q, facts, BRUNO_ANSWER_TIMEOUT_MS);
    const clean = tidy(r.text, 600);
    // Points are checked with the sentence: one number not in the facts drops the whole answer.
    const points = (Array.isArray(r.points) ? r.points : []).map((p) => tidy(p, 200)).filter(Boolean).slice(0, 6);
    // The sentence and each point checked on their own, so a point's number is read with its own team.
    if (clean && [clean, ...points].every((x) => grounded(x, facts, q, teams))) answer = { text: clean, points };
    else if (clean) console.warn("[search] Bruno's answer named a number not in the facts: dropped");
  } catch (e) {
    console.warn("[search] Bruno answer unavailable:", (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message?.slice(0, 120));
    return null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(k, { at: now, answer });
  return answer;
}
