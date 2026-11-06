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
    expect(a.card).toMatchObject({ kind: "rule" });
    expect(a.card!.lines.map((l) => l.text)).toEqual(["BIOBUZZ game manual"]); // the manual, never a rule
    expect(a.card!.none).toMatch(/switched off/);
  });
  it("a team named Can is still found by its name", async () => {
    expect((await searchAnswer("can control")).hits[0]).toMatchObject({ ref: "29548" });
  });
});

describe("Greptile on #437", () => {
  it("leaves team questions, best-score questions and match numbers to their own readers", () => {
    for (const q of ["how good is Can Control", "where is Can Control", "USNJCMP Q123", "q123", "m12"]) expect(readRuleQuery(q), q).toBeNull();
    expect(readRuleQuery("G402")).toMatchObject({ id: "G402" });
    expect(readRuleQuery("T201")).toMatchObject({ id: "T201" });
  });
  it("a best-score question is never a rules card", async () => {
    expect((await searchAnswer("What was the highest scoring match this season?")).card?.kind).not.toBe("rule");
  });
  it("a number asked about an older game's piece is that game's", async () => {
    expect(readRuleQuery("does G402 apply to samples?")).toEqual({ keywords: [], id: "G402", past: { sample: 2024 } });
    expect((await searchAnswer("does G402 apply to samples?")).card?.title).toBe("INTO THE DEEP 2024–25 rules");
  });
  it("scoring entries say what they're worth, not a penalty", async () => {
    const line = (await searchAnswer("rule 10.5.1")).card?.lines[0];
    expect(line?.results?.[0]).toMatch(/^Worth: /);
  });
  it("switched off: the official manual as a real link", async () => {
    await setFlag("rulesReference", false, "test"); invalidateFlags();
    const a = await searchAnswer("penalty for hoarding");
    expect(a.card?.lines[0]?.href).toMatch(/^https:\/\/ftc-resources\.firstinspires\.org\//);
  });
});

describe("Greptile on #437, round 2", () => {
  it("a season named outright picks that game", async () => {
    await setFlag("rulesReference", true, "test"); invalidateFlags();
    expect(readRuleQuery("G402 in 2024-25")).toMatchObject({ id: "G402", season: 2024 });
    expect(readRuleQuery("G402 in INTO THE DEEP")).toMatchObject({ id: "G402", season: 2024 });
    const a = await searchAnswer("G402 in 2024-25");
    expect(a.card?.title).toBe("INTO THE DEEP 2024–25 rules");
    expect(a.card?.lines[0].text).toBe("A INTO THE DEEP (2024–25) rule: G402");
    expect((await searchAnswer("G402 in 2026-27")).card?.lines[0].text).toBe("G402 · No AUTO interference");
  });
  it("a conversational opening keeps a real rules question", async () => {
    expect(readRuleQuery("where is the rule on pinning")).toMatchObject({ id: null });
    expect(readRuleQuery("how good is Can Control")).toBeNull();
  });
});

describe("Greptile on #437, round 3", () => {
  it("a season named outright wins over an older game's words, the current season too", async () => {
    await setFlag("rulesReference", true, "test"); invalidateFlags();
    expect(readRuleQuery("G402 in 2026-27 for samples")).toMatchObject({ id: "G402", season: 2026, past: { sample: 2024 } });
    expect((await searchAnswer("G402 in 2026-27 for samples")).card?.lines[0].text).toBe("G402 · No AUTO interference");
  });
});

describe("Greptile on #437, round 4", () => {
  it("a rule number spelled with a hyphen or a space", () => {
    for (const q of ["rule G-421", "rule g 421", "G-421", "g421"]) expect(readRuleQuery(q), q).toMatchObject({ id: "G421" });
  });
});

describe("a short keyword is a whole word (live check of #437)", () => {
  it("'pinning' finds the pinning rule, never one about pinch points", async () => {
    await setFlag("rulesReference", true, "test"); invalidateFlags();
    const a = await searchAnswer("penalty for pinning");
    expect(a.card?.lines.map((l) => l.text.split(" · ")[0])).toContain("G421");
    expect(a.card?.lines.map((l) => l.text.split(" · ")[0])).not.toContain("R603");
  });
});

describe("a penalty question about teams is their numbers, never the rules", () => {
  it("which team fouls the most or the least in a place: the teams by penalty points given away a match", async () => {
    let pen = 1;
    for (const [n] of CAN_TEAMS) await run("INSERT INTO team_season_stats (season, team, opr_np, rating_np, rating_pen, matches, rating_matches, wins, losses, ties) VALUES (?, ?, 50, 50, ?, 10, 10, 5, 5, 0)", [S, n, pen++]);
    // A team whose estimate rests on fewer rated matches than the cutoff (no-shows aren't rated) isn't ranked.
    await run("UPDATE team_season_stats SET rating_pen = 0, rating_matches = 1 WHERE season = ? AND team = ?", [S, CAN_TEAMS[5][0]]);
    const least = await searchAnswer("which team fouls the least in Texas", { limit: 25, full: true });
    const rows = least.stat?.blocks.find((b) => b.kind === "leaderboard");
    expect(rows?.kind === "leaderboard" && rows.rows.map((r) => r.team.label)).not.toContain(`${CAN_TEAMS[5][0]} ${CAN_TEAMS[5][1]}`);
    expect(least.card?.kind).not.toBe("rule");
    expect(least.stat).toMatchObject({ family: "leaderboard", intent: "top-penalties" });
    const most = await searchAnswer("which Texas team gives away the most penalty points per match", { limit: 25, full: true });
    expect(most.stat?.title).toMatch(/^Team in Texas with the most penalties a match/);
    // Fewer is better: "best" is the fewest, "worst" the most.
    const firstOf = (a: Awaited<ReturnType<typeof searchAnswer>>) => { const b = a.stat?.blocks.find((x) => x.kind === "leaderboard"); return b?.kind === "leaderboard" ? b.rows[0]?.team.label : undefined; };
    const best = await searchAnswer("best team in Texas by penalties", { limit: 25, full: true });
    expect(best.stat?.title).toMatch(/^Team in Texas with the fewest penalties a match/);
    expect(firstOf(best)).toBe(firstOf(least));
    expect(firstOf(await searchAnswer("worst team in Texas by penalties", { limit: 25, full: true }))).toBe(firstOf(most));
    // The match with the most penalty points stays the match finder's, and a rule asked about stays the rules'.
    expect((await searchAnswer("most penalties in Texas", { limit: 25, full: true })).stat?.family).not.toBe("leaderboard");
    expect((await searchAnswer("penalty for pinning")).card?.kind).toBe("rule");
  });
  it("a team named is that team's penalty points, never the rules", async () => {
    expect((await searchAnswer("how many penalty points did 29548 give away in total", { limit: 25, full: true })).card?.kind).not.toBe("rule");
  });
});
