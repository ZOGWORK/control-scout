// Rules questions answered from the Rules quick reference (server/api/searchRules.ts, src/shared/searchRuleQuery.ts):
// the FTC One Search brief's Requirement 15 and test 22.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { invalidateFlags, setFlag } from "../flags";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { readRuleQuery } from "../../src/shared/searchRuleQuery";

const S = CURRENT_SEASON;
const CAN_TEAMS: [number, string][] = [[28917, "We Can Robotic Team"], [29548, "Can Control"], [30665, "She Can Code Society"], [21771, "Paint Can"], [24147, "Fools That Can"], [11545, "Dread Pirate Robots"]];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of CAN_TEAMS) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Austin', 'TX', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'X', ?, 50, 5)", [S, n]);
  }
  await rebuildSearch();
});
beforeEach(async () => { await setFlag("rulesReference", true, "test"); invalidateFlags(); });

describe("reading a rules question", () => {
  it("reads rule words in a question, a rule number, or an opening 'penalty'", () => {
    expect(readRuleQuery("Can robots descore sample elements in autonomous?")).toEqual({ id: null, keywords: ["descore", "sample", "elements", "auto"], past: { sample: 2024 } });
    expect(readRuleQuery("how many points for a specimen")).toMatchObject({ past: { specimen: 2024 } });
    expect(readRuleQuery("robots can descore", true)).toMatchObject({ keywords: ["descore"] });
    expect(readRuleQuery("penalty for hoarding")).toEqual({ id: null, keywords: ["hoard"] });
    expect(readRuleQuery("g402")).toEqual({ id: "G402", keywords: [] });
    expect(readRuleQuery("rule 10.5.1")).toMatchObject({ id: "10.5.1" });
  });
  it("leaves names and other questions alone", () => {
    for (const q of ["can control", "we can robotic team", "4215", "when did hypnotic go to worlds", "best auto team", "how good is simply complex", "meets in New Jersey", "rules", "who are the rubber ducks?", "specimen"]) expect(readRuleQuery(q), q).toBeNull();
  });
});

describe("the answer", () => {
  it("test 22: no team is ever listed, and a past game's piece is that game's question, never this season's rules", async () => {
    const a = await searchAnswer("Can robots descore sample elements in autonomous?");
    expect(a.hits).toEqual([]);
    expect(a.recovery).toBeUndefined();
    // SAMPLES are INTO THE DEEP's (2024–25): which game, and links to its manual and season. No BIOBUZZ rule.
    expect(a.card).toMatchObject({ kind: "rule", title: "INTO THE DEEP 2024–25 rules" });
    expect(a.card!.lines.map((l) => l.text)).toEqual(['"sample" is from INTO THE DEEP (2024–25)', "INTO THE DEEP game manual", "INTO THE DEEP 2024–25 season"]);
    expect(a.card!.lines[2].href).toBe("/events?season=2024");
    expect(a.card!.lines[1]).toMatchObject({ detail: "Competition Manual (PDF)", href: "https://ftc-resources.firstinspires.org/ftc/archive/2025/game/manual" });
    // Each past game links its own manual: CENTERSTAGE's pixels, POWERPLAY's cones.
    expect((await searchAnswer("can robots score pixels on the backdrop?")).card!.lines[1].href).toBe("https://ftc-resources.firstinspires.org/ftc/archive/2024/game/gm2");
    expect((await searchAnswer("how many points is a cone worth?")).card!.lines[1].href).toBe("https://ftc-resources.firstinspires.org/ftc/archive/2023/game/gm2");
    expect(a.understood).toMatchObject({ kind: "question", season: 2024 });
  });
  it("no rule in this season's reference is said plainly, never guessed", async () => {
    const a = await searchAnswer("Can robots descore elements in autonomous?");
    expect(a.hits).toEqual([]);
    expect(a.card).toMatchObject({ kind: "rule", lines: [] });
    expect(a.card!.none).toMatch(/^No rule found for "descore elements auto" in the BIOBUZZ 2026–27 quick reference/);
    expect(a.pages.map((p) => p.href)).toContain("/rules");
  });
  it("lists the rules the reference has, each with its number, summary and penalty, linked to /rules", async () => {
    const a = await searchAnswer("penalty for hoarding");
    expect(a.card!.lines).toEqual([expect.objectContaining({ text: "G411 · Don't hoard scoring elements", results: ["Penalty: Major foul and yellow card per match"], href: "/rules#G411" })]);
    expect((await searchAnswer("G402")).card!.lines[0].text).toBe("G402 · No AUTO interference");
    expect((await searchAnswer("can robots control the other alliance nectar?")).card!.lines.map((l) => l.text)).toEqual(["G408 · Don't control the other alliance's NECTAR"]);
  });
  it("says so when the reference is switched off, still with no teams", async () => {
    await setFlag("rulesReference", false, "test"); invalidateFlags();
    const a = await searchAnswer("penalty for hoarding");
    expect(a.hits).toEqual([]);
    expect(a.card).toMatchObject({ kind: "rule", lines: [] });
    expect(a.card!.none).toMatch(/switched off/);
  });
  it("a team named Can is still found by its name", async () => {
    expect((await searchAnswer("can control")).hits[0]).toMatchObject({ ref: "29548" });
  });
});
