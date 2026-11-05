// @vitest-environment jsdom
// Search answer cards in the team and event pages' colours: ranks as podium pills, records with wins green and losses
// red, seasons as badges, an event's type colour, OPR bars against the best listed, and every list of matches as
// match boxes (red over blue, the winner marked, the phases in the team page's colours).
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { StatAnswer, StatMatchRow } from "../../../shared/searchStat";
import { TONES } from "../../StatTile";
import { RankPill, RecordText, ResultPill, RichText } from "./answerCells";
import { MatchBox } from "./MatchBox";
import { StatAnswerCard, better } from "./StatAnswer";

afterEach(cleanup);
const html = (n: React.ReactNode) => render(<MemoryRouter>{n}</MemoryRouter>).container;

const latest: StatAnswer = {
  family: "superlative", intent: "last-event", title: "Most recent event", team: { number: 4215, name: "Hypnotic Robotics" }, scope: ["All seasons"],
  headline: { value: "New Jersey Championship - Parkway Division", label: "Ranked #6 of 24 · OPR 101.6", sub: "2025–26 · Mar 15, 2026 · Hillsborough Township, NJ", href: "/events/2025/USNJCMP1?team=4215", type: "Championship" },
  blocks: [{ kind: "table", title: "Latest events", columns: [{ key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "date", label: "Date" }, { key: "rank", label: "Rank" }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR", num: true }],
    rows: [
      { cells: { event: "New Jersey Championship - Parkway Division", season: "2025–26", date: "Mar 15, 2026", rank: "#6 of 24", record: "5-3-0", opr: "101.6" }, href: "/events/2025/USNJCMP1?team=4215", type: "Championship" },
      { cells: { event: "East Bergen League Tournament", season: "2025–26", date: "Mar 8, 2026", rank: "#1 of 21", record: "8-0-0", opr: "84.4" }, href: "/events/2025/X?team=4215", type: "LeagueTournament" },
      { cells: { event: "P3-6 League Meet", season: "2025–26", date: "Feb 1, 2026", rank: "–", record: "4-1-0", opr: "50.8" }, href: "/events/2025/Y?team=4215", type: "LeagueMeet" },
    ] }],
  definition: "Events the team attended.", source: "From 20 event records",
};

describe("answer cells", () => {
  it("a rank is a pill: the top three in the podium colours with a medal, the rest neutral", () => {
    const one = html(<RankPill text="#1 of 21" />).querySelector("[data-rank-pill]")!;
    expect(one.className).toContain(TONES.emerald.chip.split(" ")[0]);
    expect(one.querySelector("svg")).toBeTruthy();
    expect(one.textContent).toBe("#1 of 21");
    const six = html(<RankPill text="#6 of 24" />).querySelector("[data-rank-pill]")!;
    expect(six.querySelector("svg")).toBeNull();
    expect(six.className).not.toMatch(/accent/);
  });
  it("a record has its wins green and its losses red, and reads as words", () => {
    const c = html(<RecordText text="5-3-0" />);
    expect(c.querySelector(".text-success-text")!.textContent).toBe("5");
    expect(c.querySelector(".text-danger-text")!.textContent).toBe("3");
    expect(c.querySelector("[aria-label]")!.getAttribute("aria-label")).toBe("5 wins, 3 losses, 0 ties");
  });
  it("a line of words keeps its words, with its ranks and records coloured", () => {
    const c = html(<RichText text="Ranked #6 of 24 · OPR 101.6 · 5-3-0 there" />);
    expect(c.textContent).toBe("Ranked#6 of 24 · OPR 101.6 · 5-3-0 there");
    expect(c.querySelector("[data-rank-pill]")).toBeTruthy();
    expect(c.querySelector("[data-record-text]")).toBeTruthy();
  });
  it("a card line's pills: an alliance in its colour, an award with its icon", () => {
    expect(html(<ResultPill text="Red alliance" />).innerHTML).toContain("text-red-alliance-text");
    expect(html(<ResultPill text="Winning Alliance" />).querySelector("svg")).toBeTruthy();
  });
  it("the better of two teams' numbers: higher, but lower for a rank or penalties", () => {
    expect(better("OPR", "101.6", "84.4")).toBe("a");
    expect(better("World rank", "#40", "#12")).toBe("b");
    expect(better("Penalties", 3, 9)).toBe("a");
    expect(better("OPR", "50", "50")).toBeNull();
    expect(better("OPR", "–", "50")).toBeNull();
  });
});

describe("most recent event card", () => {
  it("the headline event has its type's marker and chips, the season said once", () => {
    const c = html(<StatAnswerCard stat={latest} />);
    expect(c.querySelector("[data-headline-marker]")!.className).toContain("bg-accent");
    const chips = c.querySelector("[data-headline-chips]")!;
    expect(chips.textContent).toBe("Championship2025–26");
    expect(c.querySelector("[data-headline] p.text-xs")!.textContent).toBe("Mar 15, 2026 · Hillsborough Township, NJ");
  });
  it("its table: ranks as pills, records coloured, seasons as badges, OPR bars to the best listed, type markers", () => {
    const c = html(<StatAnswerCard stat={latest} />);
    const rows = [...c.querySelectorAll('[data-block="table"] tbody tr')];
    expect(rows[1].querySelector("[data-rank-pill]")!.className).toContain(TONES.emerald.chip.split(" ")[0]);
    expect(rows[0].querySelector("[data-record-text] .text-success-text")!.textContent).toBe("5");
    expect(rows[0].querySelector("[data-season-chip]")!.textContent).toBe("2025–26");
    const bars = [...c.querySelectorAll<HTMLElement>("[data-opr-bar] span > span")].map((b) => b.style.width);
    expect(bars[0]).toBe("100%");
    expect(rows.map((r) => r.querySelector("[data-event-marker]")!.getAttribute("data-event-marker"))).toEqual(["Championship", "LeagueTournament", "LeagueMeet"]);
    // On a phone the season and date fold under the event's name: the columns left are the numbers.
    expect([...c.querySelectorAll("thead th.max-md\\:hidden")].map((t) => t.textContent)).toEqual(["Season", "Date"]);
    expect(rows[0].querySelector("[data-folded]")!.textContent).toBe("2025–26Mar 15, 2026");
  });
});

const m: StatMatchRow = {
  label: "M1", href: "/events/2023/USCASDM/matches/m1", event: { label: "California - San Diego Championship", href: "/events/2023/USCASDM" }, season: "2023–24", date: "Mar 10, 2024",
  alliance: "blue", own: 428, opp: 208, ownNp: 416, oppNp: 200, result: "W", type: "Championship", rank: 1,
  partners: [{ label: "11212 The Clueless", href: "/teams/11212" }, { label: "14496 Roboctopi", href: "/teams/14496" }],
  opponents: [{ label: "16884 Example", href: "/teams/16884" }, { label: "123 Other", href: "/teams/123" }],
  phases: { auto: 80, teleop: 256, endgame: 80, pen: 0 },
};

describe("match box", () => {
  it("red over blue, each with its teams and score, the winner marked and the loser muted", () => {
    const c = html(<ul><MatchBox r={m} /></ul>);
    const sides = [...c.querySelectorAll("[data-alliance]")];
    expect(sides.map((s) => s.getAttribute("data-alliance"))).toEqual(["red", "blue"]);
    expect(sides[1].hasAttribute("data-won")).toBe(true);
    expect([...sides[1].querySelectorAll("[data-team-chip]")].map((t) => t.getAttribute("data-team-chip"))).toEqual(["11212", "14496"]);
    expect(sides[1].querySelector("b.font-display")!.textContent).toBe("416");
    expect(sides[1].textContent).toContain("428 with penalties");
    expect(sides[0].querySelector("b.font-display")!.className).toContain("text-muted-foreground");
    expect(c.querySelector("[data-rank-badge]")!.className).toContain(TONES.emerald.chip.split(" ")[0]);
  });
  it("the listed score's phases in the team page's phase colours", () => {
    const tiles = [...html(<ul><MatchBox r={m} /></ul>).querySelectorAll("[data-phases] > div")];
    expect(tiles.map((t) => t.textContent)).toEqual(["Auto80", "TeleOp256", "Endgame80", "Pen given0"]);
    expect(tiles[0].className).toContain(TONES.sky.box.split(" ")[0]);
    expect(tiles[1].className).toContain(TONES.emerald.box.split(" ")[0]);
    expect(tiles[2].className).toContain(TONES.violet.box.split(" ")[0]);
  });
  it("a team's own match puts the team first on its alliance", () => {
    const c = html(<ul><MatchBox r={{ ...m, alliance: "red", partners: [{ label: "207 Critical Mass", href: "/teams/207" }] }} team={{ number: 4215, name: "Hypnotic Robotics" }} /></ul>);
    expect([...c.querySelectorAll('[data-alliance="red"] [data-team-chip]')].map((t) => t.getAttribute("data-team-chip"))).toEqual(["4215", "207"]);
  });
});
