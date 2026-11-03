// Compare as its own kind, and a shared name read by fixed rules (server/api/searchCompare.ts): the FTC One Search
// brief's Requirement 13 and test 18.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { answerSections } from "../../src/shared/searchSections";
import { hitHref, showingLine } from "../../src/shared/search";

const ask = (q: string, prefer: string[] = []) => searchAnswer(q, { limit: 25, learn: false, prefer: new Set(prefer) });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, name, city, state, the last season it played (null: never)
  const teams: [number, string, string, string, number | null][] = [
    [4215, "Hypnotic Robotics", "Oradell", "NJ", 2025], [6980, "Bad Wolf", "Oradell", "NJ", 2025],
    [20245, "Ultraviolet", "Norton Shores", "MI", 2025], [23268, "Ultraviolet", "Hackettstown", "NJ", 2025], [18304, "Ultraviolet", "Marietta", "GA", null],
    [9637, "Dominican Ultraviolet", "New Orleans", "LA", 2025], [11111, "Twin Gears", "Austin", "TX", 2024], [22222, "Twin Gears", "Reno", "NV", 2025],
  ];
  for (const [n, name, city, state, last] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, 'USA')", [n, name, city, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [last ?? 2025, n]);
    if (last != null) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'X', ?, 50, 5)", [last, n]);
  }
  await rebuildSearch();
});

describe("Compare is its own kind", () => {
  it("is never a team: its own group above Teams, which counts only teams", async () => {
    const a = await ask("ultraviolet vs hypnotic history");
    expect(a.hits[0]).toMatchObject({ kind: "compare", ref: "4215,23268", href: "/compare?teams=4215,23268", title: "4215 Hypnotic Robotics vs 23268 Ultraviolet", subtitle: "Compare side by side: records, OPR and event history" });
    const { sections } = answerSections(a);
    expect(sections.map((s) => s.id).slice(0, 2)).toEqual(["compare", "team"]);
    expect(sections.find((s) => s.id === "team")!.rows).toHaveLength(2);
    expect(hitHref(a.hits[0])).toBe("/compare?teams=4215,23268");
    expect(showingLine(a)).toBe("Compare: Hypnotic Robotics (4215) vs Ultraviolet (23268)");
  });
  it("names each team's number and place", async () => {
    const a = await ask("ultraviolet vs hypnotic");
    expect(a.hits[0].compare?.teams).toEqual([{ number: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ" }, { number: 23268, name: "Ultraviolet", place: "Hackettstown, NJ" }]);
  });
  it("trailing words never break the versus", async () => {
    for (const [q, ref] of [["ultraviolet vs hypnotic history", "4215,23268"], ["4215 vs 6980 history", "4215,6980"], ["4215 vs 6980 record", "4215,6980"], ["hypnotic vs bad wolf stats", "4215,6980"]]) {
      expect((await ask(q)).hits[0], q).toMatchObject({ kind: "compare", ref });
    }
  });
});

describe("a name several teams share (Requirement 13.4)", () => {
  it("picks by the documented rules, records the pick, and every surface agrees", async () => {
    // Three Ultravioletes: 18304 never played; 20245 (MI) and 23268 (NJ) both played 2025; Hypnotic is in NJ.
    const a = await ask("ultraviolet vs hypnotic");
    expect(a.hits[0].compare?.resolved).toEqual([{ typed: "ultraviolet", number: 23268, rule: "the one in the same state as the other team (NJ)", candidates: [18304, 20245, 23268] }]);
    // The same answer at any limit (the header box's, the page's).
    expect((await searchAnswer("ultraviolet vs hypnotic", { limit: 5, learn: false })).hits[0]).toEqual(a.hits[0]);
  });
  it("your own team wins a shared name", async () => {
    expect((await ask("ultraviolet vs hypnotic", ["team:20245"])).hits[0]).toMatchObject({ ref: "4215,20245" });
  });
  it("the newest season played wins next", async () => {
    expect((await ask("twin gears vs hypnotic")).hits[0]).toMatchObject({ ref: "4215,22222", compare: { resolved: [{ number: 22222, rule: "the one that played most recently" }] } });
  });
  it("still tied: the candidates, never a guess", async () => {
    const a = await ask("ultraviolet vs dominican ultraviolet");
    expect(a.hits.filter((h) => h.kind === "compare").map((h) => h.ref)).toEqual(["9637,20245", "9637,23268"]);
    expect(a.understood?.label).toBe('Which "ultraviolet"? 2 teams have that name: 20245 (Norton Shores, MI), 23268 (Hackettstown, NJ)');
  });
});

describe("Greptile on #436", () => {
  it("your own team wins a shared name even before it has played", async () => {
    expect((await ask("ultraviolet vs hypnotic", ["team:18304"])).hits[0]).toMatchObject({ ref: "4215,18304", compare: { resolved: [{ number: 18304, rule: "your team", candidates: [18304, 20245, 23268] }] } });
  });
  it("records the played rule when it decides", async () => {
    // Twin Gears 11111 played 2024, 22222 played 2025: the newest wins; a never-played twin is out first.
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (33333, 'Solo Star', 'Austin', 'TX', 'USA'), (33334, 'Solo Star', 'Reno', 'NV', 'USA')");
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'X', 33333, 40, 5)");
    expect((await ask("solo star vs hypnotic")).hits[0]).toMatchObject({ ref: "4215,33333", compare: { resolved: [{ number: 33333, rule: "the only one that has played", candidates: [33333, 33334] }] } });
  });
  it("any trailing words: the side's last words go until it names a team", async () => {
    for (const q of ["4215 vs 6980 please", "4215 vs 6980 performance", "hypnotic vs bad wolf please"]) expect((await ask(q)).hits[0], q).toMatchObject({ kind: "compare", ref: "4215,6980" });
  });
  it("several sides tied: the question for each, never a one-team Compare", async () => {
    const a = await ask("ultraviolet vs twin gears");
    // Twin Gears resolves by newest season (22222); Ultraviolet stays tied between the two 2025 teams.
    expect(a.hits.filter((h) => h.kind === "compare").every((h) => h.ref.split(",").length === 2)).toBe(true);
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (44441, 'Mirror', 'Austin', 'TX', 'USA'), (44442, 'Mirror', 'Reno', 'NV', 'USA')");
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'X', 44441, 40, 5), (2025, 'X', 44442, 40, 5)");
    const b = await ask("ultraviolet vs mirror");
    expect(b.hits.filter((h) => h.kind === "compare")).toEqual([]);
    expect(b.understood?.label).toMatch(/^Which "ultraviolet"\? .* · Which "mirror"\? 2 teams have that name/);
  });
});

describe("Greptile on #436, round 2", () => {
  it("a shared name is found however it's spelled: accents, case, punctuation", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (55551, 'Café Robotics', 'Austin', 'TX', 'USA'), (55552, 'Cafe Robotics', 'Newark', 'NJ', 'USA')");
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'X', 55551, 40, 5), (2025, 'X', 55552, 40, 5)");
    await rebuildSearch();
    // Both are candidates; the NJ one is picked by state beside Hypnotic.
    expect((await ask("cafe robotics vs hypnotic")).hits[0]).toMatchObject({ ref: "4215,55552", compare: { resolved: [{ candidates: [55551, 55552] }] } });
  });
});

describe("Greptile on #436, round 3", () => {
  it("the shared-name question is in the notes every surface shows", async () => {
    const { notes } = answerSections(await ask("ultraviolet vs dominican ultraviolet"));
    expect(notes.understood).toContain('Which "ultraviolet"? 2 teams have that name: 20245 (Norton Shores, MI), 23268 (Hackettstown, NJ)');
  });
  it("no stored state is never 'the same state'", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (66661, 'Nowhere', 'X', NULL, 'Romania'), (66662, 'Twins', 'A', NULL, 'Romania'), (66663, 'Twins', 'B', 'TX', 'USA')");
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'X', 66661, 40, 5), (2025, 'X', 66662, 40, 5), (2025, 'X', 66663, 40, 5)");
    await rebuildSearch();
    const a = await ask("twins vs nowhere");
    expect(a.understood?.label).toMatch(/^Which "twins"?/);
  });
});

describe("Greptile on #436, round 4", () => {
  it("a tied candidate the other side already named is never offered against itself", async () => {
    // "twins" stays tied (66662 has no stored state); 66662 is the other side, so the one choice is 66663.
    const a = await ask("twins vs 66662");
    expect(a.hits.filter((h) => h.kind === "compare").map((h) => h.ref)).toEqual(["66662,66663"]);
    expect(a.hits.filter((h) => h.kind === "team").map((h) => h.ref)).toEqual(["66662", "66663"]);
  });
});
