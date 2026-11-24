// "When" and "where" asks (search audit, "when/where asks"): "when did <team> win inspire" is the dates of the
// answer "<team> inspire awards" gives, "where did <team> score their highest" its event. The question is read as
// asked without the word, and that answer's own rows (an event and a date each) are its headline.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "../answers/season";
import { searchAnswer } from "../searchAnswer";
import { askOf, whenWhere } from "../../../src/shared/query/whenWhere";
import type { StatAnswer, StatMatchRow } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const S = 2025;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });
const card = async (q: string) => (await ask(q)).stat as StatAnswer;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[30701, "Crab Bots"], [30702, "Bay Bots"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'MD', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  // Two events: 30701 wins Inspire at the first, places 2nd for Inspire and wins Think at the second.
  const events = [["USMDHAR", "Harbor Qualifier", "2026-01-10"], ["USMDBAY", "Bayside Qualifier", "2026-02-14"]] as const;
  for (const [code, name, day] of events) await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', 'MD', 'USA', ?, ?, 't')", [S, code, name, day, day]);
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (?, 'USMDHAR', 'Inspire', 1, 30701), (?, 'USMDBAY', 'Inspire', 2, 30701), (?, 'USMDBAY', 'Think', 1, 30701)", [S, S, S]);
  // 30701's highest score is at the second event.
  let k = 0;
  for (const [code, day, red] of [["USMDHAR", "2026-01-10", 120], ["USMDBAY", "2026-02-14", 180], ["USMDBAY", "2026-02-14", 90]] as const) {
    k++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, 50, 50, 't')", [S, code, k, `Q${k}`, `${day}T10:00:00Z`, red, red]);
    for (const [t, a] of [[30701, "red"], [30702, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [S, code, k, t, a]);
  }
  await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np) VALUES (?, 30701, 3, 3, 0, 0, 60), (?, 30702, 3, 0, 3, 0, 20)", [S, S]);
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("when and where asks", () => {
  it("reads what a question asks by its first words", () => {
    expect(["when did a team win", "What day was it", "on which date", "where did they play", "at which event did they win", "in what competition did they win"].map(askOf))
      .toEqual(["when", "when", "when", "where", "where", "where"]);
    // "Which event had …" asks for the events themselves.
    expect(["who won inspire", "which team won", "what is their opr", "which event had the highest score"].map(askOf)).toEqual([null, null, null, null]);
  });
  it("when: the answer's dates are the headline, newest first", async () => {
    const s = await card("when did 30701 win inspire");
    expect([s.title, s.headline?.value, s.headline?.sub]).toEqual(["When: Inspire Awards", "Feb 14, 2026 · Jan 10, 2026", "Bayside Qualifier · Harbor Qualifier"]);
    // What it answered stays under it (the 2nd place counted apart), and a tile for each.
    expect(s.headline?.label).toBe("1 Inspire Award · plus 1 2nd- or 3rd-place Inspire");
    // Two events: the headline opens neither (a link is one row's, and its video with it).
    expect(s.headline?.href).toBeUndefined();
    // The reading as said, "When" before it: what it said of the team stays.
    const [w, plain] = await Promise.all([ask("when did 30701 win inspire"), ask("30701 inspire awards")]);
    expect(w.understood?.label).toBe(`When: ${plain.understood?.label}`);
    const tiles = s.blocks[0];
    expect(tiles.kind === "kpis" && tiles.items.map((i) => [i.label, i.value])).toEqual([["Bayside Qualifier", "Feb 14, 2026"], ["Harbor Qualifier", "Jan 10, 2026"]]);
  });
  it("where: the events, each once; a superlative's own match only", async () => {
    // Every season's table read (an awards list is one table a season).
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USMDOLD', 'Old Harbor Qualifier', 'Qualifier', 'Town', 'MD', 'USA', '2025-01-11', '2025-01-11', 't')");
    await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2024, 'USMDOLD', 'Design', 1, 30701)");
    clearAllCaches();
    const aw = await card("where did 30701 win an award");
    expect([aw.headline?.value, aw.headline?.sub]).toEqual(["Bayside Qualifier · Harbor Qualifier · Old Harbor Qualifier", "Feb 14, 2026 · Jan 10, 2026 · Jan 11, 2025"]);
    const hi = await card("where did 30701 score their highest");
    expect([hi.title.startsWith("Where: "), hi.headline?.value, hi.headline?.sub]).toEqual([true, "Bayside Qualifier", "Feb 14, 2026"]);
    // An alliance's score becomes its event: the score is the label, its team chips (drawn beside a score) go.
    const top = await card("where was the highest score");
    expect([top.headline?.value, top.headline?.label.startsWith("180 points"), top.headline?.alliance, top.headline?.teams]).toEqual(["Bayside Qualifier", true, undefined, undefined]);
  });
  it("when: a score split by season reads its matches' dates (its table has events only)", async () => {
    await run("INSERT OR IGNORE INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2024, 'USMDOLD', 'Old Harbor Qualifier', 'Qualifier', 'Town', 'MD', 'USA', '2025-01-11', '2025-01-11', 't')");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2024, 'USMDOLD', 'qual', 0, 1, 'Q1', '2025-01-11T10:00:00Z', 1, 100, 100, 40, 40, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2024, 'USMDOLD', 'qual', 0, 1, 30701, 'red', 1)");
    clearAllCaches();
    const hi = await card("when did 30701 score their highest ever");
    expect([hi.title.startsWith("When: "), hi.headline?.value, hi.headline?.sub]).toEqual([true, "Feb 14, 2026", "Bayside Qualifier"]);
    // Split by season: its table is there (the fallback this reads past).
    expect(hi.blocks.some((b) => b.kind === "table" && b.title.includes("each season"))).toBe(true);
  });
  it("a match still to play never answers \"when did …\" (its table is passed over for the played matches)", () => {
    const played = { label: "Q1", href: "/m/1", event: { label: "Harbor Qualifier", href: "/e/1" }, season: "2025–26", date: "2026-01-10", alliance: "red", own: 120, opp: 50 } as unknown as StatMatchRow;
    const stat = {
      title: "Matches", scope: [], definition: "", source: "", headline: { value: "1-0-0", label: "in 1 match" },
      blocks: [
        { kind: "table", title: "Still to play", upcoming: true, columns: [{ key: "event", label: "Event" }, { key: "when", label: "When" }], rows: [{ cells: { event: "Newport Qualifier", when: "Mar 28, 2026" } }] },
        { kind: "matches", title: "Newest first", rows: [played] },
      ],
    } as unknown as StatAnswer;
    expect([whenWhere(stat, "where").headline?.value, whenWhere(stat, "when").headline?.value]).toEqual(["Harbor Qualifier", "Jan 10, 2026"]);
  });
  it("the dropdown (no card) says the ask only when the page's card does", async () => {
    const short = (q: string) => searchAnswer(q, { limit: 8, now: NOW });
    // Re-headlined: the same reading either way.
    const [w, wFull] = await Promise.all([short("when did 30701 win inspire"), ask("when did 30701 win inspire")]);
    expect([w.stat, w.understood?.label]).toEqual([undefined, wFull.understood?.label]);
    // Nothing to re-headline (no awards): as asked without the word, in both.
    const [n, nFull, plain] = await Promise.all([short("when did 30702 win inspire"), ask("when did 30702 win inspire"), ask("30702 inspire awards")]);
    expect([n.understood?.label, nFull.understood?.label]).toEqual([plain.understood?.label, plain.understood?.label]);
  });
  it("asked without the word, the answer is as before", async () => {
    const s = await card("30701 inspire awards");
    expect([s.title, s.headline?.value]).toEqual(["Inspire Awards", "1 Inspire Award"]);
  });
});
