// The pipeline run end to end on a small database (docs/search-pipeline.md): the slots applied as filters and stated on
// the card, the same card for every phrasing of one question and every team, a year honoured, a future year said.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { namedParts, rewriteQuery } from "../searchCoverage";
import { names } from "./names";
import { matchFindAnswer } from "./matchFind";
import type { StatAnswer } from "../../../src/shared/searchStat";

// Wednesday 2026-03-18: "this week" is Mar 16–22, 2026, inside the 2025–26 season.
const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string, now = NOW) => searchAnswer(q, { limit: 25, full: true, now });
const stat = async (q: string, now = NOW) => (await ask(q, now)).stat as StatAnswer;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string, string][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA"], [6980, "Bad Wolf", "Fair Lawn", "NJ", "USA"], [24033, "Alphatronic", "Cluj-Napoca", "CJ", "Romania"],
    [17713, "Delta Force", "Arad", "AR", "Romania"], [10809, "Crow Force", "Los Angeles", "CA", "USA"], [5555, "Never Listed", "Fresno", "CA", "USA"],
    [30010, "Brunswick Bots", "East Brunswick", "NJ", "USA"], [30011, "Keystone Bots", "Erie", "PA", "USA"], [30012, "Liberty Bots", "Reading", "PA", "USA"],
  ];
  for (const [n, name, city, state, country] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, start: string, state: string, country: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, 'Town', ?, ?, ?, ?, 't')", [code, name, type, state, country, start, start]);
  await ev("USNJQ1", "Garden Qualifier", "Qualifier", "2026-01-10", "NJ", "USA");
  await ev("USCAQ1", "Golden Qualifier", "Qualifier", "2026-03-17", "CA", "USA");
  await ev("USCAQ0", "Winter Qualifier", "Qualifier", "2026-01-24", "CA", "USA");
  await ev("ROCMP", "Romania Championship", "Championship", "2026-03-14", "B", "Romania");
  await ev("FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-29", "TX", "USA");
  await ev("USTXNOCMP", "North Texas Championship", "Championship", "2026-02-28", "TX", "USA");
  await ev("USPAQ1", "Keystone Qualifier", "Qualifier", "2026-02-07", "PA", "USA");
  let n = 0;
  const match = async (code: string, day: string, red: number, blue: number, reds: number[], blues: number[]) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [code, n, `Q${n}`, `${day}T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [...reds.map((t) => [t, "red"] as const), ...blues.map((t) => [t, "blue"] as const)]) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
    }
    for (const t of [...reds, ...blues]) await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, 1)", [code, t]);
  };
  await match("USNJQ1", "2026-01-10", 150, 90, [4215, 6980], [10809]);
  await match("USNJQ1", "2026-01-10", 80, 120, [4215], [6980]);
  // California: one match this week (Mar 17) and a higher one in January.
  await match("USCAQ1", "2026-03-17", 210, 100, [10809], [5555]);
  await match("USCAQ0", "2026-01-24", 260, 110, [10809], [5555]);
  await match("ROCMP", "2026-03-14", 300, 140, [24033], [17713]);
  await match("ROCMP", "2026-03-14", 120, 330, [24033], [17713]);
  // Pennsylvania: a tie and a 10-point win (the closest match is the tie; the closest win never is).
  await match("USPAQ1", "2026-02-07", 100, 100, [30011], [30012]);
  await match("USPAQ1", "2026-02-07", 120, 110, [30011], [30012]);
  for (const t of [4215, 6980, 24033, 17713, 10809, 5555]) {
    await run("INSERT OR IGNORE INTO team_event_stats (season, code, team, opr_np, matches) SELECT season, code, team, 50, 1 FROM event_teams WHERE team = ?", [t]);
  }
  // The engine's predictions for the two Garden Qualifier matches: one logged live, one replayed (a card shows one kind).
  await run("INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at) VALUES ('live', 2025, 'USNJQ1', 'qual', 0, 1, '[4215,6980]', '[10809]', 0.7, 140, 100, 'high', 't', '2026-01-09'), ('live', 2025, 'USNJQ1', 'qual', 0, 2, '[4215]', '[6980]', 0.6, 110, 100, 'medium', 't', '2026-01-09'), ('backtest', 2025, 'USNJQ1', 'qual', 0, 2, '[4215]', '[6980]', 0.2, 90, 120, 'medium', 't', '2026-01-09')");
  // A meeting still to come at the same event, its call saved before any rated match (win odds only, no score).
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2025, 'USNJQ1', 'qual', 0, 99, 'Q99', '2026-01-10T18:00:00Z', 0, 't')");
  await run("INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, no_score_basis, tier, engine_version, predicted_at) VALUES ('live', 2025, 'USNJQ1', 'qual', 0, 99, '[4215]', '[6980]', 0.55, 100, 100, 1, 'low', 't', '2026-01-09')");
  // Matches the cards never count, for the eval's truth: one at a remote event, one with no points without penalties.
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, remote, source) VALUES (2025, 'USOHR1', 'Remote Qualifier', 'Qualifier', 'Town', 'OH', 'USA', '2025-12-01', '2025-12-01', 1, 't'), (2025, 'USOHQ1', 'Buckeye Qualifier', 'Qualifier', 'Town', 'OH', 'USA', '2025-12-02', '2025-12-02', 0, 't')");
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USOHR1', 'qual', 0, 1, 'Q1', '2025-12-01T10:00:00Z', 1, 500, 500, 10, 10, 't'), (2025, 'USOHQ1', 'qual', 0, 1, 'Q1', '2025-12-02T10:00:00Z', 1, 999, NULL, 0, NULL, 't')");
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USOHR1', 'qual', 0, 1, 5555, 'red', 1), (2025, 'USOHQ1', 'qual', 0, 1, 5555, 'red', 1)");
  // A Leadership Award is filed as a "Winner" too: never the event won.
  await run("INSERT INTO awards (season, code, team, type, name, placement) VALUES (2025, 'USNJQ1', 4215, 'Winner', 'Leadership Award', 1)");
  await rebuildSearch();
  clearAllCaches();
});

describe("place and time are applied and stated", () => {
  it("highest-scoring match in California this week: that one match, never a team card", async () => {
    const a = await ask("highest-scoring match in California this week");
    expect(a.hits.some((h) => h.kind === "team")).toBe(false);
    const s = a.stat as StatAnswer;
    expect(s.title).toBe("Highest-scoring match in California this week, DECODE 2025–26");
    expect(s.scope).toEqual(expect.arrayContaining(["California", "This week"]));
    expect(s.headline).toMatchObject({ value: "210 points" });
    const rows = s.blocks.find((b) => b.kind === "matches");
    expect(rows?.kind === "matches" && rows.rows).toHaveLength(1);
    // The same match however it's asked.
    for (const q of ["this week california highest scoring match", "what was the top scoring game in CA this week?", "best match score this week in california please"]) {
      expect((await stat(q)).headline, q).toMatchObject({ value: "210 points" });
    }
  });
  it("a window with nothing in it is relaxed to its season, said on the card", async () => {
    const a = await ask("highest-scoring match in California this week", Date.parse("2026-02-11T12:00:00Z"));
    const s = a.stat as StatAnswer;
    expect(s.headline).toMatchObject({ value: "260 points" });
    expect(s.scope[0]).toBe("Relaxed: this week → 2025–26");
    expect(s.scope).toContain("California");
    expect(s.definition).toContain("Nothing matched this week (No played matches at official events in California this week yet)");
    expect(a.understood?.label).not.toMatch(/relaxed/); // said once, in the chip: never the heading too
  });
  it("relaxes to the season before when the window's season has nothing yet, and never relaxes the place", async () => {
    // Early in 2026–27: nothing played in California yet, so the latest finished season, still California only.
    const a = await ask("highest-scoring match in California this week", Date.parse("2026-11-04T12:00:00Z"));
    expect(a.stat).toMatchObject({ headline: { value: "260 points" }, scope: expect.arrayContaining(["Relaxed: this week → 2025–26", "California"]) });
    expect(a.stat!.definition).toContain("this week → 2026–27, then 2026–27 → 2025–26");
    // A team's question too: its season instead of the week.
    const t = await ask("4215 highest score this week", Date.parse("2026-02-11T12:00:00Z"));
    expect(t.stat).toMatchObject({ headline: { value: expect.stringContaining("150") }, scope: expect.arrayContaining(["Relaxed: this week → 2025–26"]) });
  });
  it("a year named is never relaxed", async () => {
    const s = await stat("highest scoring match in romania in 2024-25");
    expect(s.none).toBeTruthy();
    expect(s.scope.some((c) => c.startsWith("Relaxed"))).toBe(false);
  });
  it("a window with its year typed keeps that year", async () => {
    for (const q of ["highest scoring match in California in february 2026", "highest scoring match in California on feb 3 2026"]) {
      const s = await stat(q);
      expect(s.none, q).toBeTruthy();
      expect(s.scope.some((c) => c.startsWith("Relaxed")), q).toBe(false);
    }
  });
  it("nothing after every step says which steps were tried", async () => {
    const s = await stat("highest scoring match in Texas this week");
    expect(s.headline).toBeFalsy();
    expect(s.none).toContain("Nothing in 2025–26 or 2024–25 either");
  });
  it("part of a region is all of it, said so", async () => {
    const a = await ask("highest scoring match in northern california this week");
    expect(a.stat?.scope).toContain("California");
    expect(a.understood?.label).toMatch(/Northern California isn't a separate region: all of California$/);
  });
  it("never a part of a region when the words are a whole region, a stored town or an event", async () => {
    expect(rewriteQuery("rookie teams in new south wales")?.q ?? "").not.toContain("new wales");
    const idx = await names();
    expect(idx.place("east brunswick")).toMatchObject({ kind: "city", city: "East Brunswick" });
    expect(idx.place("northern in", "northern IN")).toMatchObject({ kind: "region", state: "IN", part: "northern IN" });
    for (const q of ["highest score in east brunswick", "north texas championship"]) expect(rewriteQuery(q, await namedParts(q)), q).toBeNull();
    // A part with nothing stored by that name is still the whole region, even when an event's longer name starts
    // with it ("North Texas Championship"), and a region read by its case keeps it ("northern IN" is Indiana).
    expect(rewriteQuery("events in north jersey", await namedParts("events in north jersey"))?.q).toBe("events in new jersey");
    expect(rewriteQuery("rookie teams in north texas", await namedParts("rookie teams in north texas"))?.q).toBe("rookie teams in texas");
    expect(rewriteQuery("rookie teams in northern IN", await namedParts("rookie teams in northern IN"))?.q).toBe("rookie teams in indiana");
  });
  it("no place named is every place, never one region by default", async () => {
    const s = await stat("highest scoring match on mar 14 2026");
    expect(s.title).toBe("Highest-scoring match on Mar 14, 2026, DECODE 2025–26");
    expect(s.headline).toMatchObject({ value: "330 points" });
  });
  it("a country is a place: a team's own region, or none of its matches", async () => {
    expect((await stat("alphatronic record in romania")).headline).toMatchObject({ value: "1-1-0" });
    const nj = await stat("4215 record in romania");
    expect(nj.title).toBe("Record at events in Romania in 2025–26");
    expect(nj.none).toContain("events in Romania");
  });
});

describe("one question, any phrasing, any team", () => {
  const FORMS = ["{t} highest score", "highest score {t}", "what is the best score for {t}", "{t} top score please", "score highest {t} rn"];
  for (const [t, value] of [["4215", "150 points"], ["delta force", "330 points"], ["24033", "300 points"], ["10809", "260 points"]] as const) {
    it(`highest score for ${t}`, async () => {
      for (const f of FORMS) expect((await stat(f.replace("{t}", t))).headline, f).toMatchObject({ value: expect.stringContaining(value) });
    });
  }
  it("two teams' shared matches, either order, any words around them", async () => {
    for (const q of ["4215 and 6980 matches together", "matches 6980 4215 shared", "shared matches hypnotic robotics bad wolf"]) {
      const s = await stat(q);
      expect(s.title, q).toMatch(/^Matches with (4215 and 6980|6980 and 4215)$/);
      expect(s.headline?.value, q).toBe("2");
    }
  });
  it("a name typed nearly right offers the spelling, whatever stood between its words", async () => {
    const a = await ask("hypnotc-robotics highest score");
    expect(a.stat?.team?.number).toBe(4215);
    expect(a.didYouMean).toBe("Hypnotic Robotics highest score");
  });
});

describe("what the pipeline leaves to the other readers", () => {
  it("never answers a filter it can't apply", async () => {
    const { parseQuery } = await import("./parse");
    const { parseContext } = await import("./context");
    const ctx = await parseContext(NOW);
    for (const q of ["4215 and 6980 same alliance matches", "4215 average score without penalties", "4215 highest score without penalties"]) {
      expect((await parseQuery(q, ctx)).complete, q).toBe(false);
    }
  });
  it("season side-by-sides never take a place", async () => {
    const a = await ask("4215 vs 6980 opr in romania");
    expect(a.stat?.scope ?? []).not.toContain("Events in Romania");
  });
  it("a win streak is wins only; one award named is left to the readers that count it alone", async () => {
    const { parseQuery } = await import("./parse");
    const { parseContext } = await import("./context");
    const ctx = await parseContext(NOW);
    expect(await parseQuery("4215 current win streak", ctx)).toMatchObject({ intent: "current-streak", symbols: expect.arrayContaining(["outcome:W"]), complete: true });
    expect(await parseQuery("4215 losing streak", ctx)).toMatchObject({ intent: "current-streak", symbols: expect.arrayContaining(["outcome:L"]), complete: true });
    expect((await parseQuery("4215 vs 6980 inspire awards", ctx)).complete).toBe(false);
    expect(await parseQuery("4215 vs 6980 awards", ctx)).toMatchObject({ intent: "awards-vs", complete: true });
  });
  it("margin of victory is wins only", async () => {
    const { parseQuery } = await import("./parse");
    const { parseContext } = await import("./context");
    expect(await parseQuery("4215 margin of victory on average", await parseContext(NOW))).toMatchObject({ intent: "average-margin", symbols: expect.arrayContaining(["outcome:W"]), complete: true });
    expect((await stat("4215 margin of victory on average")).title).toMatch(/^Average winning margin/);
  });
});

describe("the match finder: matches by a measure, every filter applied and stated", () => {
  it("the closest, the most lopsided and the lowest, in a place and a season", async () => {
    const close = await stat("closest match in new jersey this season");
    expect(close.headline).toMatchObject({ value: "40-point margin", label: expect.stringMatching(/^Q2 /) });
    expect(close.scope).toEqual(expect.arrayContaining(["2025–26", "New Jersey"]));
    expect(close.definition).toMatch(/^The margin is /);
    expect((await stat("most lopsided match in romania this season")).headline?.value).toBe("210-point margin");
    expect((await stat("lowest scoring match in california this season")).headline?.value).toBe("210 points");
  });
  it("an upset by the call saved before the match; no season said is the current one, then the one before, said so", async () => {
    // November 2026: 2026–27 has begun, with nothing played in New Jersey yet.
    const a = await ask("biggest upset in new jersey", Date.parse("2026-11-04T12:00:00Z"));
    expect(a.stat?.headline?.value).toBe("60% favourite lost");
    expect(a.stat?.scope[0]).toBe("No 2026–27 matches yet in New Jersey; showing 2025–26");
    expect(a.understood?.label).not.toContain("No 2026–27 matches yet"); // the note is the chip alone
    expect(a.stat?.definition).not.toContain("No 2026–27 matches yet");
    // An upset is only a favourite's loss: a win the winner was expected to get is never one.
    const t = (await ask("biggest upsets in new jersey", Date.parse("2026-11-04T12:00:00Z"))).stat?.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows.every((r) => Number(String(r.cells.value).slice(0, -"% favourite lost".length)) > 50)).toBe(true);
    // "Last season" is the one before the current one, for a place as for the world.
    expect((await ask("biggest upset in new jersey last season", Date.parse("2026-11-04T12:00:00Z"))).stat?.scope[0]).toBe("2025–26");
  });
  it("the highest score with no season said: the current one, then the one before, as every place answer", async () => {
    const a = await ask("highest score in new jersey", Date.parse("2026-11-04T12:00:00Z"));
    expect(a.stat?.scope).toContain("No 2026–27 scored matches yet in New Jersey; showing 2025–26");
  });
  it("each match printed once: one asked for is the headline with the rest after it, a list its table alone", async () => {
    const one = await stat("closest match in pennsylvania this season");
    const after = one.blocks.find((b) => b.kind === "table");
    expect(one.headline).toBeDefined();
    expect(after && after.kind === "table" && after.rows[0].cells.rank).toBe(2);
    const list = await stat("closest matches in pennsylvania this season");
    expect(list.headline).toBeUndefined();
    const t = list.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows.map((r) => r.cells.rank)).toEqual(Array.from({ length: (after && after.kind === "table" ? after.rows.length : 0) + 1 }, (_, i) => i + 1));
  });
  it("a kind of event by its type words alone: league meets, qualifiers, championships, never another kind's matches", async () => {
    const q = await stat("closest match at qualifiers in pennsylvania this season");
    expect(q.scope).toContain("Qualifiers");
    expect(q.headline?.label).toMatch(/Keystone Qualifier/);
    const m = await stat("highest scoring match at a league meet in pennsylvania this season");
    expect(m.scope).toContain("League meets");
    expect(m.headline).toBeUndefined();
    expect((await stat("closest match at championships in pennsylvania this season")).scope).toContain("Championships");
  });
  it("a closest loss is a decided match too; every plural is a list", async () => {
    const l = await stat("closest loss in pennsylvania this season");
    expect(l.headline?.value).toBe("10-point margin");
    expect(l.scope).toContain("No ties");
    for (const q of ["biggest routs in pennsylvania this season", "closest wins in pennsylvania this season"]) expect((await stat(q)).headline, q).toBeUndefined();
  });
  it("the finals of a double-elimination bracket numbered from 0: its last match, never the opening 'F1'", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'USDEF1', 'Diamond Championship', 'Championship', 'Town', 'DE', 'USA', '2026-03-01', '2026-03-01', 't')");
    for (let a = 1; a <= 4; a++) await run("INSERT INTO alliances (season, code, number, captain) VALUES (2025, 'USDEF1', ?, ?)", [a, 30010 + a]);
    // Series 0 is the opening match, posted as F1 and the closest (1 point); series 5 is the grand final (6th of 6).
    for (const [series, label, red, blue] of [[0, "F1", 101, 100], [1, "M1", 150, 100], [2, "M2", 160, 100], [3, "M3", 170, 100], [4, "M4", 180, 100], [5, "M5", 130, 120]] as const) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USDEF1', 'playoff', ?, 1, ?, '2026-03-01T15:00:00Z', 1, ?, ?, ?, ?, 't')", [series, label, red, red, blue, blue]);
    }
    const s = await matchFindAnswer({ measure: "closest", season: 2025, region: null, level: "playoff", finals: true, kind: null, n: 5 });
    expect(s.headline?.label).toMatch(/^M5 /);
    expect(s.blocks).toEqual([]);
  });
  it("a date window is its own range, whichever season it was read in", async () => {
    const s = await matchFindAnswer({ measure: "closest", season: 2024, region: null, level: null, finals: false, kind: null, window: { from: "2026-02-01", to: "2026-02-10", label: "in early February" }, n: 5 });
    expect(s.headline?.label).toMatch(/Keystone Qualifier/);
  });
  it("a win or a loss said with the closest is a decided match, never a tie", async () => {
    expect((await stat("closest match in pennsylvania this season")).headline?.value).toBe("Tie");
    const s = await stat("closest win in pennsylvania this season");
    expect(s.headline?.value).toBe("10-point margin");
    expect(s.scope).toContain("No ties");
  });
  it("a match type with nothing in it is said, never another type's matches", async () => {
    const s = await stat("closest playoff match in new jersey this season");
    expect(s.headline).toBeUndefined();
    expect(s.scope).toContain("Playoff matches");
  });
  it("the finals are the finder's filter only: a team's finals record is never its playoff record", async () => {
    expect((await ask("4215 record in finals matches only")).stat?.title ?? "").not.toMatch(/playoffs/i);
  });
  it("a comeback needs the auto points: none on record is said with the rule", async () => {
    expect((await stat("biggest comeback in california this season")).none).toMatch(/^None of the 2 played matches in California in 2025–26 is one: a comeback is a match won/);
  });
});

describe("a win or a loss said with a team's match question is a filter", () => {
  it("the most recent loss, the first win, the last losses and the longest losing streak", async () => {
    const lost = await stat("when did 4215 last lose a match");
    expect(lost.title).toMatch(/^Most recent loss/);
    expect(lost.headline?.value).toMatch(/^Lost /);
    const won = await stat("4215 first win");
    expect(won.title).toMatch(/^First win/);
    expect(won.headline?.value).toMatch(/^Won /);
    const last = await stat("4215 last 2 losses");
    expect(last.title).toMatch(/^Last 2 losses/);
    // The fixture's 4215 has lost once: that one, said as one.
    expect(last.headline?.label).toBe("in the last 1 loss, oldest to newest L");
    expect((await stat("longest losing streak for 4215")).title).toMatch(/^Longest losing streak/);
    // No outcome said: every match, as before. The headline's match is printed once: the list is the ones before it.
    const recent = await stat("4215 last match");
    expect(recent.title).toMatch(/^Most recent match/);
    const before = recent.blocks[0];
    expect(before?.title).toMatch(/^The (\d+ )?match(es)? before$/);
    expect(JSON.stringify(before)).not.toContain(JSON.stringify(recent.headline?.href));
  });
  it("losing to someone is the opponents that beat the team; winning a match, its wins", async () => {
    for (const q of ["who did 4215 lose to the most times", "teams 4215 lost to most often"]) expect((await stat(q)).title, q).toMatch(/^Teams lost to most often/);
    // A count of them is another question: never answered with the one that beat it most.
    expect((await ask("how many teams has 4215 lost to")).stat?.title ?? "").not.toMatch(/^Teams lost to most often/);
    expect((await stat("did 4215 ever win a match")).title).toMatch(/^Match wins/);
    // "Most often" is how often, never the best: the partners list, not the best partner.
    expect((await stat("4215 partners most often")).title).toMatch(/^Alliance partners/);
  });
});

describe("forecasts", () => {
  it("a team at a named event: before and after side by side, Predict open on it", async () => {
    for (const q of ["predicted chances of 4215 garden qualifier", "4215 garden qualifier prediction", "garden qualifier forecast for hypnotic robotics"]) {
      const a = await ask(q);
      const s = a.stat as StatAnswer;
      expect(s.title, q).toBe("Prediction vs result at Garden Qualifier");
      // Live only: the replayed row for Q2 never joins the live ones.
      expect(s.headline, q).toMatchObject({ value: "1.3 → 1 wins", sub: expect.stringContaining("logged live before each match") });
      const t = s.blocks.find((b) => b.kind === "table");
      expect(t && t.kind === "table" && t.rows.map((r) => [r.cells.before, r.cells.after, r.cells.called]), q).toEqual([["70% · 140–100", "W 150–90", "Yes"], ["60% · 110–100", "L 80–120", "No"], ["55%", "Not played yet", "–"]]);
      expect(a.pages[0], q).toMatchObject({ title: "Open in Predict: 4215 at Garden Qualifier", href: "/predict?mode=advancement&season=2025&code=USNJQ1&team=4215" });
    }
  });
  it("two teams at an event: their meetings, before and after", async () => {
    const s = await stat("4215 vs 6980 at garden qualifier prediction");
    expect(s.title).toBe("Prediction vs result: 4215 and 6980 at Garden Qualifier");
    const t = s.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows.map((r) => r.cells.as)).toEqual(["partners", "opponents", "opponents"]);
  });
  it("a Leadership Award filed as a Winner is never the event won", async () => {
    const k = (await stat("4215 garden qualifier prediction")).blocks.find((b) => b.kind === "kpis");
    expect(k && k.kind === "kpis" && k.items.find((i) => i.label === "After: event")?.value).not.toBe("Won");
  });
  it("two teams who never met there: said so, never one team's event odds", async () => {
    const s = await stat("4215 vs 10809 at golden qualifier prediction");
    expect(s.headline).toBeFalsy();
    expect(s.none).toMatch(/No prediction was stored .* meeting at Golden Qualifier/);
  });
  it("a team not listed at the event is told so, never another event", async () => {
    expect((await stat("24033 garden qualifier prediction")).none).toContain("isn't listed at Garden Qualifier");
  });
  it("a season or a game named finds that season's event", async () => {
    for (const q of ["4215 garden qualifier prediction 2025-26", "4215 garden qualifier prediction in decode"]) {
      expect((await stat(q)).title, q).toBe("Prediction vs result at Garden Qualifier");
    }
  });
  it("a live log that covers only some played matches: the replay for all of them, none dropped", async () => {
    // Romania Championship's two matches (5 and 6): live for one only, the replay for both.
    await run("INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at) VALUES ('live', 2025, 'ROCMP', 'qual', 0, 5, '[24033]', '[17713]', 0.6, 200, 150, 'high', 't', '2026-03-13'), ('backtest', 2025, 'ROCMP', 'qual', 0, 5, '[24033]', '[17713]', 0.65, 210, 150, 'high', 't', '2026-03-13'), ('backtest', 2025, 'ROCMP', 'qual', 0, 6, '[24033]', '[17713]', 0.55, 190, 170, 'high', 't', '2026-03-13')");
    clearAllCaches();
    const s = await stat("24033 romania championship prediction");
    const t = s.blocks.find((b) => b.kind === "table");
    expect(t && t.kind === "table" && t.rows).toHaveLength(2);
    expect(s.headline?.sub).toMatch(/walk-forward replay/);
  });
});

describe("the eval's truth", () => {
  it("counts the matches the cards count: never a remote event's, never one without its points", async () => {
    const { teamTruth, newestSeason } = await import("./eval/truth");
    expect(await teamTruth(5555, 2025)).toMatchObject({ wins: 0, losses: 2, ties: 0, matches: 2, high: [110] });
    expect(await newestSeason(5555)).toBe(2025);
    // The card agrees.
    expect((await stat("5555 highest score")).headline?.value).toBe("110 points");
  });
});

describe("failure patterns", () => {
  it("one pattern for every team that fails the same way, the unread word kept beside it", async () => {
    const { failurePattern } = await import("./pattern");
    const a = await failurePattern("4215 opr scorecard", NOW), b = await failurePattern("hypnotic robotics opr scorecard", NOW), c = await failurePattern("24033 opr scoresheet", NOW);
    expect(a).toEqual({ key: "intent: team opr · slots: team · not read: 1 word", missed: ["scorecard"] });
    expect(b.key).toBe(a.key);
    expect(c).toEqual({ key: a.key, missed: ["scoresheet"] });
    // No name or number ever in the pattern.
    expect((await failurePattern("6980 vs 17713 zzz", NOW)).key).not.toMatch(/6980|17713/);
    // With no intent read, what it did read keeps different questions apart.
    expect((await failurePattern("4215 rp zzz qqq", NOW)).key).not.toBe((await failurePattern("4215 reliability zzz qqq", NOW)).key);
  });
});

describe("years", () => {
  it("a year is that season; none is the latest; a future year is said, never the latest", async () => {
    expect((await stat("4215 record 2025")).title).toBe("Record in 2025–26");
    const f = await ask("4215 record 2027");
    expect(f.stat).toMatchObject({ title: "No 2027–28 events yet", none: expect.stringContaining("no 2027–28 events on record yet") });
    expect(f.stat?.headline).toBeUndefined();
  });
});

describe("review fixes", () => {
  it("a date window decides alone: a week across the season's start takes both seasons' events", async () => {
    const { seasonClause, eventSql } = await import("../answers/clauses");
    const s = { season: 2025, window: { from: "2026-08-31", to: "2026-09-06", label: "this week" } };
    expect(seasonClause(s)({ season: 2026, code: "X", type: "Qualifier" })).toBe(true);
    expect(eventSql(s).sql).not.toMatch(/season = \?/);
    expect(seasonClause({ season: 2025 })({ season: 2026, code: "X", type: "Qualifier" })).toBe(false);
  });
  it("a count the answer can't list is left to search, never a card with another number of rows", async () => {
    const a = await ask("4215 top 3 scores");
    expect(a.intent?.understood?.[0] ?? "").not.toMatch(/^Intent:/);
  });
  it("the first or latest Finalist award keeps its pick", async () => {
    await run("INSERT INTO awards (season, code, team, type, name, placement) VALUES (2025, 'USNJQ1', 4215, 'Finalist', 'Finalist Alliance', 2)");
    clearAllCaches();
    const a = await ask("4215 latest finalist award");
    expect(a.intent?.understood?.[0]).toMatch(/^Intent:/);
    expect(a.stat?.intent).not.toBe("finalist-finishes");
  });
  it("a week across the season's start keeps each season's points apart", async () => {
    const ev = (season: number, code: string, start: string) =>
      run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', 'NJ', 'USA', ?, ?, 't')", [season, code, `${code} Qualifier`, start, start]);
    await ev(2025, "USNJLATE", "2026-08-31");
    await ev(2026, "USNJEARLY", "2026-09-02");
    const m = async (season: number, code: string, day: string, red: number) => {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, 1, 'Q1', ?, 1, ?, ?, 50, 50, 't')", [season, code, `${day}T10:00:00Z`, red, red]);
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, 1, 4215, 'red', 1)", [season, code]);
      await run("INSERT OR IGNORE INTO event_teams (season, code, team, rank) VALUES (?, ?, 4215, 1)", [season, code]);
    };
    await m(2025, "USNJLATE", "2026-08-31", 400);
    await m(2026, "USNJEARLY", "2026-09-02", 90);
    clearAllCaches();
    const s = await stat("4215 highest score this week", Date.parse("2026-09-03T12:00:00Z"));
    const each = s.blocks.find((b) => b.kind === "table" && /each season/.test(b.title));
    expect(each, JSON.stringify(s.blocks.map((b) => b.kind))).toBeTruthy();
  });
});
