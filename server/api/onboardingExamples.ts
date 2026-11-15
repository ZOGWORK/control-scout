// The onboarding's step 3 examples for one team (GET /api/onboarding/examples?team=, src/components/onboarding):
// two searches built from that team's own history, each one run here first so a pill never lands on a sorry.
//
//   - Compare: "<other> opr vs <team> opr over time in <season>": the team's last finished season (the current one
//     only when it has nothing before it), against its sister team (same school, same town) that played that season,
//     else the team it shared the most matches with that season.
//   - Season: "what was <name> auto opr in <game>": the season it went to Worlds (the latest one), else its best
//     season by OPR rank. Named by the team's name when no other team has it, else by its number.
//
// A team with no season played yet gets its town's and its region's lists instead. Nothing is made up: every team,
// season and game named comes from stored rows, and a search that doesn't answer is dropped for the next one.
// The fixed examples (the "next match" and "awards" pills, Worlds' winning alliance, a national leaderboard) are the
// dialog's own (src/components/onboarding/Onboarding.tsx).
import { get, all } from "../db.js";
import { SEARCH_PAGE_LIMIT } from "../../src/shared/search.js";
import type { SearchAnswer } from "../../src/shared/api.js";
import { CHAMPIONSHIP_TYPE } from "./answers/clauses.js";
import { currentSeason } from "./answers/season.js";
import { pageAnswer } from "./answers/followUps.js";
import { failureOf } from "../searchFailures.js";

export type ExampleKind = "compare" | "season" | "worlds-season" | "place";
export interface OnboardingExample { q: string; kind: ExampleKind }
export interface OnboardingExamples { team: number; examples: OnboardingExample[] }

/** "2025-26": the season as people type it (a plain hyphen). */
export const typedSeason = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`;

/** A school name that says nothing about who's a sister team ("Family/Community"). */
const noSchool = (s: string | null) => !s || /^family\s*\/\s*community$/i.test(s.trim()) || /^home\s*school/i.test(s.trim());

/** Whether search answers it as typed: the failed-search reporter's own test (server/searchFailures.ts). */
async function answers(q: string): Promise<boolean> {
  try {
    const a: SearchAnswer = await pageAnswer(q, SEARCH_PAGE_LIMIT, new Set());
    return failureOf(q, a) === null && a.step !== "recovery" && !a.sorry;
  } catch { return false; }
}

/** The first candidate search answers, or null. */
async function firstAnswered(cands: (OnboardingExample | null)[]): Promise<OnboardingExample | null> {
  for (const c of cands) if (c && (await answers(c.q))) return c;
  return null;
}

interface SeasonRow { season: number; matches: number; rank_np: number | null; ranked_teams: number | null }

/** How the team is named in a search: its name (lower case, as people type it) when it's its own, else its number. */
async function spoken(team: number, name: string | null): Promise<string> {
  const n = (name ?? "").trim();
  if ((n.match(/\p{L}/gu) ?? []).length < 3) return String(team);
  const same = await get<{ n: number }>("SELECT COUNT(*) n FROM teams WHERE lower(trim(name)) = lower(?)", [n]);
  return Number(same?.n ?? 0) === 1 ? n.toLowerCase() : String(team);
}

/** The other team for the compare: the sister team that played `season`, else the one met the most that season. */
async function otherTeam(team: number, season: number, t: { school: string | null; city: string | null; state: string | null; country: string | null }): Promise<number | null> {
  // Shared matches that season, with or against, per other team.
  const met = `(SELECT COUNT(*) FROM match_teams a JOIN match_teams b ON b.season = a.season AND b.code = a.code AND b.level = a.level AND b.series = a.series AND b.number = a.number
     WHERE a.team = ? AND a.season = ? AND b.team = o.number)`;
  if (!noSchool(t.school) && t.city) {
    const sister = await get<{ number: number }>(
      `SELECT o.number FROM teams o JOIN team_season_stats s ON s.team = o.number AND s.season = ? AND s.matches > 0 AND s.opr_np IS NOT NULL
       WHERE o.number <> ? AND lower(o.school) = lower(?) AND lower(o.city) = lower(?) AND COALESCE(o.state, '') = COALESCE(?, '') AND COALESCE(o.country, '') = COALESCE(?, '')
       ORDER BY ${met} DESC, o.number ASC LIMIT 1`, [season, team, t.school, t.city, t.state, t.country, team, season]);
    if (sister) return Number(sister.number);
  }
  const most = await get<{ team: number }>(
    `SELECT b.team, COUNT(*) n FROM match_teams a JOIN match_teams b ON b.season = a.season AND b.code = a.code AND b.level = a.level AND b.series = a.series AND b.number = a.number AND b.team <> a.team
     JOIN team_season_stats s ON s.team = b.team AND s.season = a.season AND s.matches > 0 AND s.opr_np IS NOT NULL
     WHERE a.team = ? AND a.season = ? GROUP BY b.team ORDER BY n DESC, b.team ASC LIMIT 1`, [team, season]);
  return most ? Number(most.team) : null;
}

// Worked out once per team for a while (each one runs a few searches): a sync's new matches show within the TTL.
const TTL_MS = 30 * 60_000;
const MAX_KEPT = 1000;
const kept = new Map<number, { at: number; p: Promise<OnboardingExamples | null> }>();
/** Forgets the examples worked out (tests that change the stored rows). */
export function resetOnboardingExamples(): void { kept.clear(); }

/** Step 3's two team searches for `team`, each one checked; null when the team isn't stored. */
export function onboardingExamples(team: number, now = Date.now()): Promise<OnboardingExamples | null> {
  const k = kept.get(team);
  if (k && now - k.at < TTL_MS) return k.p;
  if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value!);
  const p = workOut(team);
  kept.set(team, { at: now, p });
  // A read that failed is never kept.
  p.catch(() => kept.delete(team));
  return p;
}

async function workOut(team: number): Promise<OnboardingExamples | null> {
  const t = await get<{ number: number; name: string | null; school: string | null; city: string | null; state: string | null; country: string | null }>(
    "SELECT number, name, school, city, state, country FROM teams WHERE number = ?", [team]);
  if (!t) return null;
  const now = currentSeason();
  const seasons = (await all<SeasonRow>("SELECT season, matches, rank_np, ranked_teams FROM team_season_stats WHERE team = ? AND matches > 0 AND opr_np IS NOT NULL ORDER BY season DESC", [team]))
    .map((r) => ({ season: Number(r.season), matches: Number(r.matches), rank: r.rank_np == null ? null : Number(r.rank_np), of: r.ranked_teams == null ? null : Number(r.ranked_teams) }));
  const games = new Map((await all<{ season: number; name: string }>("SELECT season, name FROM seasons")).map((r) => [Number(r.season), String(r.name)]));
  const who = await spoken(team, t.name);
  const out: OnboardingExample[] = [];

  // Compare: the last finished season (before this one), else this one.
  const cmpSeason = seasons.find((s) => s.season < now)?.season ?? seasons[0]?.season ?? null;
  if (cmpSeason != null) {
    const other = await otherTeam(team, cmpSeason, t);
    const c = await firstAnswered([other != null ? { q: `${other} opr vs ${team} opr over time in ${typedSeason(cmpSeason)}`, kind: "compare" } : null]);
    if (c) out.push(c);
  }

  // Season: the latest season it played at Worlds (a match played there, never a registration alone), else the best season by OPR rank (share of the ranked teams).
  const worlds = await get<{ s: number | null }>(
    `SELECT MAX(e.season) s FROM events e WHERE e.type = ? AND EXISTS (SELECT 1 FROM match_teams mt JOIN matches m ON m.season = mt.season AND m.code = mt.code AND m.level = mt.level AND m.series = mt.series AND m.number = mt.number
       WHERE mt.season = e.season AND mt.code = e.code AND mt.team = ? AND mt.on_field = 1 AND m.played = 1)`, [CHAMPIONSHIP_TYPE, team]);
  const worldsSeason = worlds?.s != null && games.has(Number(worlds.s)) ? Number(worlds.s) : null;
  const ranked = seasons.filter((s) => s.rank != null && s.of && s.matches >= 3).sort((a, b) => a.rank! / a.of! - b.rank! / b.of! || b.season - a.season);
  // Then the next best seasons, in case one doesn't answer.
  const order = [...new Set([...ranked.map((r) => r.season), ...seasons.map((r) => r.season)])].filter((x) => x !== worldsSeason);
  const seasonQ = (s: number | null, kind: ExampleKind): OnboardingExample | null => {
    const game = s != null ? games.get(s) : undefined;
    return game ? { q: `what was ${who} auto opr in ${game.toLowerCase()}`, kind } : null;
  };
  const s = await firstAnswered([seasonQ(worldsSeason, "worlds-season"), ...order.map((x) => seasonQ(x, "season"))]);
  if (s) out.push(s);

  // Nothing played yet (a rookie team before its first event): its town's teams and its region's best.
  // A town is said with its state or country: several places share a town's name.
  const region = t.country === "USA" || t.country === "Canada" ? t.state : t.country;
  const places: OnboardingExample[] = [
    ...(t.city && region ? [{ q: `teams in ${t.city} ${region}`, kind: "place" as const }] : []),
    ...(region ? [{ q: `best rookie teams in ${region}`, kind: "place" as const }] : []),
    ...(t.country ? [{ q: `top teams in ${t.country}`, kind: "place" as const }] : []),
  ];
  for (const p of places) {
    if (out.length >= 2) break;
    if (await answers(p.q)) out.push(p);
  }
  return { team, examples: out.slice(0, 2) };
}
