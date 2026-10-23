/**
 * Event-local form (engine 2.9): at an event, a robot's predictions there include a fading share of
 * its mean miss at that event. The permanent rating is untouched, a new event starts over, and a
 * prediction with no earlier match there is exactly the engine without it.
 */
import { describe, it, expect } from "vitest";
import { RatingBook, type RatingParams } from "../rating";
import { explainMatch } from "../explain";
import type { MatchRecord } from "../types";

// A loose cap: the synthetic seasons below score alike, so their population spread (which scales the cap) is tiny.
const ON: Partial<RatingParams> = { eventLambdaAuto: 0.4, eventLambdaTeleop: 0.2, eventKappa: 1, eventCap: 1000 };
const al = (teams: number[], np: number) => ({ teams, auto: np * 0.2, teleop: np * 0.7, endgame: np * 0.1, np, penCommitted: 0, total: np });
let clock = 0;
const match = (code: string, red: [number[], number], blue: [number[], number]): MatchRecord => ({
  season: 2025, eventCode: code, level: "qual", series: 0, number: ++clock, time: Date.UTC(2025, 10, 1) + clock * 60_000, red: al(red[0], red[1]), blue: al(blue[0], blue[1]),
});
/** A season of ordinary results, then team 1 (with 2) far above expectation twice at event "B". */
function build(params: Partial<RatingParams>) {
  clock = 0;
  const b = new RatingBook(params);
  b.startSeason(2025);
  for (let i = 0; i < 6; i++) { b.update(match("A", [[1, 2], 100], [[3, 4], 100])); b.update(match("A", [[5, 6], 100], [[7, 8], 100])); }
  b.update(match("B", [[1, 2], 220], [[3, 4], 100]));
  b.update(match("B", [[1, 2], 220], [[5, 6], 100]));
  return b;
}

describe("event-local form", () => {
  it("is off by default and changes nothing then", () => {
    const off = build({});
    expect(off.eventOffset(1, "B")).toBeNull();
    expect(off.withEvent("B", () => off.get(1))).toEqual(off.get(1));
    expect(off.toData().events).toBeUndefined();
  });

  it("never changes the permanent ratings", () => {
    const on = build(ON), off = build({});
    for (const t of [1, 2, 3, 4, 5, 6]) expect(on.get(t)).toEqual(off.get(t));
  });

  it("raises a hot robot's predictions at that event only, by a share that fades with matches there", () => {
    const on = build(ON);
    const at = on.withEvent("B", () => on.get(1)), plain = on.get(1);
    expect(at.auto).toBeGreaterThan(plain.auto);
    expect(at.teleop).toBeGreaterThan(plain.teleop);
    expect(at.endgame).toBe(plain.endgame); // endgame weight 0
    expect(on.withEvent("A", () => on.get(1))).toEqual(plain); // another event: none
    const o = on.eventOffset(1, "B")!, s = on.eventFormOf(1)!;
    expect(s.n).toBe(2);
    expect(o.auto).toBeCloseTo(0.4 * (s.auto / 2) * (1 / (2 + 1)), 9);
  });

  it("is exactly the engine without it for a robot's first match at an event", () => {
    const on = build(ON), off = build({});
    // Teams 7 and 8 last played at A: at a new event C they have no form there.
    expect(on.withEvent("C", () => on.allianceExpectation([7, 8]))).toEqual(off.allianceExpectation([7, 8]));
  });

  it("is capped at eventCap population standard deviations", () => {
    const capped = build({ ...ON, eventCap: 0.5 }), loose = build(ON);
    expect(capped.eventOffset(1, "B")!.teleop).toBeLessThan(loose.eventOffset(1, "B")!.teleop);
  });

  it("starts over at the next event, and survives serialization and cloning", () => {
    const on = build(ON);
    on.update(match("C", [[1, 2], 100], [[7, 8], 100]));
    expect(on.eventFormOf(1)!.code).toBe("C");
    expect(on.eventFormOf(1)!.n).toBe(1);
    const copy = RatingBook.fromData(JSON.parse(JSON.stringify(on.toData()))), clone = on.clone();
    for (const b of [copy, clone]) expect(b.eventOffset(1, "C")).toEqual(on.eventOffset(1, "C"));
  });

  it("names a notable form in explainMatch's reasons", () => {
    // Stronger settings than shipped, so two hot matches clear the "notable" bar (5 points and 10%).
    const on = build({ ...ON, eventLambdaAuto: 1, eventLambdaTeleop: 1, eventKappa: 4 });
    const x = explainMatch(on, [1, 2], [3, 4], { context: { level: "qual", event: "B" } });
    expect(x.reasons.some((r) => /Team 1 is playing about \d+ points above its usual level at this event \(2 matches here\)/.test(r))).toBe(true);
    expect(explainMatch(on, [1, 2], [3, 4], { context: { level: "qual", event: "A" } }).reasons).toEqual([]);
  });
});
