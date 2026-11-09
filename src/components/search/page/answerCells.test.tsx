// @vitest-environment jsdom
// Search answer cards by the search results guide: no hue on data (ranks as neutral pills with a medal, records with
// the wins bold, event types and seasons as badges, OPR bars in neutral ink from zero to the best listed), and every
// list of matches as match boxes (red over blue only because they are alliances, the winner marked, the phases neutral).
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { StatAnswer, StatMatchRow } from "../../../shared/searchStat";
import { RankPill, RecordText, ResultPill, RichText, better, kpiSwatches } from "./answerCells";
import { SEARCH_PALETTE } from "../../../lib/textTones";
import { MatchBox } from "./MatchBox";
import { StatAnswerCard } from "./StatAnswer";

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
  it("a rank is a pill in the team hue, filled with a medal on the top three", () => {
    const one = html(<RankPill text="#1 of 21" />).querySelector("[data-rank-pill]")!;
    expect(one.className).toContain("bg-team-a");
    expect(one.className).not.toMatch(/success|info|orange/);
    expect(one.querySelector("svg")).toBeTruthy();
    expect(one.textContent).toBe("#1 of 21");
    const six = html(<RankPill text="#6 of 24" />).querySelector("[data-rank-pill]")!;
    expect(six.querySelector("svg")).toBeNull();
    expect(six.className).not.toMatch(/accent/);
  });
  it("a record has its wins bold, no win or loss hue, and reads as words", () => {
    const c = html(<RecordText text="5-3-0" />);
    expect(c.querySelector("b")!.textContent).toBe("5");
    expect(c.innerHTML).not.toMatch(/success|danger/);
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
    // Formatted numbers compare by their number; reliability parts are lower-is-better.
    expect(better("OPR rank", "#12 of 300", "#40 of 300")).toBe("a");
    expect(better("Prediction rating", "98.0 ±3.2", "101.6 ±2.3")).toBe("b");
    expect(better("No-shows", 5, 2)).toBe("b");
    expect(better("Swing", "0.40", "0.25")).toBe("b");
    expect(better("Penalties given away vs field", "0.50×", "1.20×")).toBe("a");
  });
});

describe("most recent event card", () => {
  it("the headline event has its type and season as neutral badges, the season said once", () => {
    const c = html(<StatAnswerCard stat={latest} />);
    expect(c.querySelector("[data-headline-marker]")).toBeNull();
    const chips = c.querySelector("[data-headline-chips]")!;
    expect(chips.textContent).toBe("Championship2025–26");
    expect(c.querySelector("[data-headline] p.text-xs")!.textContent).toBe("Mar 15, 2026 · Hillsborough Township, NJ");
  });
  it("its table: ranks as pills, records with the wins bold, seasons as badges, neutral OPR bars from zero, type badges", () => {
    const c = html(<StatAnswerCard stat={latest} />);
    const rows = [...c.querySelectorAll('[data-block="table"] tbody tr')];
    expect(rows[1].querySelector("[data-rank-pill] svg")).toBeTruthy();
    expect(rows[0].querySelector("[data-record-text] b")!.textContent).toBe("5");
    expect(rows[0].querySelector("[data-season-chip]")!.textContent).toBe("2025–26");
    const bars = [...c.querySelectorAll<HTMLElement>("[data-opr-bar] span > span")].map((b) => b.style.width);
    expect(bars[0]).toBe("100%");
    // From zero: 84.4 of 101.6 draws 83%, never a cut baseline.
    expect(Number.parseFloat(bars[1])).toBeCloseTo((100 * 84.4) / 101.6, 1);
    expect(rows.map((r) => r.querySelector("[data-event-type]")!.getAttribute("data-event-type"))).toEqual(["Championship", "LeagueTournament", "LeagueMeet"]);
    // No hue on the data (a hover's link colour is chrome).
    expect(c.querySelector('[data-block="table"]')!.innerHTML).not.toMatch(/(?<![:\w-])(text|bg|border)-(success|info|teal|sky|emerald|violet|accent)/);
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
    expect(c.querySelector("[data-rank-badge]")!.className).toContain("bg-team-a");
  });
  it("asked without penalties: only the scores without them, no score with penalties", () => {
    const c = html(<ul><MatchBox r={{ ...m, noPenalties: true }} /></ul>);
    expect(c.querySelector("[data-scoreboard]")!.textContent).not.toContain("with penalties");
  });
  it("the listed score's phases as tiles filled in the palette's phase colours, red and blue only on the alliances", () => {
    const c = html(<ul><MatchBox r={m} /></ul>);
    const tiles = [...c.querySelectorAll("[data-phases] > div")];
    expect(tiles.map((t) => t.textContent)).toEqual(["Auto80", "TeleOp256", "Endgame80", "Pen given0"]);
    expect(tiles.map((t) => t.className.split(" ").find((x) => /^bg-[a-z]+-\d+$/.test(x)))).toEqual(["bg-blue-600", "bg-emerald-700", "bg-violet-600", "bg-red-700"]);
    expect(c.querySelector("[data-scoreboard]")!.innerHTML).not.toMatch(/(text|bg|border)-(success|info|sky|emerald|violet|rose|teal)/);
  });
  it("a row's own team (a list across several teams) goes first on its alliance, with no card team", () => {
    const c = html(<ul><MatchBox r={{ ...m, alliance: "red", self: { label: "6980 Bad Wolf", href: "/teams/6980" }, partners: [{ label: "4215 Hypnotic Robotics", href: "/teams/4215" }] }} /></ul>);
    expect([...c.querySelectorAll('[data-alliance="red"] [data-team-chip]')].map((t) => t.getAttribute("data-team-chip"))).toEqual(["6980", "4215"]);
  });
  it("a team's own match puts the team first on its alliance", () => {
    const c = html(<ul><MatchBox r={{ ...m, alliance: "red", partners: [{ label: "207 Critical Mass", href: "/teams/207" }] }} team={{ number: 4215, name: "Hypnotic Robotics" }} /></ul>);
    expect([...c.querySelectorAll('[data-alliance="red"] [data-team-chip]')].map((t) => t.getAttribute("data-team-chip"))).toEqual(["4215", "207"]);
  });
});

describe("combined scores", () => {
  it("bolds the official winner, penalties included, not the higher score without them", () => {
    const stat: StatAnswer = { ...latest, team: undefined, headline: undefined, blocks: [{ kind: "table", title: "Highest combined scores", columns: [{ key: "rank", label: "#", num: true }, { key: "combined", label: "Combined", num: true }, { key: "score", label: "Red–Blue" }, { key: "match", label: "Match" }, { key: "event", label: "Event" }, { key: "date", label: "Date" }],
      rows: [{ cells: { rank: 1, combined: 205, score: "100–105", match: "Q1", event: "Texas Qualifier", date: "Mar 1, 2026" }, href: "/m", eventHref: "/events/2025/TX", type: "Qualifier", teams: { red: [{ label: "1 A", href: "/teams/1" }], blue: [{ label: "2 B", href: "/teams/2" }] }, winner: "red" }] }] };
    const c = html(<StatAnswerCard stat={stat} />);
    expect(c.querySelector("[data-match-row] .text-red-alliance-text")!.className).toContain("font-bold");
    // The loser muted, not a faded alliance colour (that falls under 4.5:1).
    expect(c.querySelector("[data-match-row] [aria-label^=Red] > span:last-child")!.className).toBe("text-muted-foreground");
    expect([...c.querySelectorAll("[data-match-row] [data-team-chip]")].map((t) => t.getAttribute("data-team-chip"))).toEqual(["1", "2"]);
    // The combined bar from zero, in the team hue (no data visual is grey).
    const bar = c.querySelector<HTMLElement>("[data-combined] [data-bar]")!;
    expect(bar.style.width).toBe("100%");
    expect(bar.className).toContain("bg-team-a");
  });
});


describe("one team's tiles, each its own colour (the owner, 11-09)", () => {
  it("a falling trend red, a rising one green, and no two tiles in a row the same", () => {
    const row = [{ label: "Average, last 6", value: "78.3" }, { label: "Trend", value: "Falling", tone: "bad" }, { label: "Highest", value: "99" }, { label: "Lowest", value: "57" }];
    const sw = kpiSwatches(row);
    expect(sw[1]).toBe(SEARCH_PALETTE.pen);
    expect(sw[0].bar).toBe("bg-team-a");
    expect(new Set(sw.map((s) => s.bar)).size).toBe(4);
    expect(kpiSwatches([{ label: "Trend", value: "Rising", tone: "good" }])[0]).toBe(SEARCH_PALETTE.yes);
    expect(kpiSwatches([{ label: "Trend", value: "Steady" }])[0]).toBe(SEARCH_PALETTE.no);
    // Tiles with no kind of their own still never share a colour.
    expect(new Set(kpiSwatches([{ label: "Wins" }, { label: "Losses" }, { label: "Ties" }, { label: "Events" }]).map((s) => s.bar)).size).toBe(4);
  });
});
