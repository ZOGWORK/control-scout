// The season a query means when it names none (./season.ts): the latest completed season, the newest whose FIRST
// Championship has finished, read from the stored events. Here 2026–27 has begun (some teams rated, its Championship
// still to come), so "this season" and every leaderboard read 2025–26, and "last season" is 2024–25. Also the lists
// and answers the 260-query list asks for: reliability and record leaderboards, "best team in <place> by <stat>",
// "<place> leaderboard by <stat>", a city's best team, OPR across two seasons, the rating across one, and a place's
// events with the season said in words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { rewriteQuery } from "../searchCoverage";
import { readEventQuery } from "../../../src/shared/searchEventQuery";
import { readLeaderboard, readScope } from "./read";
import { readChange } from "./families/seasonChange";
import { completedSeason, currentSeason, lastSeason, refreshSearchSeason, resetSearchSeason, teamSeason } from "./season";

const NOW = Date.parse("2026-11-04T12:00:00Z");

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // The FIRST Championships: 2024–25's and 2025–26's are over, 2026–27's is next spring.
  for (const [season, start, end] of [[2024, "2025-04-16", "2025-04-19"], [2025, "2026-04-29", "2026-05-02"], [2026, "2027-04-28", "2027-05-01"]] as const)
    await run("INSERT INTO events (season, code, name, type, start, end, source) VALUES (?, 'FTCCMP1', 'FIRST Championship', 'FIRSTChampionship', ?, ?, 'first')", [season, start, end]);
  // number, name, city, state, [season, opr, wins, losses, matches, rating, reliability][]
  const teams: [number, string, string, string, [number, number, number, number, number, number, number][]][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", [[2024, 144.8, 25, 17, 42, 167.6, 80], [2025, 101.6, 26, 6, 32, 98.0, 88]]],
    [6980, "Bad Wolf", "Oradell", "NJ", [[2025, 46.9, 13, 11, 24, 50.1, 70]]],
    [23268, "Ultraviolet", "Hillsborough", "NJ", [[2025, 157.9, 33, 17, 50, 154.5, 91]]],
    [18061, "Simply Complex", "Princeton", "NJ", [[2025, 90.2, 20, 4, 24, 95.0, 93]]],
    // Rated in the season that has just begun, higher than anyone in 2025–26: never on a default list.
    [30000, "Early Bird", "Newark", "NJ", [[2026, 400, 6, 0, 6, 390, 99]]],
    // One city name in two states.
    [11111, "Spring One", "Springfield", "OH", [[2025, 60, 10, 5, 15, 60, 80]]],
    [22222, "Spring Two", "Springfield", "IL", [[2025, 70, 10, 5, 15, 70, 80]]],
  ];
  for (const [n, name, city, state, seasons] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, ?, ?, 'USA', 2010)", [n, name, city, state]);
    for (const [season, opr, w, l, m, rating, rel] of seasons) {
      await run("INSERT INTO team_season_stats (season, team, opr_np, rank_np, ranked_teams, wins, losses, ties, matches, rating_np, rating_matches, rating_rank) VALUES (?, ?, ?, 10, 8000, ?, ?, 0, ?, ?, ?, 10)", [season, n, opr, w, l, m, rating, m]);
      await run(`INSERT INTO team_reliability (season, code, team, matches, no_shows, dqs, near_zero, contrib_n, recent_matches, recent_no_shows, recent_near_zero, idx, computed_at)
        VALUES (?, '', ?, ?, 0, 0, 0, ?, 0, 0, 0, ?, '2026-11-01')`, [season, n, m, m, rel]);
    }
  }
  // 4215's weekly Rankings ratings through 2025–26.
  // The last two weeks: no match played, others passed it (the rank moved), then nothing changed at all.
  for (const [week, rating, rank] of [["2025-11-10", 120.4, 300], ["2025-12-01", 110.2, 450], ["2026-03-02", 98.0, 610], ["2026-03-09", 98.0, 640], ["2026-03-16", 98.0, 640]] as const)
    await run("INSERT INTO ranking_snapshots (season, week, team, rank, rating) VALUES (2025, ?, 4215, ?, ?)", [week, rank, rating]);
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason(NOW);
});

describe("the default season", () => {
  it("is the newest season whose FIRST Championship has finished, from the data", async () => {
    expect(completedSeason()).toBe(2025);
    // Once 2026–27's Championship is over, it's the default (no year is written down anywhere).
    resetSearchSeason();
    expect(await refreshSearchSeason(Date.parse("2027-05-10T00:00:00Z"))).toBe(2026);
    resetSearchSeason();
    expect(await refreshSearchSeason(NOW)).toBe(2025);
  });
  it("\"last season\" is the one before it; a season named wins", () => {
    expect(readScope(" 4215 opr last season ").scope).toMatchObject({ season: 2024, lastYear: true });
    expect(readScope(" 4215 opr 2023-24 ").scope).toMatchObject({ season: 2023 });
  });
});

describe("a team's season, said in words", () => {
  it("last season's OPR, rating, record and awards are 2024–25's", async () => {
    expect((await searchAnswer("4215 opr last season", { limit: 25, full: true })).stat).toMatchObject({ title: "OPR in 2024–25", headline: { value: "144.8" } });
    expect((await searchAnswer("4215 rating last season", { limit: 25, full: true })).stat?.title).toBe("Prediction rating in 2024–25");
    expect((await searchAnswer("4215 record last season", { limit: 25, full: true })).stat?.title).toMatch(/2024–25/);
  });
  it("no season named, or \"this season\": the default season, said on the card", async () => {
    const a = (await searchAnswer("4215 opr", { limit: 25, full: true })).stat;
    expect(a).toMatchObject({ title: "OPR in 2025–26", headline: { value: "101.6" } });
    expect(a?.definition).toContain("2025–26, the latest completed season");
    expect(rewriteQuery("4215 events this season")).toMatchObject({ q: "4215 events in 2025-26" });
  });
});

describe("leaderboards", () => {
  it("said any way: who has the highest, the lowest first, a town in its state, a count at the end, undefeated", async () => {
    const board = async (q: string) => { const a = await searchAnswer(q, { limit: 25, full: true, now: NOW }); if (!a.stat) throw new Error(`${q}: ${a.understood?.label}`); const st = a.stat; const b = st.blocks[0]; return { st, rows: b.kind === "leaderboard" ? b.rows.map((r) => r.team.label) : [] }; };
    expect((await board("who has the highest opr in new jersey in 2025-26")).st.headline?.value).toBe("23268 Ultraviolet");
    const low = await board("worst opr in new jersey in 2025-26, just curious");
    expect(low.st.title).toMatch(/^Lowest .* by OPR in New Jersey · 2025–26$/);
    expect(low.rows[0]).toBe("6980 Bad Wolf");
    expect(low.st.headline?.sub).toBe("Lowest of 4 ranked in New Jersey");
    expect(low.st.blocks[0]).toMatchObject({ lowest: true });
    // Its link opens the same list, lowest first; a town's list has none (no page lists one town's teams).
    const more = (low.st.blocks[0] as { more?: { href: string } }).more;
    expect(more?.href).toContain("dir=asc");
    expect((await searchAnswer("top 5 teams in Oradell, NJ by opr in 2025-26", { limit: 25, full: true })).stat?.blocks[0]).not.toHaveProperty("more");
    expect((await board("best team in Oradell, NJ, by opr in 2025-26")).rows).toEqual(["4215 Hypnotic Robotics", "6980 Bad Wolf"]);
    // No stat said: a town with its state after it, lists its teams by OPR (a country by its people's word: server/api/searchCoverage.test.ts).
    expect((await board("best team in Oradell, NJ in 2025-26")).st.title).toBe("Best team in Oradell by OPR · 2025–26");
    expect((await board("which teams have the best opr in new jersey in 2025-26, top 2")).rows).toEqual(["23268 Ultraviolet", "4215 Hypnotic Robotics"]);
    expect((await board("is there any team with a perfect record in new jersey")).st).toMatchObject({ title: "Undefeated teams in New Jersey by wins · 2026–27", headline: { value: "30000 Early Bird" } });
  });
  it("no season said is the current one once a team is ranked in it, else the one before (server/api/query/execute.test.ts)", async () => {
    // 2026–27 has begun, and one New Jersey team is ranked in it already.
    const a = await searchAnswer("top 10 teams by opr in New Jersey", { limit: 25, full: true, now: NOW });
    expect(a.stat).toMatchObject({ title: "Top 10 teams by OPR in New Jersey · 2026–27", headline: { value: "30000 Early Bird" } });
    // A season said is that season.
    expect((await searchAnswer("top 10 teams by opr in New Jersey in 2025-26", { limit: 25, full: true, now: NOW })).stat?.headline?.value).toBe("23268 Ultraviolet");
  });
  it("by reliability and by record", async () => {
    expect(readLeaderboard("top 5 teams by reliability in New Jersey")).toMatchObject({ kind: "top", stat: "reliability", n: 5, region: { key: "USA:NJ" } });
    const r = await searchAnswer("top 5 teams by reliability in New Jersey in 2025-26", { limit: 25, full: true });
    const rb = r.stat!.blocks[0];
    if (rb.kind !== "leaderboard") throw new Error(rb.kind);
    expect(rb.rows.map((x) => [x.team.label, x.display])).toEqual([["18061 Simply Complex", "93"], ["23268 Ultraviolet", "91"], ["4215 Hypnotic Robotics", "88"], ["6980 Bad Wolf", "70"]]);
    const rec = await searchAnswer("New Jersey leaderboard by record", { limit: 25, full: true });
    const b = rec.stat!.blocks[0];
    if (b.kind !== "leaderboard") throw new Error(b.kind);
    expect(rec.stat?.title).toBe("Top 25 teams by record in New Jersey · 2025–26");
    expect(b.rows[0]).toMatchObject({ team: { label: "18061 Simply Complex" }, display: "20-4-0" });
  });
  it("a place's leaderboard by a stat, said place first", async () => {
    expect(readLeaderboard("New Jersey leaderboard by rating")).toMatchObject({ kind: "top", stat: "rating", region: { key: "USA:NJ" } });
    expect(readLeaderboard("leaderboard by opr in nj")).toMatchObject({ kind: "top", stat: "opr", region: { key: "USA:NJ" } });
    // A team's own rankings aren't a leaderboard.
    expect(readLeaderboard("4215 rankings")).toBeNull();
    const a = await searchAnswer("New Jersey leaderboard by rating", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ title: "Top 25 teams by prediction rating in New Jersey · 2025–26", headline: { value: "23268 Ultraviolet" } });
  });
  it("the best team in a place by a stat is that place's #1, never a team named \"best\"", async () => {
    expect(readLeaderboard("best team in New Jersey by opr")).toMatchObject({ kind: "top", stat: "opr", best: true, region: { key: "USA:NJ" } });
    const a = await searchAnswer("best team in New Jersey by opr in 2025-26", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ title: "Best team in New Jersey by OPR · 2025–26", headline: { value: "23268 Ultraviolet", sub: "#1 of 4 ranked in New Jersey" } });
  });
  it("a city's best team: its top OPR that season; a city no team lists is left to search", async () => {
    expect(readLeaderboard("best team in Oradell")).toMatchObject({ kind: "city-best", city: "oradell" });
    const a = await searchAnswer("best team in Oradell", { limit: 25, full: true });
    expect(a.stat).toMatchObject({ title: "Best team in Oradell, NJ by OPR · 2025–26", headline: { value: "4215 Hypnotic Robotics", label: "OPR 101.6, 26-6-0" } });
    // No season said: the current season first; none of the city's teams is ranked in it yet, said so.
    expect(a.stat?.scope[0]).toBe("No 2026–27 ranked teams yet in Oradell; showing 2025–26");
    expect((await searchAnswer("best team in atlantis", { limit: 25, full: true })).stat?.intent).not.toBe("city-best");
    // "Top 1" still counts every ranked team of the city.
    expect((await searchAnswer("top 1 teams in Oradell", { limit: 25, full: true })).stat?.headline).toMatchObject({ value: "4215 Hypnotic Robotics", sub: "#1 of 2 ranked in Oradell, NJ" });
    // A city name two states share names no one state.
    const sp = (await searchAnswer("best team in Springfield", { limit: 25, full: true })).stat;
    expect(sp).toMatchObject({ title: "Best team in Springfield by OPR · 2025–26", headline: { value: "22222 Spring Two" } });
    expect(sp?.definition).toContain("(in IL, OH)");
  });
});

describe("how a number changed", () => {
  it("OPR from last season to this season: both seasons' numbers and the difference", async () => {
    expect(readChange("how much did 4215's opr improve from last season to this season")).toEqual({ stat: "opr", core: "4215", from: 2024, to: 2025 });
    // "from … to …" keeps its direction; "between" is oldest first.
    expect(readChange("4215 opr change from 2025-26 to 2024-25")).toEqual({ stat: "opr", core: "4215", from: 2025, to: 2024 });
    expect(readChange("4215 opr change between 2025-26 and 2024-25")).toEqual({ stat: "opr", core: "4215", from: 2024, to: 2025 });
    const a = (await searchAnswer("how much did 4215's opr improve from last season to this season", { limit: 25, full: true })).stat;
    expect(a).toMatchObject({ title: "OPR change, 2024–25 to 2025–26", headline: { value: "−43.2", label: "OPR 144.8 in 2024–25 → 101.6 in 2025–26" } });
  });
  it("the rating across this season: its earliest and last stored weeks, the change, the team page's rating beside", async () => {
    expect(readChange("how much did 4215's rating change this season")).toEqual({ stat: "rating", core: "4215", from: null, to: 2025 });
    const a = (await searchAnswer("how much did 4215's rating change this season", { limit: 25, full: true })).stat;
    expect(a?.title).toBe("Prediction rating change in 2025–26");
    expect(a?.headline).toMatchObject({ value: "−22.4", sub: "4 weeks on record" });
    expect(a?.headline?.label).toMatch(/^120\.4 \(week of .+\) → 98 \(week of .+\)$/);
    const k = a?.blocks[0];
    expect(k?.kind === "kpis" && k.items.map((i) => i.label)).toEqual(["Start", "End", "Change", "Team page rating now"]);
    // The end is the last week the rating or the rank moved: #640, not #610.
    expect(k?.kind === "kpis" && k.items[1].sub).toMatch(/#640 worldwide$/);
  });
  it("no stored weeks: said so, with the season's rating", async () => {
    const a = (await searchAnswer("how much did 6980's rating change this season", { limit: 25, full: true })).stat;
    expect(a?.none).toMatch(/No weekly ratings of 6980 Bad Wolf are kept for 2025–26.* Its 2025–26 rating on its team page is 50\.1\./);
  });
});

describe("a place's events with the season in words", () => {
  it("\"this season\" is the default season, \"last season\" the one before it", () => {
    expect(rewriteQuery("events this season in New Jersey")).toMatchObject({ q: "events in new jersey 2025-26", pre: true });
    expect(rewriteQuery("events last season in New Jersey")).toMatchObject({ q: "events in new jersey 2024-25", pre: true });
    // A team's events are the team's answer, not a place's.
    expect(rewriteQuery("4215 events last season")).toBeNull();
  });
  it("\"upcoming\" beside this weekend says nothing more", () => {
    expect(readEventQuery("upcoming events this weekend")).toMatchObject({ time: "this-weekend", words: [] });
  });
});

describe("no finished Championship stored", () => {
  it("falls back to the newest season with matches before the current one, never a season with none", async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO team_season_stats (season, team, matches) VALUES (2024, 1, 10), (2026, 1, 6)");
    resetSearchSeason();
    expect(await refreshSearchSeason(NOW)).toBe(2024);
  });
});
