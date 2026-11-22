// A team's highlights page with no match clip in its season: the newest other season with clips is listed (its own
// "videos" block, `season` set), and a team with none in any season gets one line, never a silent blank.
import { describe, expect, it, vi } from "vitest";
import type { TeamMatch } from "./matchSet";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat";

const ms = vi.hoisted(() => ({ rows: [] as TeamMatch[], keys: new Map<number, string[]>(), fail: false }));
vi.mock("./matchSet.js", async (orig) => ({
  ...(await orig<typeof import("./matchSet.js")>()),
  teamMatches: async () => ms.rows,
  teamLinks: async () => new Map(),
}));
vi.mock("../../videos/recordings.js", () => ({
  seasonClipKeys: async (s: number) => { if (ms.fail) throw new Error("read failed"); return new Set(ms.keys.get(s) ?? []); },
}));
const { teamHighlights } = await import("./highlights");

let n = 0;
const m = (over: Partial<TeamMatch>): TeamMatch => ({
  season: 2026, code: "USTXNONIM1", level: "qual", series: 0, number: ++n, label: `Q${n}`, date: "2026-10-31", event: "NTX I-League Meet #1", type: "LeagueMeet",
  country: "USA", state: "TX", division: null, alliance: "red", own: 150, opp: 140, ownNp: 150, oppNp: 140, ownAuto: 30, ownTeleop: 90, ownEndgame: 30,
  ownPen: 0, oppPen: 0, counted: true, onField: true, final: false, result: "W", partners: [207], opponents: [6980, 16461], ...over,
});
const team = { number: 19564, name: "ITKAN Solar" };
type Videos = Extract<StatBlock, { kind: "videos" }>;
const videoBlocks = (a: StatAnswer | null) => a!.blocks.filter((b): b is Videos => b.kind === "videos");
const highlights = () => teamHighlights(team, undefined, undefined, undefined, "highlights");

describe("highlights: clips from another season", () => {
  it("the season shown has a clip: nothing else is listed", async () => {
    ms.fail = false;
    ms.rows = [m({ number: 1 }), m({ season: 2025, code: "FTCCMP1JACK", number: 7 })];
    ms.keys = new Map([[2026, ["USTXNONIM1|qual|0|1"]], [2025, ["FTCCMP1JACK|qual|0|7"]]]);
    const vs = videoBlocks(await highlights());
    expect(vs).toHaveLength(1);
    expect(vs[0].empty).toBeUndefined();
  });

  it("none in the season shown: the newest season with clips, only its clipped matches", async () => {
    ms.rows = [m({ number: 1, label: "Q1" }), m({ season: 2024, code: "OLD", number: 3 }), m({ season: 2025, code: "FTCCMP1JACK", number: 7, label: "Q7" }), m({ season: 2025, code: "FTCCMP1JACK", number: 8 })];
    ms.keys = new Map([[2026, []], [2025, ["FTCCMP1JACK|qual|0|7"]], [2024, ["OLD|qual|0|3"]]]);
    const vs = videoBlocks(await highlights());
    expect(vs.map((b) => [b.title, b.season, b.tiles.map((t) => t.label)])).toEqual([["Every match", undefined, ["Q1"]], ["Match videos, 2025–26", 2025, ["Q7"]]]);
    expect(vs[1].tiles[0].event).toBe("NTX I-League Meet #1");
  });

  it("none in any season: one line on the season's list", async () => {
    ms.rows = [m({ number: 1 }), m({ season: 2025, code: "FTCCMP1JACK", number: 7 })];
    ms.keys = new Map();
    const vs = videoBlocks(await highlights());
    expect(vs).toHaveLength(1);
    expect(vs[0].empty).toEqual({ text: "No match video of 19564 in any season yet.", href: "/teams/19564" });
  });

  it("a failed clip read says nothing either way", async () => {
    ms.fail = true;
    const vs = videoBlocks(await highlights());
    expect(vs).toHaveLength(1);
    expect(vs[0].empty).toBeUndefined();
  });

  it("a team searched alone (no highlights page) reads no clips", async () => {
    ms.fail = false;
    ms.keys = new Map([[2025, ["FTCCMP1JACK|qual|0|7"]]]);
    expect(videoBlocks(await teamHighlights(team))).toHaveLength(0);
  });
});
