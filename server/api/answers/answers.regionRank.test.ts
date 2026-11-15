// Region rankings asked of search (src/shared/regionRankings.ts): "where does 4215 rank in New Jersey", "where does
// {team} rank in {region}", "top teams in New Jersey", "best team in New Jersey", "New Jersey rankings". Each answers
// directly, with the region page's own numbers (rank in the region, rating, record, OPR) and a link to the region
// page, the team's row marked. A team with fewer than 3 rated matches is "Not ranked yet", a region with no rated team
// says so: never the sorry state for a question the data answers. Deterministic: the same families as every ranking
// question, no per-query or per-team rule.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { regionRankings } from "../regionRankings";
import { CURRENT_SEASON } from "../../data/seasons";
import { seasonLabel } from "../../../src/shared/format";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat";
import type { SearchAnswer } from "../../../src/shared/api";

const S = CURRENT_SEASON;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true }) as Promise<SearchAnswer>;
const kpis = (s: StatAnswer) => (s.blocks.find((b) => b.kind === "kpis") as Extract<StatBlock, { kind: "kpis" }>).items;
const nj = (team: number | null = null) => regionRankings({ season: S, week: null, place: { country: "USA", state: "NJ" }, page: null, sort: "rank", team });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run(`INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA'), (6980, 'Bad Wolf', 'Oradell', 'NJ', 'USA'),
    (7000, 'Jersey Top', 'Edison', 'NJ', 'USA'), (7100, 'Jersey Mid', 'Edison', 'NJ', 'USA'), (8000, 'Texas Top', 'Austin', 'TX', 'USA'), (9100, 'Few Matches', 'Trenton', 'NJ', 'USA'), (9500, 'Cowboys', 'Cheyenne', 'WY', 'USA')`);
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJQ1', 'Garden Qualifier', 'Qualifier', 'Union', 'NJ', 'USA', ?, ?, 't')", [S, `${S}-11-08`, `${S}-11-08`]);
  // season, team, OPR, rating, rated matches, wins, losses, ties, events
  for (const [team, opr, rating, rated, w, l, t, ev] of [[7000, 120, 130, 20, 18, 2, 0, 3], [4215, 101.6, 98.04, 32, 26, 6, 0, 5], [7100, null, 60, 9, 4, 5, 0, 2], [6980, 46.9, 50.3, 24, 13, 11, 0, 4], [8000, 150, 160, 20, 18, 2, 0, 3], [9100, 30, 70, 2, 1, 1, 0, 1], [9500, null, null, 0, 0, 0, 0, 1]] as const) {
    await run(`INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, matches, wins, losses, ties, events, rating_np, rating_sd, rating_matches, rating_rank) VALUES (?, ?, ?, 1, 6, ?, ?, ?, ?, ?, ?, 3.2, ?, 1)`,
      [S, team, opr, Math.max(rated, 3), w, l, t, ev, rating, rated]);
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, 'USNJQ1', ?, 1)", [S, team]);
  }
  await rebuildSearch();
});

describe("where does a team rank in a region", () => {
  it("4215 in New Jersey: its rank there, rating, record and OPR, the region page's numbers, linked with its row marked", async () => {
    const page = await nj(4215);
    const row = page.rows.find((r) => r.team === 4215)!;
    for (const q of ["where does 4215 rank in New Jersey", "where does 4215 rank in NJ"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      const s = a.stat as StatAnswer;
      expect(s.scope, q).toEqual(["New Jersey", seasonLabel(S)]);
      expect(s.headline, q).toMatchObject({ value: `#${row.rank} of ${page.total}`, label: "in New Jersey by prediction rating", href: `/rankings/regions/USA/NJ?season=${S}&team=4215` });
      const k = kpis(s);
      expect(k.find((i) => i.label === "New Jersey by rating"), q).toMatchObject({ value: `#${row.rank} of ${page.total}`, sub: expect.stringMatching(new RegExp(`^${row.rating.toFixed(1)} ±`)) });
      expect(k.find((i) => i.label === "Record")?.value, q).toBe(`${row.wins}-${row.losses}-${row.ties}`);
      expect(k.find((i) => i.label === "New Jersey by OPR")?.sub, q).toBe(`OPR ${Number(row.opr!.toFixed(1))}`);
      expect(s.more?.href, q).toBe(`/rankings/regions/USA/NJ?season=${S}&team=4215`);
    }
    // The page that link opens has 4215's row, marked (asked).
    expect(page.asked).toMatchObject({ status: "ranked", rank: row.rank, page: 1 });
  });

  it("any team in any region, by the same rule", async () => {
    const page = await nj();
    const a = await ask("where does 6980 rank in New Jersey");
    expect((a.stat as StatAnswer).headline).toMatchObject({ value: `#${page.rows.find((r) => r.team === 6980)!.rank} of ${page.total}` });
    // A team from elsewhere: said so, never a made-up place.
    expect((await ask("where does 8000 rank in New Jersey")).stat?.none).toMatch(/it's a team from Texas/);
  });

  it("a team with fewer than 3 rated matches is Not ranked yet, never sorry and never ranked", async () => {
    const a = await ask("where does 9100 rank in New Jersey");
    expect(a.step).toBe("deterministic");
    expect(a.sorry).toBeUndefined();
    const s = a.stat as StatAnswer;
    expect(s.none).toBe(`9100 Few Matches: Not ranked yet — 2 of 3 rated matches in ${seasonLabel(S)}. A team is on the New Jersey rankings after its 3rd rated match.`);
    expect(s.headline).toBeUndefined();
    expect(s.more?.href).toBe(`/rankings/regions/USA/NJ?season=${S}&team=9100`);
  });
});

/** A top-teams answer's rows, whichever family answered (the rating board, or the region card): team, rank, rating,
 *  OPR, record, and the link to the full list. */
function topRows(a: SearchAnswer): { rows: [string, string, string, string, string][]; href: string | undefined } {
  const board = a.stat?.blocks.find((b) => b.kind === "leaderboard") as Extract<StatBlock, { kind: "leaderboard" }> | undefined;
  if (board) return { rows: board.rows.map((r) => [r.team.label, `#${r.rank}`, r.display, r.opr == null ? "—" : Number(r.opr).toFixed(1), r.record ?? ""]), href: board.more?.href };
  return { rows: (a.card?.lines ?? []).map(({ text, results = [] }) => [text, results[0].split(" ")[0], results[1].replace("Rating ", ""), results[2].replace("OPR ", ""), results[3]]), href: a.pages[0]?.href };
}

describe("a region's top teams", () => {
  it("top teams, best team and rankings in New Jersey: the region page's top rows with its numbers, linked to it", async () => {
    const page = await nj();
    const want = page.rows.map((r) => [`${r.team} ${r.name}`, `#${r.rank}`, r.rating.toFixed(1), r.opr == null ? "—" : r.opr.toFixed(1), `${r.wins}-${r.losses}-${r.ties}`]);
    for (const q of ["top teams in New Jersey", "best team in New Jersey", "New Jersey rankings"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      const got = topRows(a);
      expect(got.rows.length, q).toBeGreaterThan(0);
      expect(got.rows, q).toEqual(want.slice(0, got.rows.length));
      const links = [got.href, ...a.pages.map((p) => p.href)];
      expect(links, q).toContain(`/rankings/regions/USA/NJ?season=${S}`);
    }
  });

  it("a region with no rated team says so", async () => {
    for (const q of ["top teams in Wyoming", "Wyoming rankings"]) {
      const a = await ask(q);
      expect(a.sorry, q).toBeUndefined();
      expect(a.card?.none ?? a.stat?.none, q).toMatch(/^No rated teams yet in Wyoming/);
    }
  });
});
