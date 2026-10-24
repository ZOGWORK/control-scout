import { describe, expect, it } from "vitest";
import type { EventDetail, FieldRow, MatchView } from "../shared/api";
import { callWords, overlayModel, overlayOptions, shortName } from "./overlay";
import { nextFlip, railModel, RESULT_MS } from "./watchRail";
import { isBareRoute, isOverlayRoute, pageModule, pageTitle } from "../shared/routes";
import { canonicalPath } from "./meta";

const T0 = Date.parse("2026-10-24T15:00:00Z");
const t = (n: number, onField = true) => ({ number: n, surrogate: false, dq: false, onField });
const sc = (x: number) => ({ total: x, np: x, auto: 0, teleop: 0, endgame: 0, pen: 0 });
function q(n: number, result?: [number, number], pRed = 0.64): MatchView {
  return {
    season: 2026, code: "X", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null,
    startsAt: new Date(T0 + n * 7 * 60_000).toISOString(), played: !!result,
    red: { teams: [t(n * 10 + 1), t(n * 10 + 2)], score: result ? sc(result[0]) : null },
    blue: { teams: [t(n * 10 + 3), t(n * 10 + 4)], score: result ? sc(result[1]) : null },
    video: null, prediction: { pRed, redMean: 120, blueMean: 100, tier: "confident", kind: "live", predictedAt: null },
  };
}
const row = (team: number, name: string | null) => ({ team, name } as FieldRow);
const ev = (matches: MatchView[], status: "live" | "finished" | "upcoming" = "live", field: FieldRow[] = []) =>
  ({ event: { status } as EventDetail["event"], matches, field });

describe("overlayOptions", () => {
  it("defaults: transparent, bar at the bottom, full size", () => {
    expect(overlayOptions("")).toEqual({ bg: "transparent", pos: "bottom", scale: 1 });
  });

  it("reads ?bg=green, ?pos=top and ?scale (any case)", () => {
    expect(overlayOptions("?bg=green&pos=top&scale=0.8")).toEqual({ bg: "green", pos: "top", scale: 0.8 });
    expect(overlayOptions("?bg=GREEN&pos=Top")).toMatchObject({ bg: "green", pos: "top" });
  });

  it("anything else falls back, and the scale is kept to 0.5–1.5", () => {
    expect(overlayOptions("?bg=blue&pos=left&scale=big")).toEqual({ bg: "transparent", pos: "bottom", scale: 1 });
    expect(overlayOptions("?scale=")).toMatchObject({ scale: 1 });
    expect(overlayOptions("?scale=0.1").scale).toBe(0.5);
    expect(overlayOptions("?scale=9").scale).toBe(1.5);
    expect(overlayOptions(new URLSearchParams("scale=1.2")).scale).toBe(1.2);
  });
});

describe("overlayModel", () => {
  const field = [row(21, "Robo  Raptors"), row(24, null)];

  it("the match being called, with each side's teams and names: up next before its start, on the field after", () => {
    const d = ev([q(1, [100, 90]), q(2), q(3)], "live", field);
    const before = overlayModel(d, railModel(d, T0, null), T0);
    expect(before.kind).toBe("now");
    expect(before.heading).toBe("Up next");
    expect(before.match?.label).toBe("Q2");
    expect(before.red.teams).toEqual([{ number: 21, name: "Robo  Raptors" }, { number: 22, name: null }]);
    expect(before.blue.teams.map((x) => x.number)).toEqual([23, 24]);
    expect(before.red.score).toBeNull();
    expect(before.verdict).toBeNull();
    expect(before.prediction?.pRed).toBe(0.64);
    const at = T0 + 14 * 60_000 + 1;
    expect(overlayModel(d, railModel(d, at, null), at).heading).toBe("On the field");
  });

  it("a result comes in: the score and how the call it showed went, for a minute, then the next match", () => {
    const after = ev([q(1, [100, 90]), q(2, [80, 110]), q(3)]);
    const shown = q(2).prediction;
    const flip = nextFlip({ key: "qual:0:2", prediction: shown }, after.matches, T0, null);
    const m = overlayModel(after, railModel(after, T0 + 1000, flip), T0 + 1000);
    expect(m.kind).toBe("result");
    expect(m.heading).toBe("Result");
    expect(m.match?.label).toBe("Q2");
    expect([m.red.score, m.blue.score]).toEqual([80, 110]);
    expect([m.red.won, m.blue.won]).toEqual([false, true]);
    expect(m.verdict).toBe("upset");
    const later = overlayModel(after, railModel(after, T0 + RESULT_MS + 1, flip), T0 + RESULT_MS + 1);
    expect(later.kind).toBe("now");
    expect(later.match?.label).toBe("Q3");
  });

  it("the result is judged against the call that was on screen, not a later one", () => {
    const after = ev([q(1, [100, 90], 0.3)]);
    const flip = nextFlip({ key: "qual:0:1", prediction: q(1).prediction }, after.matches, T0, null);
    expect(overlayModel(after, railModel(after, T0, flip), T0).verdict).toBe("called");
  });

  it("a played match lists only the teams on the field", () => {
    const m = q(1, [100, 90]);
    m.red.teams = [t(11), t(12), t(19, false)];
    const d = ev([m, q(2, [50, 40])], "live");
    expect(overlayModel(d, railModel(d, T0, null), T0).red.teams.map((x) => x.number)).toEqual([21, 22]);
    const r = overlayModel(d, { hidden: false, result: m, current: null, upNext: [] }, T0);
    expect(r.red.teams.map((x) => x.number)).toEqual([11, 12]);
  });

  it("a finished event keeps its last result up as the final one", () => {
    const d = ev([q(1, [100, 90]), q(2, [120, 60])], "finished");
    const m = overlayModel(d, railModel(d, T0, null), T0);
    expect(m.kind).toBe("last");
    expect(m.heading).toBe("Final result");
    expect(m.match?.label).toBe("Q2");
    expect(m.verdict).toBe("called");
  });

  it("every posted match played while live: the last result; no schedule: empty", () => {
    const d = ev([q(1, [100, 90])], "live");
    expect(overlayModel(d, railModel(d, T0, null), T0)).toMatchObject({ kind: "last", heading: "Last result" });
    expect(overlayModel(ev([q(1)], "finished"), railModel(ev([q(1)], "finished"), T0, null), T0)).toMatchObject({ kind: "empty", heading: "Event over" });
    const none = ev([], "upcoming");
    expect(overlayModel(none, railModel(none, T0, null), T0)).toMatchObject({ kind: "empty", match: null, heading: "Schedule" });
  });
});

describe("formatting", () => {
  it("shortName tidies spaces and cuts long names", () => {
    expect(shortName("  Robo   Raptors ")).toBe("Robo Raptors");
    expect(shortName("The Incredibly Long Team Name Robotics Club", 22)).toBe("The Incredibly Long T…");
    expect(shortName("The Incredibly Long Team Name Robotics Club", 22)!.length).toBe(22);
    expect(shortName(null)).toBeNull();
    expect(shortName("   ")).toBeNull();
  });

  it("callWords says the side the model favoured, never a flat 0% or 100%", () => {
    const p = q(1).prediction!;
    expect(callWords(p)).toBe("Model: red 64%");
    expect(callWords({ ...p, pRed: 0.25 })).toBe("Model: blue 75%");
    expect(callWords({ ...p, pRed: 0.5 })).toBe("Model: even match");
    expect(callWords({ ...p, pRed: 0.999 })).toBe("Model: red 99%");
    expect(callWords(null)).toBeNull();
  });
});

describe("route", () => {
  it("/events/:season/:code/overlay is the stream overlay, drawn bare and see-through", () => {
    expect(pageModule("/events/2026/USCAQ1/overlay")).toBe("EventOverlayPage");
    expect(pageModule("/events/2026/USCAQ1/Overlay/")).toBe("EventOverlayPage");
    expect(pageTitle("/events/2026/USCAQ1/overlay")).toBe("Stream overlay");
    expect(isBareRoute("/events/2026/USCAQ1/overlay")).toBe(true);
    expect(isOverlayRoute("/events/2026/USCAQ1/overlay")).toBe(true);
    expect(isOverlayRoute("/events/2026/USCAQ1/display")).toBe(false);
    expect(canonicalPath("/events/2026/uscaq1/overlay")).toBe("/events/2026/USCAQ1");
  });
});
