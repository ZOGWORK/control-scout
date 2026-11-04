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
    expect(c.querySelector("[data-answer-frame]")!.className).not.toMatch(/accent/);
  });
  it("other stat answers: the team page's tiles too, no gold band or box anywhere", () => {
    const c = draw({ ...opr, intent: "wins-count", blocks: [{ kind: "kpis", items: [{ label: "Wins", value: "26", sub: "2025–26" }] }] });
    expect(c.querySelector("[data-opr-tiles]")).toBeNull();
    expect(c.querySelector("[data-headline]")!.className).not.toMatch(/bg-accent/);
    expect(c.querySelector("[data-kpi] > div")!.className).toContain(TONES.emerald.box.split(" ")[0]);
    expect(c.innerHTML).not.toMatch(/(border|bg)-accent/);
  });
  it("the team's header up top: its number, name and the season it states", () => {
    const c = draw(opr);
    const h = c.querySelector("[data-answer-team]")!;
    expect(h.textContent).toContain("4215");
    expect(h.textContent).toContain("Hypnotic Robotics");
    expect(c.querySelector("[data-answer-season]")!.textContent).toBe("2025–26");
  });
  it("a title the page heading already says is for screen readers only", () => {
    const c = render(<MemoryRouter><StatAnswerCard stat={opr} heading="Hypnotic Robotics (4215) · OPR in 2025–26" /></MemoryRouter>).container;
    expect(c.querySelector("[data-answer-title]")!.className).toContain("sr-only");
  });
  it("phase bars and phase columns in the team page's phase colours", () => {
    const c = draw({ ...opr, intent: "phase", blocks: [
      { kind: "bars", title: "Phases", groups: [{ label: "x", items: [{ label: "Auto", value: 20 }, { label: "TeleOp", value: 60 }, { label: "Endgame", value: 10 }] }] },
      { kind: "table", title: "By event", columns: [{ key: "e", label: "Event" }, { key: "a", label: "Auto", num: true }, { key: "t", label: "TeleOp", num: true }, { key: "g", label: "Endgame", num: true }], rows: [{ cells: { e: "Q", a: "1", t: "2", g: "3" } }] },
    ] } as StatAnswer);
    const bars = [...c.querySelectorAll('[data-block="bars"] li > span:nth-child(2) > span')].map((b) => b.className);
    expect(bars[0]).toContain(TONES.sky.bar);
    expect(bars[1]).toContain(TONES.emerald.bar);
    expect(bars[2]).toContain(TONES.violet.bar);
    expect([...c.querySelectorAll("th[data-phase]")].map((t) => t.getAttribute("data-phase"))).toEqual(["sky", "emerald", "violet"]);
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
  it("a record with both qualifications and playoffs shows each apart, and no event name is cut off", () => {
    const c = draw({ ...opr, intent: "record", blocks: [
      { kind: "record", title: "Wins, losses and ties", wins: 24, losses: 12, ties: 0, split: { quals: { wins: 15, losses: 5, ties: 0 }, playoffs: { wins: 9, losses: 7, ties: 0 } } },
      { kind: "series", title: "OPR by event", points: [{ x: "East Bergen Conference Northern League Tournament", y: 84.4, href: "/events/2025/USNJNOLT2?team=4215" }, { x: "New Jersey Championship - Parkway Division", y: 101.6 }] },
    ] });
    const rows = [...c.querySelectorAll("[data-record-split] [data-split]")];
    expect(rows.map((r) => r.getAttribute("data-split"))).toEqual(["Qualifications", "Playoffs"]);
    expect(rows[0].textContent).toContain("15-5-0");
    expect(rows[1].textContent).toContain("9-7-0");
    expect(rows[1].textContent).toContain("56%");
    expect(c.querySelector("[data-block=series]")!.innerHTML).not.toContain("truncate");
  });
});
