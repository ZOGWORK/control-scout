// The pipeline run end to end on a small database (docs/search-pipeline.md): the slots applied as filters and stated on
// the card, the same card for every phrasing of one question and every team, a year honoured, a future year said.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
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
  for (const t of [4215, 6980, 24033, 17713, 10809, 5555]) {
    await run("INSERT OR IGNORE INTO team_event_stats (season, code, team, opr_np, matches) SELECT season, code, team, 50, 1 FROM event_teams WHERE team = ?", [t]);
  }
  // The engine's predictions for the two Garden Qualifier matches: one logged live, one replayed (a card shows one kind).
  await run("INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at) VALUES ('live', 2025, 'USNJQ1', 'qual', 0, 1, '[4215,6980]', '[10809]', 0.7, 140, 100, 'high', 't', '2026-01-09'), ('live', 2025, 'USNJQ1', 'qual', 0, 2, '[4215]', '[6980]', 0.6, 110, 100, 'medium', 't', '2026-01-09'), ('backtest', 2025, 'USNJQ1', 'qual', 0, 2, '[4215]', '[6980]', 0.2, 90, 120, 'medium', 't', '2026-01-09')");
  // A meeting still to come at the same event, its call saved before any rated match (win odds only, no score).
  await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2025, 'USNJQ1', 'qual', 0, 99, 'Q99', '2026-01-10T18:00:00Z', 0, 't')");
  await run("INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, no_score_basis, tier, engine_version, predicted_at) VALUES ('live', 2025, 'USNJQ1', 'qual', 0, 99, '[4215]', '[6980]', 0.55, 100, 100, 1, 'low', 't', '2026-01-09')");
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
    expect(a.understood?.label).toMatch(/relaxed from this week to 2025–26$/);
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
