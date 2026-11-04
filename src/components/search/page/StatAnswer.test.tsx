// @vitest-environment jsdom
// Search's OPR answer drawn as the team page draws its OPR: a plain card, no band behind the number, and the phases as
// the team page's coloured OPR tiles (src/components/oprCards.ts) with the same rank line. Other stat answers keep theirs.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { StatAnswer } from "../../../shared/searchStat";
import { TONES } from "../../StatTile";
import { StatAnswerCard } from "./StatAnswer";

afterEach(cleanup);

const opr: StatAnswer = {
  family: "stat", intent: "opr", title: "OPR in 2025–26", team: { number: 4215, name: "Hypnotic Robotics" }, scope: ["2025–26"],
  headline: { value: "101.6", label: "#612 of 8,308 worldwide · top 8%", sub: "2025–26", href: "/teams/4215?season=2025" },
  blocks: [{ kind: "kpis", items: [
    { label: "OPR", value: "101.6", phase: "np", rank: 612, of: 8308, sub: "#612 of 8,308", tone: "accent" },
    { label: "Auto", value: "28.3", phase: "auto", rank: 880, of: 8308, sub: "#880 of 8,308" },
    { label: "TeleOp", value: "73.4", phase: "teleop", rank: 640, of: 8308, sub: "#640 of 8,308" },
    { label: "Endgame", value: "6.7", phase: "endgame", rank: 5013, of: 8308, sub: "#5,013 of 8,308" },
  ] }],
  definition: "OPR: …", source: "From 4215 Hypnotic Robotics's 2025–26 season numbers",
};
const draw = (s: StatAnswer) => render(<MemoryRouter><StatAnswerCard stat={s} /></MemoryRouter>).container;

describe("StatAnswerCard, a team's OPR", () => {
  it("has the team page's tiles: its names, each phase's colour, its rank line", () => {
    const c = draw(opr);
    const tiles = [...c.querySelectorAll("[data-opr-tiles] > div")];
    expect(tiles.map((t) => t.textContent)).toEqual([
      "Total OPR101.6OPR #612 of 8,308 with an OPR · top 8%",
      "Autonomous28.3OPR #880 of 8,308 with an OPR · top 11%",
      "TeleOp73.4OPR #640 of 8,308 with an OPR · top 8%",
      "Endgame6.7OPR #5,013 of 8,308 with an OPR · top 61%",
    ]);
    // Each tile's box, value and bar in its own colour, as on /teams/4215.
    (["accent", "sky", "emerald", "violet"] as const).forEach((tone, i) => {
      expect(tiles[i].className).toContain(TONES[tone].box.split(" ")[0]);
      expect(tiles[i].querySelector(`.${CSS.escape(TONES[tone].text.split(" ")[0])}`)).toBeTruthy();
      expect(tiles[i].querySelector(`.${CSS.escape(TONES[tone].bar)}`)).toBeTruthy();
    });
  });
  it("puts no band behind the number, and keeps its rank, season and chip", () => {
    const c = draw(opr);
    const h = c.querySelector("[data-headline]")!;
    expect(h.className).not.toMatch(/bg-accent/);
    expect(h.textContent).toBe("101.6#612 of 8,308 worldwide · top 8%2025–26");
    expect(c.querySelector("[data-scope]")!.textContent).toBe("2025–26");
    expect(c.querySelector("section")!.className).not.toMatch(/border-accent/);
  });
  it("leaves other stat answers as they were", () => {
    const c = draw({ ...opr, intent: "wins-count", blocks: [{ kind: "kpis", items: [{ label: "Wins", value: "26" }] }] });
    expect(c.querySelector("[data-opr-tiles]")).toBeNull();
    expect(c.querySelector("[data-headline]")!.className).toMatch(/bg-accent/);
  });
  it("two teams' tiles for one phase both show, each naming its team", () => {
    const c = draw({ ...opr, family: "two-team", intent: "phase-vs", blocks: [{ kind: "kpis", items: [
      { label: "Hypnotic Robotics (4215)", value: "28.3", phase: "auto", rank: 880, of: 8308 },
      { label: "Bad Wolf (6980)", value: "13.2", phase: "auto", rank: 5000, of: 8308 },
    ] }] });
    const tiles = [...c.querySelectorAll("[data-opr-tiles] > div")];
    expect(tiles).toHaveLength(2);
    expect(tiles[0].textContent).toContain("Autonomous · Hypnotic Robotics (4215)");
    expect(tiles[1].textContent).toContain("Autonomous · Bad Wolf (6980)");
    expect(tiles[1].textContent).toContain("13.2");
  });
});
