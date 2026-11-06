// @vitest-environment jsdom
// A match box's team chips hold 4- and 5-digit numbers whole, and its phase tiles take the team page's colours.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { StatMatchRow } from "../../../shared/searchStat";
import { MatchBox } from "./MatchBox";

afterEach(cleanup);
const T = (n: number, name: string) => ({ label: `${n} ${name}`, href: `/teams/${n}` });
const row: StatMatchRow = {
  label: "M4", href: "/events/2025/USNJCMP?match=playoff:4:1", event: { label: "NJ Championship", href: "/events/2025/USNJCMP" }, season: "2025–26", date: "Mar 15, 2026",
  alliance: "blue", own: 146, opp: 156, result: "L", partners: [T(23375, "A Team With A Very Long Name Indeed")], opponents: [T(13583, "Thirteen Five"), T(98765, "Five Digits")],
  phases: { auto: 52, teleop: 79, endgame: 15, pen: 15, teleopWithEndgame: true },
};
const draw = () => render(<MemoryRouter><ul><MatchBox r={row} team={{ number: 4215, name: "Hypnotic Robotics" }} /></ul></MemoryRouter>).container;

describe("a match box", () => {
  it("draws 5-digit team numbers whole: the chip never shrinks below its number, only the name is cut", () => {
    const chips = [...draw().querySelectorAll<HTMLElement>("[data-team-chip]")];
    expect(chips.map((c) => c.dataset.teamChip)).toEqual(["13583", "98765", "4215", "23375"]);
    for (const c of chips) {
      expect(c.className).toMatch(/\bshrink-0\b/);
      expect(c.className).not.toMatch(/\bmin-w-0\b/);
      expect(c.querySelector("b")!.className).toMatch(/\bshrink-0\b/);
      const name = c.querySelector("span");
      if (name) expect(name.className).toMatch(/\btruncate\b/);
    }
  });
  it("puts the phase tiles beside the scores by the box's own width, not the screen's (two boxes side by side are narrow)", () => {
    const box = draw().querySelector<HTMLElement>("[data-match-box]")!;
    expect(box.className).toMatch(/@container/);
    expect(box.querySelector("[data-phases]")!.className).not.toMatch(/(^|\s)sm:/);
  });
  it("fills each phase in search's palette: Auto blue, TeleOp green, Endgame purple, penalties red, white on them", () => {
    const c = draw();
    const tone = (k: string) => c.querySelector(`[data-phase=${k}]`)!.className;
    expect(tone("auto")).toContain("bg-blue-600 text-white");
    expect(tone("teleop")).toContain("bg-emerald-700 text-white");
    expect(tone("endgame")).toContain("bg-violet-600 text-white");
    expect(tone("pen")).toContain("bg-red-700 text-white");
  });
});
