// @vitest-environment jsdom
// Search's OPR answer drawn as the team page draws its OPR: a plain card, no band behind the number, and the phases as
// the team page's OPR tiles (src/components/oprCards.ts) with the same rank line, neutral (the search results guide:
// hue means team only).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { StatAnswer } from "../../../shared/searchStat";
import { TONES } from "../../StatTile";
import { StatAnswerCard, oneContext, saidBy } from "./StatAnswer";
import { SeasonPickContext } from "./SeasonPick";
import { meaningOf } from "../../../lib/textTones";

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
  it("has the team page's tiles: its names, rank line and phase colours; no tile for the headline's own number", () => {
    const c = draw(opr);
    const tiles = [...c.querySelectorAll("[data-opr-tiles] > div")];
    expect(tiles.map((t) => t.textContent)).toEqual([
      "Autonomous28.3OPR #880 of 8,308 with an OPR · top 11%",
      "TeleOp73.4OPR #640 of 8,308 with an OPR · top 8%",
      "Endgame6.7OPR #5,013 of 8,308 with an OPR · top 61%",
    ]);
    // Auto blue, TeleOp green, Endgame purple (search's palette): each tile's thick left bar and number in it.
    expect(tiles.map((t) => t.getAttribute("data-phase"))).toEqual(["auto", "teleop", "endgame"]);
    expect(tiles.map((t) => t.firstElementChild!.className.match(/border-l-([a-z]+)-\d+/)?.[1])).toEqual(["blue", "emerald", "violet"]);
  });
  it("a word's explainer that came with it is drawn inside the card: one answer card, the stat first", () => {
    const explain = { kind: "info" as const, title: "OPR: what it is and how it's worked out", lines: [{ text: "OPR estimates each robot's average contribution to its alliance's score", href: "/methodology#opr" }] };
    const c = render(<MemoryRouter><StatAnswerCard stat={opr} explain={explain} /></MemoryRouter>).container;
    expect(c.querySelectorAll("[data-answer-frame]")).toHaveLength(1);
    const ex = c.querySelector("[data-answer-frame] [data-explainer]")!;
    expect(ex.querySelector("h3")!.textContent).toBe(explain.title);
    expect(ex.querySelector("[data-line-text]")!.textContent).toBe(explain.lines[0].text);
    expect(ex.querySelector("a")!.getAttribute("href")).toBe("/methodology#opr");
    // After the stat's own numbers.
    expect(c.querySelector("[data-headline]")!.compareDocumentPosition(ex) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("puts no band behind the number, and keeps its rank, season and chip", () => {
    const c = draw(opr);
    const h = c.querySelector("[data-headline]")!;
    expect(h.className).not.toMatch(/bg-accent/);
    expect(h.textContent).toBe("101.6#612 of 8,308 worldwide"); // a rank or a percentile, not both; the season is in the scope
    expect(c.querySelector("[data-scope]")!.textContent).toBe("2025–26");
    expect(c.querySelector("[data-answer-frame]")!.className).not.toMatch(/accent/);
  });
  it("other stat answers: the team page's tiles too, no gold band or box anywhere", () => {
    const c = draw({ ...opr, intent: "wins-count", blocks: [{ kind: "kpis", items: [{ label: "Wins", value: "26", sub: "2025–26" }] }] });
    expect(c.querySelector("[data-opr-tiles]")).toBeNull();
    expect(c.querySelector("[data-headline]")!.className).not.toMatch(/bg-accent/);
    expect(c.querySelector("[data-kpi] > div")!.className).toContain(TONES.neutral.box.split(" ")[0]);
    expect(c.innerHTML).not.toMatch(/(border|bg)-accent/);
  });
  it("the team's header up top: its number, name and the season it states", () => {
    const c = draw(opr);
    const h = c.querySelector("[data-answer-team]")!;
    expect(h.textContent).toContain("4215");
    expect(h.textContent).toContain("Hypnotic Robotics");
    expect(c.querySelector("[data-answer-season]")!.textContent).toBe("2025–26");
  });
  // Greptile on #1094: a card comparing two seasons offers no one season to pick (a pick would drop the other).
  it("a card about two seasons side by side has no season picker, and keeps both season chips", () => {
    const pair: StatAnswer = { family: "leaderboard", intent: "filtered-list-pair", title: "How many teams in New Jersey: Worlds 2024 (2023–24) against Worlds 2025 (2024–25)",
      scope: ["New Jersey", "Went to Worlds", "2023–24", "2024–25"], headline: { value: "4 vs 4", label: "teams in New Jersey" }, blocks: [], definition: "", source: "" };
    const ctx = { picked: null, pending: false, pick: () => {} };
    const c = render(<MemoryRouter><SeasonPickContext.Provider value={ctx}><StatAnswerCard stat={pair} /></SeasonPickContext.Provider></MemoryRouter>).container;
    expect(c.querySelector("[role=combobox]")).toBeNull();
    expect([...c.querySelectorAll("[data-season-chip]")].map((x) => x.textContent)).toEqual(["2023–24", "2024–25"]);
    // One season's card keeps its picker.
    cleanup();
    const one = render(<MemoryRouter><SeasonPickContext.Provider value={ctx}><StatAnswerCard stat={{ ...pair, title: "Teams in New Jersey · 2024–25", scope: ["New Jersey", "2024–25"] }} /></SeasonPickContext.Provider></MemoryRouter>).container;
    expect(one.querySelector("[role=combobox]")).not.toBeNull();
  });
  // Live check of #1111: a board over every season, or over a span of seasons, is no one season's: no season to pick.
  it("a board over every season, or a span of them, has no season picker", () => {
    const ctx = { picked: null, pending: false, pick: () => {} };
    const boards: [string, string[]][] = [
      ["Team worldwide with the most wins, every season", ["Worldwide", "Every season on record (2008–09 to 2025–26)"]],
      ["Oldest teams still active in Ohio, by rookie year", ["Ohio", "Active in 2025–26 or 2026–27"]],
      ["Teams from Texas with the most awards", ["Texas", "All seasons"]],
    ];
    for (const [title, scope] of boards) {
      const st: StatAnswer = { family: "leaderboard", intent: "career-wins", title, scope, headline: { value: "1", label: "" }, blocks: [], definition: "", source: "" };
      const c = render(<MemoryRouter><SeasonPickContext.Provider value={ctx}><StatAnswerCard stat={st} /></SeasonPickContext.Provider></MemoryRouter>).container;
      expect(c.querySelector("[role=combobox]"), title).toBeNull();
      expect(c.querySelector("[data-scope]")!.textContent, title).toContain(scope[1]);
      cleanup();
    }
  });
  it("a title the page heading already says is for screen readers only", () => {
    const c = render(<MemoryRouter><StatAnswerCard stat={opr} heading="Hypnotic Robotics (4215) · OPR in 2025–26" /></MemoryRouter>).container;
    expect(c.querySelector("[data-answer-title]")!.className).toContain("sr-only");
  });
  // Sign-off visual pass (C41/C42): "Top 10 teams by OPR in Romania · 2025–26" under the heading "Top 10 teams by OPR in
  // Romania" read twice; the season it adds is its chip.
  it("a title that is the heading plus what its chips say is for screen readers only too", () => {
    const board = { ...opr, family: "leaderboard", intent: "top-opr", team: undefined, title: "Top 10 teams by OPR in Romania · 2025–26", scope: ["Romania", "2025–26"] } as StatAnswer;
    const c = render(<MemoryRouter><StatAnswerCard stat={board} heading="Top 10 teams by OPR in Romania" /></MemoryRouter>).container;
    expect(c.querySelector("[data-answer-title]")!.className).toContain("sr-only");
    expect(c.querySelector("[data-scope]")!.textContent).toContain("2025–26");
    // A title saying more than its chips and the heading still shows.
    const more = render(<MemoryRouter><StatAnswerCard stat={{ ...board, title: "Top 10 teams by OPR in Romania, with awards · 2025–26" }} heading="Top 10 teams by OPR in Romania" /></MemoryRouter>).container;
    expect(more.querySelector("[data-answer-title]")!.className).not.toContain("sr-only");
  });
  it("phase values (no bars) in the team page's phase colours; phase columns neutral", () => {
    const c = draw({ ...opr, intent: "phase", blocks: [
      { kind: "bars", title: "Phases", groups: [{ label: "x", items: [{ label: "Auto", value: 20 }, { label: "TeleOp", value: 60 }, { label: "Endgame", value: 10 }] }] },
      { kind: "table", title: "By event", columns: [{ key: "e", label: "Event" }, { key: "a", label: "Auto", num: true }, { key: "t", label: "TeleOp", num: true }, { key: "g", label: "Endgame", num: true }], rows: [{ cells: { e: "Q", a: "1", t: "2", g: "3" } }] },
    ] } as StatAnswer);
    // One team's phase values are small tiles, each in the team page's colour for its phase (the owner's call).
    const tiles = [...c.querySelectorAll<HTMLElement>("[data-bar-value]")];
    expect(tiles.map((t) => t.textContent)).toEqual(["Auto20", "TeleOp60", "Endgame10"]);
    expect(tiles.map((t) => t.getAttribute("data-phase"))).toEqual(["auto", "teleop", "endgame"]);
    expect(tiles.map((t) => t.className.match(/border-l-([a-z]+)-\d+/)?.[1])).toEqual(["blue", "emerald", "violet"]);
    expect(c.querySelector('[data-block="bars"] [style*="width"]')).toBeNull();
    expect(c.querySelectorAll("th[data-phase]")).toHaveLength(0);
  });
  it("each team keeps its own hue: a team's name is never read as an award, and team B's values are team B's", () => {
    const teams = [{ number: 7149, name: "Control Freaks" }, { number: 16461, name: "Infinite Turtles" }];
    const c = draw({ ...opr, family: "two-team", intent: "predict", team: undefined, teams, headline: undefined, blocks: [
      { kind: "kpis", items: [{ label: "Control Freaks (7149)", value: "140" }, { label: "Infinite Turtles (16461)", value: "120" }] },
      { kind: "bars", title: "Predicted score", groups: [{ label: "x", items: [{ label: "7149", value: 150, tone: "a" }, { label: "16461", value: 130, tone: "b" }] }] },
    ] } as StatAnswer);
    expect([...c.querySelectorAll("[data-kpi] [class*=border-l-team]")].map((t) => t.className.match(/border-l-(team-[abc])/)?.[1])).toEqual(["team-a", "team-b"]);
    expect([...c.querySelectorAll("[data-bar-value]")].map((t) => t.className.match(/border-l-(team-[abc])/)?.[1])).toEqual(["team-a", "team-b"]);
  });
  it("a phase or an award keeps its own colour whatever tone the server gave it", () => {
    const c = draw({ ...opr, blocks: [{ kind: "bars", title: "Event OPR", groups: [{ label: "x", items: [{ label: "Auto", value: 30, tone: "a" }, { label: "TeleOp", value: 70, tone: "b" }, { label: "Inspire", value: 1, tone: "c" }] }] }] } as StatAnswer);
    expect([...c.querySelectorAll("[data-bar-value]")].map((t) => t.className.match(/border-l-([a-z]+)-\d+/)?.[1])).toEqual(["blue", "emerald", "fuchsia"]);
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
    // Greptile on #1025: a chart point is a link for a mouse only; on a phone or touch screen neighbouring points can
    // sit closer than a finger, so there it's a mark and the list below (a full row each, 44px) is the way in.
    const series = c.querySelector("[data-block=series]")!;
    const point = series.querySelector('.relative a[href="/events/2025/USNJNOLT2?team=4215"]')!;
    expect(point.className).toMatch(/max-md:hidden.*pointer-coarse:hidden/);
    expect(series.querySelectorAll('.relative [role=img].max-md\\:flex')).toHaveLength(1);
    expect(series.querySelector('[data-series-values] a[href="/events/2025/USNJNOLT2?team=4215"]')!.className).toContain("max-md:min-h-[44px]");
    // Hovering or focusing a point says what it is at once: its name, then its value (not a slow browser title).
    const tip = point.querySelector("[data-point-tip]")!;
    expect([...tip.children].map((x) => x.textContent)).toEqual(["East Bergen Conference Northern League Tournament", "84.4"]);
    expect(tip.className).toMatch(/group-hover:block.*group-focus-visible:block/);
    expect(point.getAttribute("title")).toBeNull();
    // A tip opens toward the chart's wider side, at most 48% of the chart wide: never past an edge, wherever the point.
    expect(tip.className).toContain("left-0");
    expect(tip.className).toContain("max-w-[min(16rem,48cqw)]");
    const tips = [...series.querySelectorAll(".relative a [data-point-tip], .relative [role=img].flex [data-point-tip]")];
    expect(tips.at(-1)!.className).toContain("right-0");
    // A point with no link can be focused too, and the one hovered or focused sits above the rest.
    const plain = series.querySelector(".relative [role=img].flex") as HTMLElement;
    expect(plain.tabIndex).toBe(0);
    plain.focus();
    expect(document.activeElement).toBe(plain);
    expect(plain.className).toMatch(/hover:z-20.*focus-visible:z-20/);
    expect(point.className).toMatch(/hover:z-20.*focus-visible:z-20/);
  });
});

describe("each fact printed once (the guide's §8)", () => {
  it("a headline keeps a rank or a percentile, not both, and no season the scope shows", () => {
    expect(oneContext("#612 of 8,308 worldwide · top 8%", "2025–26", ["2025–26"])).toEqual({ label: "#612 of 8,308 worldwide", sub: undefined });
    expect(oneContext("Top 8% worldwide", "Hillsborough · 2025–26", ["2025–26"])).toEqual({ label: "Top 8% worldwide", sub: "Hillsborough" });
  });
  it("knows a number the card said, never a part of a bigger one", () => {
    const said = saidBy({ ...opr, headline: { value: "26-6-0", label: "81% win rate in 32 matches" } });
    expect(["81%", "2025–26", "26-6-0"].filter(said.has)).toEqual(["81%", "2025–26", "26-6-0"]);
    expect(["8", "26", "2", "81", "32 matches"].filter(said.has)).toEqual(["32 matches"]);
  });
  it("a record: no tile or line restating the headline's win rate or the season", () => {
    const c = draw({ ...opr, intent: "record", headline: { value: "26-6-0", label: "81% win rate in 32 matches" }, blocks: [
      { kind: "kpis", items: [{ label: "Win rate", value: "81%" }, { label: "Season", value: "2025–26" }, { label: "World rank by win rate", value: "#102", sub: "of 8,308 teams" }] },
      { kind: "record", title: "Wins, losses and ties", wins: 26, losses: 6, ties: 0 },
    ] });
    expect([...c.querySelectorAll("[data-kpi]")].map((k) => k.textContent)).toEqual(["World rank by win rate#102of 8,308 teams"]);
    expect(c.querySelector("[data-block=record]")!.textContent).not.toContain("win rate");
    // One team's record headline: its wins in the team's hue (the record's own ink would otherwise hide it).
    expect(c.querySelector("[data-headline] [data-record-text] b")!.className).toContain("text-team-a");
  });
  it("a score without penalties is a score, not the penalty phase", () => {
    expect(meaningOf("Without penalties")).toBeNull();
    expect(meaningOf("Score before penalties")).toBeNull();
    expect(meaningOf("Pen given")).toBe("pen");
    expect(meaningOf("Penalties")).toBe("pen");
  });
  it("matches all at one event: the event named once over the list, each box keeping its date", () => {
    const m = (n: number) => ({ label: `Q${n}`, href: `/events/2025/USNJCMP?match=qual:0:${n}`, event: { label: "NJ Championship", href: "/events/2025/USNJCMP" }, season: "2025–26", date: "Mar 15, 2026",
      alliance: "red" as const, own: 150, opp: 140, result: "W" as const, partners: [], opponents: [], type: "Championship" });
    const c = draw({ ...opr, intent: "event-matches", headline: undefined, blocks: [{ kind: "matches", title: "Matches in order", rows: [m(1), m(2)] }] });
    expect(c.querySelector("[data-block=matches] h3")!.textContent).toBe("Matches in order · NJ ChampionshipChampionship"); // its type as a chip; the season is in the scope
    expect([...c.querySelectorAll("[data-match-box]")].map((b) => b.textContent).filter((t) => t!.includes("NJ Championship"))).toEqual([]);
    expect(c.querySelector("[data-match-box]")!.textContent).toContain("Mar 15, 2026");
  });
  it("a tile of another thing with the same number stays (\"8 matches rated\" and Auto 8)", () => {
    const c = draw({ ...opr, headline: { value: "71.2", label: "8 matches rated" }, blocks: [{ kind: "kpis", items: [{ label: "Auto", value: "8" }, { label: "TeleOp", value: "40" }] }] });
    expect([...c.querySelectorAll("[data-kpi]")].map((k) => k.textContent)).toEqual(["Auto8", "TeleOp40"]);
  });
  it("a tile with more than the headline says (a rank, a count) stays", () => {
    const c = draw({ ...opr, headline: { value: "28.3 vs 22.1", label: "Auto OPR" }, blocks: [{ kind: "kpis", items: [
      { label: "4215 Auto", value: "28.3", sub: "#880 of 8,308" }, { label: "Season", value: "2025–26" }] }] });
    expect([...c.querySelectorAll("[data-kpi]")].map((k) => k.textContent)).toEqual(["4215 Auto28.3#880 of 8,308"]);
    expect([...draw(opr).querySelectorAll("[data-opr-tiles] > div")].length).toBe(3); // Total OPR: its number and rank both in the headline
  });
  it("the method behind an info button, one footnote line", () => {
    const c = draw(opr);
    const note = c.querySelector("[data-definition] [role=note]") as HTMLElement;
    expect(note.hidden).toBe(true);
    fireEvent.click(c.querySelector("[data-method]")!);
    expect(note.hidden).toBe(false);
    expect(c.querySelector("[data-definition]")!.textContent).not.toContain("How this is counted:");
  });
});
