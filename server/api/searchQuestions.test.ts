// Questions search answers directly (server/api/searchQuestions.ts), on a small fixture database: what's read as a
// question, the Worlds card from FIRST Championship events only (and an honest "none found" with the closest real
// records), wins and awards, next event and match only when published. Plus the versus fixes that came with them:
// run-together names ("badwolf"), Compare opened on awards, and a never-played registration naming no team.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { parseQuestion } from "./searchQuestions";
import { hitHref } from "../../src/shared/search";
import { fuzzyScore } from "../../src/shared/fuzzy";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [19635, "ZZZ delete this team2"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (season: number, code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Houston', 'TX', 'USA', ?, ?, 't')", [season, code, name, type, start, start]);
  await ev(2023, "FTCCMP1EDIS", "2024 FIRST Championship - Edison Division", "FIRSTChampionship", "2024-04-17");
  await ev(2023, "FTCCMP1", "2024 FIRST Championship", "FIRSTChampionship", "2024-04-20");
  await ev(2023, "USNJCMP", "New Jersey State Championship", "Championship", "2024-03-17");
  await ev(2024, "FTCCMP1EDIS", "FIRST Championship - Edison Division", "FIRSTChampionship", "2025-04-16");
  await ev(2025, "FUTURE", "Bergen Qualifier", "Qualifier", "2099-01-10");
  // 4215 played its 2024 division (ranked 3rd); 6980 was on the 2025 division's list but never took the field.
  await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties) VALUES (2023, 'FTCCMP1EDIS', 4215, 3, 9, 1, 0), (2023, 'USNJCMP', 4215, 1, 6, 0, 0), (2023, 'USNJCMP', 6980, 12, 2, 4, 0), (2024, 'FTCCMP1EDIS', 6980, NULL, 0, 0, 0), (2025, 'FUTURE', 6980, NULL, NULL, NULL, NULL)");
  const match = (season: number, code: string, n: number, played: number, time: string | null, teams: [number, string, number][]) => Promise.all([
    run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 't')", [season, code, n, `Q${n}`, time, played]),
    ...teams.map(([t, alliance, on]) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?)", [season, code, n, t, alliance, on])),
  ]);
  await match(2023, "FTCCMP1EDIS", 1, 1, "2024-04-18T09:00:00", [[4215, "red", 1]]);
  await match(2024, "FTCCMP1EDIS", 1, 1, "2025-04-17T09:00:00", [[6980, "blue", 0]]);
  await match(2025, "FUTURE", 7, 0, "2099-01-10T10:30:00", [[6980, "red", 1]]);
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2023, 'USNJCMP', 'Winner', 1, 4215), (2023, 'FTCCMP1EDIS', 'Finalist', 1, 4215), (2023, 'USNJCMP', 'Design', 2, 4215)");
  // Played: a team counts for versus only once it has (19635 never has).
  for (const n of [4215, 6980]) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2023, 'USNJCMP', ?, 50, 5)", [n]);
  await rebuildSearch();
});

describe("what's read as a question", () => {
  it("reads the kind and the words that name the team", () => {
    expect(parseQuestion("when did hypnotics robotics go to worlds")).toEqual({ kind: "worlds", core: "hypnotics robotics", year: null });
    expect(parseQuestion("did hypnotic go to worlds in 2025")).toEqual({ kind: "worlds", core: "hypnotic", year: 2025 });
    expect(parseQuestion("when did 4215 go to worlds")).toMatchObject({ kind: "worlds", core: "4215" });
    expect(parseQuestion("what events did hypnotic win")).toMatchObject({ kind: "wins", core: "hypnotic" });
    expect(parseQuestion("has bad wolf won anything")).toMatchObject({ kind: "awards", core: "bad wolf" });
    expect(parseQuestion("when is hypnotic's next match")).toMatchObject({ kind: "next-match", core: "hypnotic" });
    expect(parseQuestion("when is hypnotic's next event")).toMatchObject({ kind: "next-event", core: "hypnotic" });
  });
  it("a bare 2000–2099 is a team; only \"in/during <year>\" is a year", () => {
    expect(parseQuestion("when did team 2025 go to worlds")).toEqual({ kind: "worlds", core: "2025", year: null });
    expect(parseQuestion("did 2025 go to worlds in 2024")).toEqual({ kind: "worlds", core: "2025", year: 2024 });
  });
  it("leaves names and plain searches alone", () => {
    for (const q of ["worlds", "world robot contest", "hypnotic robotics", "hypnotic awards", "4215 vs 6980", "hypnotic worlds"]) expect(parseQuestion(q), q).toBeNull();
  });
});

describe("the answer cards", () => {
  it("Worlds: the team's FIRST Championship division, misspelled or by number, linked to the event on the team", async () => {
    for (const q of ["when did hypnotic robotics go to worlds", "when did hypnotics robotics go to worlds", "when did 4215 go to worlds", "did hypnotic go to worlds"]) {
      const a = await searchAnswer(q);
      expect(a.step, q).toBe("deterministic");
      expect(hitHref(a.hits[0]), q).toBe("/teams/4215#events");
      expect(a.card?.lines.map((l) => [l.text, l.href]), q).toEqual([["2024 FIRST Championship - Edison Division", "/events/2023/FTCCMP1EDIS?team=4215"]]);
      expect(a.card!.lines[0].detail).toBe("2023–24 · Apr 17, 2024 · Houston, TX · ranked #3 · 9-1-0 in quals · Finalist Alliance");
    }
  });
  it("Worlds in a year it didn't go: says so, and lists its real trips; a team that never went: none, and its state championship", async () => {
    const y = (await searchAnswer("did hypnotic go to worlds in 2025")).card!;
    expect(y.lines).toEqual([]);
    expect(y.none).toBe("No Worlds appearance in 2025 found in Hypnotic Robotics's recorded event history.");
    expect(y.closest!.map((l) => l.text)).toEqual(["2024 FIRST Championship - Edison Division"]);
    // 6980 was listed for a division but never took the field: no appearance (never a made-up one).
    const n = (await searchAnswer("when did bad wolf go to worlds")).card!;
    expect(n.none).toBe("No Worlds appearances found in Bad Wolf's recorded event history.");
    expect(n.closest!.map((l) => l.text)).toEqual(["New Jersey State Championship"]);
  });
  it("wins and awards, from the awards on record; none said plainly", async () => {
    expect((await searchAnswer("what events did hypnotic win")).card!.lines.map((l) => l.text)).toEqual(["Won New Jersey State Championship"]);
    const all = (await searchAnswer("has hypnotic won anything")).card!.lines.map((l) => l.text);
    expect(all).toEqual(expect.arrayContaining(["Winning Alliance: New Jersey State Championship", "Design 2nd: New Jersey State Championship", "Finalist Alliance: 2024 FIRST Championship - Edison Division"]));
    const none = await searchAnswer("has bad wolf won anything");
    expect(none.card).toMatchObject({ lines: [], none: "No awards found in Bad Wolf's recorded history." });
    expect(hitHref(none.hits[0])).toBe("/teams/6980#awards");
  });
  it("next event and match: only what's published; none said plainly", async () => {
    const m = (await searchAnswer("when is bad wolf's next match")).card!;
    expect(m.lines.map((l) => [l.text, l.href])).toEqual([["Q7 at Bergen Qualifier", "/events/2025/FUTURE?match=qual:0:7"]]);
    expect((await searchAnswer("when is bad wolf's next event")).card!.lines.map((l) => l.text)).toEqual(["Bergen Qualifier"]);
    const none = (await searchAnswer("when is hypnotic's next event")).card!;
    expect(none).toMatchObject({ lines: [], none: "No upcoming event is published for Hypnotic Robotics yet." });
    expect((await searchAnswer("when is hypnotic's next match")).card!.none).toMatch(/^No upcoming match is scheduled for Hypnotic Robotics yet/);
  });
  it("an event is on until its last day ends at its venue, not in UTC", async () => {
    // Bad Wolf plays in Los Angeles on Oct 18; at 02:00 UTC on the 19th it's still the 18th's evening there.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (2026, 'USCALA', 'Los Angeles Qualifier', 'Qualifier', 'Los Angeles', 'CA', 'USA', '2026-10-18', '2026-10-18', 'America/Los_Angeles', 't')");
    await run("INSERT INTO event_teams (season, code, team) VALUES (2026, 'USCALA', 6980)");
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2026, 'USCALA', 'qual', 0, 30, 'Q30', '2026-10-18T19:10:00', 0, 't')");
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2026, 'USCALA', 'qual', 0, 30, 6980, 'blue', 1)");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-19T02:00:00Z"));
      expect((await searchAnswer("when is bad wolf's next match")).card!.lines[0].text).toBe("Q30 at Los Angeles Qualifier");
      expect((await searchAnswer("when is bad wolf's next event")).card!.lines[0].text).toBe("Los Angeles Qualifier");
      vi.setSystemTime(new Date("2026-10-19T09:00:00Z")); // 02:00 on the 19th in Los Angeles: over
      expect((await searchAnswer("when is bad wolf's next match")).card!.lines[0].text).toBe("Q7 at Bergen Qualifier");
      expect((await searchAnswer("when is bad wolf's next event")).card!.lines[0].text).toBe("Bergen Qualifier");
    } finally {
      vi.useRealTimers();
      await run("DELETE FROM match_teams WHERE code = 'USCALA'");
      await run("DELETE FROM matches WHERE code = 'USCALA'");
      await run("DELETE FROM event_teams WHERE code = 'USCALA'");
      await run("DELETE FROM events WHERE code = 'USCALA'");
    }
  });
  it("a question whose team isn't found goes on as a plain search (no card about nobody)", async () => {
    const a = await searchAnswer("when did qqzzxx go to worlds");
    expect(a.card).toBeUndefined();
  });
});

describe("no flag and no key", () => {
  // Core search is deterministic: the brunoSearch flag gates only Bruno AI's reading (/api/search/refine), and Bruno
  // needs CONTROL_POINT_INTERNAL_URL and _KEY (none here). On or off, with no key, every answer is the same.
  it("gives the same answers with brunoSearch on and off, with no AI configured", async () => {
    const { setFlag, invalidateFlags } = await import("../flags");
    const { refine } = await import("./searchBruno");
    const qs = ["4215 vs 6980", "hypnotic robotics vs badwolf", "when did hypnotics robotics go to worlds", "has bad wolf won anything", "asdfgh"];
    const off = await Promise.all(qs.map((q) => searchAnswer(q, { learn: false })));
    await setFlag("brunoSearch", true, "test");
    invalidateFlags();
    try {
      expect(await Promise.all(qs.map((q) => searchAnswer(q, { learn: false })))).toEqual(off);
      expect(await refine("asdfgh")).toBeNull(); // no key: Bruno's slot stays empty, nothing fails
    } finally { await setFlag("brunoSearch", false, "test"); invalidateFlags(); }
  });
});

describe("site pages", () => {
  it("a page's word with only near-miss names answers with the page alone; a partial word lists no page", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (27275, 'Iron Hawkings', 'Durango', 'DUR', 'Mexico')");
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2023, 'USNJCMP', 27275, 40, 5)");
    await rebuildSearch();
    const a = await searchAnswer("rankings");
    expect(a).toMatchObject({ hits: [], step: "deterministic", weak: false });
    expect(a.pages.map((p) => p.href)).toContain("/rankings");
    expect((await searchAnswer("rec")).pages).toEqual([]);
    // A name beside the page word keeps its corrected result: the team first, the page below.
    const t = await searchAnswer("hipnotic rankings");
    expect(t.hits[0]?.ref).toBe("4215");
    expect(t.pages.map((p) => p.href)).toContain("/rankings");
  });
});

describe("versus and names", () => {
  it("words typed run together match a name's words side by side", () => {
    expect(fuzzyScore("badwolf", "Bad Wolf")).toBe(1);
    expect(fuzzyScore("badwulf", "Bad Wolf")).toBeGreaterThan(0.6);
    expect(fuzzyScore("bad", "Bad Wolf")).toBe(1);
    expect(fuzzyScore("adw", "Bad Wolf")).toBe(0); // only whole run-together words, never a piece across two
  });
  it("Compare from any spelling and order; '… awards' opens it on awards", async () => {
    for (const q of ["4215 vs 6980", "hypnotic robotics vs badwolf", "bad wolf versus hypnotic", "hypnotic vs bad wolf history"]) {
      expect(hitHref((await searchAnswer(q)).hits[0]), q).toBe("/compare?teams=4215,6980");
    }
    expect(hitHref((await searchAnswer("hypnotic vs bad wolf awards")).hits[0])).toBe("/compare?teams=4215,6980#awards");
    expect((await searchAnswer("badwolf")).hits[0].ref).toBe("6980");
  });
  it("a name matching only a never-played registration names no team: the recovery note, never a broken Compare", async () => {
    const a = await searchAnswer("4215 vs zzz");
    expect(a.step).toBe("recovery");
    expect(a.recovery!.understood).toContain('No team found for "zzz"');
    expect(a.recovery!.closest.map((h) => h.ref)).toEqual(["4215"]);
  });
});
