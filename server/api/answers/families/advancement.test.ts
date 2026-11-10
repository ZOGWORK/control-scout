// Advancement odds in search: the chance to take a slot, from the engine's event forecast (mocked here), never a
// match's win chance; a played event's odds as they stood the day before, beside what happened; a Worlds division's
// step on is its finals; a season with nothing to come says so and shows the latest event.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ForecastView } from "../../../../src/shared/api";
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat";
import { migrate, openDb, run, setDb } from "../../../db";

const asked = vi.hoisted(() => ({ modes: [] as string[], won: new Set<string>() }));
vi.mock("../../../predict/eventForecast.js", () => ({
  eventForecast: async (season: number, code: string, team: number | null, mode: "current" | "pre-event") => {
    asked.modes.push(`${code}:${mode}`);
    const t = (n: number, pAdvance: number, pWin: number) => ({ team: n, pAdvance, pWin, pCaptain: 0.3, pPicked: 0.4, pFinalist: 0.1, rank: { mean: 4.2, p10: 1, p90: 9 } });
    return { season, event: code, stage: "pre", runs: 2000, slots: 4, slotsSource: "estimated", prequalified: [], assumptions: ["Championship divisions are treated as their own event; the real slots are shared across divisions."],
      teams: [t(7149, 0.83, 0.002), t(6980, 0.22, 0.05)], matchesOnly: null, matches: [], bonusDraws: "model", generatedAt: "", bonusModelled: true, eventName: code, eventStart: null, eventEnd: null, myTeam: team, engineVersion: "x", mode, hindsightNote: null } as unknown as ForecastView;
  },
  ForecastUnavailable: class extends Error {},
}));
vi.mock("./winners.js", () => ({ wonEventByRules: async (_s: number, code: string, team: number) => asked.won.has(`${code}:${team}`) }));
const { advancementAt, advancementEvent, seasonAdvancement } = await import("./advancement");

const NOW = Date.parse("2026-11-10T12:00:00Z");
const chance = (a: StatAnswer) => a.blocks.find((b): b is Extract<StatBlock, { kind: "chance" }> => b.kind === "chance");
const tile = (a: StatAnswer, label: string) => a.blocks.flatMap((b) => (b.kind === "kpis" ? b.items : [])).find((i) => i.label === label);
const team = { number: 7149, name: "ENFORCERS" };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev = (season: number, code: string, name: string, type: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, region, start, end, source) VALUES (?, ?, ?, ?, ?, 'USNJ', ?, ?, 't')", [season, code, name, type, division, start, start]);
  await ev(2025, "USNJCMP", "New Jersey Championship", "Championship", "2026-03-15");
  await ev(2025, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "Championship", "2026-03-15", "USNJCMP");
  await ev(2025, "FTCCMP1", "FIRST Championship", "FIRSTChampionship", "2026-04-29");
  await ev(2025, "FTCCMP1ROSS", "FIRST Championship - FIRST Tech Challenge - Ross Division", "FIRSTChampionship", "2026-04-29", "FTCCMP1");
  await ev(2025, "USNJNOLT", "Northern League Tournament", "LeagueTournament", "2026-02-07");
  await ev(2026, "USNJNOM1", "Northern League Meet", "LeagueMeet", "2026-11-01");
  for (const [code, t, rank] of [["USNJCMPTRPK", 7149, 3], ["FTCCMP1ROSS", 7149, 19], ["USNJNOLT", 6980, 5], ["USNJNOLT", 7149, 1], ["USNJNOM1", 7149, 2]] as const)
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, ?, ?, ?)", [code === "USNJNOM1" ? 2026 : 2025, code, t, rank]);
  await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (2025, 'USNJCMP', 19, 'FIRST Championship & Premier Events', ?)", [JSON.stringify([{ team: 7149, status: "FIRST", declined: false }])]);
  await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (2025, 'USNJNOLT', 5, 'USNJCMP', ?)", [JSON.stringify([{ team: 7149, status: "FIRST", declined: false }])]);
  // The award on the championship and again on its division: named once.
  await run("INSERT INTO awards (season, code, type, placement, team) VALUES (2025, 'USNJCMP', 'Control', 1, 7149), (2025, 'USNJCMPTRPK', 'Control', 1, 7149)");
  asked.won.add("USNJCMPTRPK:7149").add("FTCCMP1ROSS:7149");
});

describe("advancement odds at an event", () => {
  it("a played event: the odds the day before (Predict's pre-event forecast), where advancing leads, and what happened", async () => {
    const a = await advancementAt(team, (await advancementEvent(2025, "USNJCMPTRPK"))!, NOW);
    expect(asked.modes).toContain("USNJCMPTRPK:pre-event");
    expect(a.intent).toBe("advancement-odds");
    expect(chance(a)).toMatchObject({ p: 0.83, label: "to advance to FIRST Championship & Premier events, before it started" });
    expect(chance(a)!.note).toMatch(/19 slots|estimated/);
    expect(tile(a, "What happened")).toMatchObject({ value: "Advanced", sub: "Ranked #3 · won the division · Control Award", tone: "good" });
    // The only chance on the card is the advancement one: no match's win chance stands in for it.
    expect(a.blocks.filter((b) => b.kind === "chance")).toHaveLength(1);
  });
  it("a team not listed at the event: said so, no odds", async () => {
    const a = await advancementAt({ number: 6980, name: "Bad Wolf" }, (await advancementEvent(2025, "USNJCMPTRPK"))!, NOW);
    expect(chance(a)).toBeUndefined();
    expect(a.none).toMatch(/^Bad Wolf \(6980\) isn't listed at New Jersey Championship - Turnpike Division/);
  });
  it("a Worlds division: the step on is its finals, so the chance is to win the division", async () => {
    const a = await advancementAt(team, (await advancementEvent(2025, "FTCCMP1ROSS"))!, NOW);
    expect(chance(a)).toMatchObject({ p: 0.002, label: "to advance to the Worlds finals, before it started" });
    expect(tile(a, "What happened")).toMatchObject({ value: "Advanced" });
    expect(tile(a, "Win the event")).toBeUndefined();
  });
  it("a team that didn't take a slot: said so, with how many went to others", async () => {
    const a = await advancementAt({ number: 6980, name: "Bad Wolf" }, (await advancementEvent(2025, "USNJNOLT"))!, NOW);
    expect(chance(a)).toMatchObject({ p: 0.22, label: "to advance to New Jersey Championship, before it started" });
    expect(tile(a, "What happened")).toMatchObject({ value: "Did not advance", sub: "Ranked #5 · 5 slots went to other teams", tone: "bad" });
  });
});

describe("advancement odds for a season", () => {
  it("nothing to come in the season: says so, and shows the team's latest advancing event", async () => {
    const a = await seasonAdvancement(team, { season: null, toward: null, now: NOW });
    expect(a.title).toBe("Advancement odds: 7149's latest advancing event (2025–26)");
    expect(a.scope).toContain("No next event in 2026–27 yet");
    expect(tile(a, "2026–27 so far")?.value).toBe("No event yet");
    // Its latest is its Worlds division, where advancing is the finals.
    expect(a.scope[0]).toBe("Worlds · Ross Division");
    expect(chance(a)?.p).toBe(0.002);
  });
  it("toward states: the latest event that sends teams to the state championship", async () => {
    const a = await seasonAdvancement(team, { season: null, toward: "states", now: NOW });
    expect(a.scope[0]).toBe("Northern League Tournament");
    expect(chance(a)!.label).toBe("to advance to New Jersey Championship, before it started");
  });
  it("a place given: only events there (a state championship's own region leads to it)", async () => {
    const a = await seasonAdvancement(team, { season: 2025, toward: "states", now: NOW, missing: "Not listed", region: { country: "Romania", state: "" } });
    expect(a.none).toBeTruthy();
    expect(chance(a)).toBeUndefined();
  });
  it("a season that's over: its own latest event, with no 'nothing to come' line", async () => {
    const a = await seasonAdvancement(team, { season: 2025, toward: "worlds", now: NOW });
    expect(a.title).toBe("Advancement odds: 7149 at New Jersey Championship - Turnpike Division");
    expect(tile(a, "2025–26 so far")).toBeUndefined();
  });
});
