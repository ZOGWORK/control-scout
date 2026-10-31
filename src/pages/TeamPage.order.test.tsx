// @vitest-environment jsdom
// A team page opens on the team's own numbers: OPR, trends, the event list (titled
// "Season Road Map") and matches come first, and the workspace's scouting take
// ("Your team's take") sits at the very bottom, after Matches, with results or without.
// Reliability, the report card and schedule difficulty start closed, and their data
// is asked for only when one is first opened.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TeamProfile } from "../shared/api";

const stat = (value: number, rank: number) => ({ value, rank, of: 8000 });
const EVENT = {
  season: 2025, code: "USNJQ1", name: "NJ Qualifier", type: "Qualifier", start: "2025-11-01", end: "2025-11-01", city: "Edison", state: "NJ", country: "USA",
  rank: 3, rp: 2, wins: 4, losses: 1, ties: 0, qualPlayed: 5, opr: { np: 80, auto: 20, teleop: 50, endgame: 10, pen: 2 }, avg: { score: 90, np: 85, pen: 5 }, awards: [], alliance: null,
};
const profile = (events: unknown[]) => ({
  team: { number: 4215, name: "Hypnotic Robotics", fullName: null, school: null, sponsors: [], city: "Oradell", state: "NJ", country: "USA", rookieYear: 2010, website: null, homeRegion: "USNJ" },
  season: 2025, seasons: [2025],
  stats: events.length ? { opr: { np: stat(80, 600), auto: stat(20, 800), teleop: stat(50, 600), endgame: stat(10, 900), pen: 2 }, rating: null, reliability: null, record: { wins: 4, losses: 1, ties: 0, matches: 5, events: 1 }, avg: { np: 85, score: 90, pen: 5 } } : null,
  events, awardsAllTime: [],
}) as unknown as TeamProfile;

let current: TeamProfile = profile([EVENT]);
/** Every path the page asked for, and the answers the sections' own requests get (none yet: still loading). */
const asked = new Set<string>();
const answers = new Map<string, unknown>();
const answer = (path: string) => path.startsWith("/api/teams/4215/matches") ? { matches: [] }
  : /^\/api\/teams\/4215\/(report-card|schedule)\?/.test(path) ?answers.get(path.split("?")[0])
  : path.startsWith("/api/teams/4215") ? current : undefined;
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    if (path) asked.add(path);
    const data = path ? answer(path) : undefined;
    return { data, error: undefined, loading: !!path && data === undefined, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), usePredictable: () => true, useTitle: () => {}, useCurrentSeason: () => 2025, useMeta: () => null }));
vi.mock("../lib/afterPaint", () => ({ useAfterFirstPaint: () => true }));
vi.mock("../lib/personal", () => ({
  usePersonal: () => ({ user: null, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] }, update: () => {}, set: () => {} }),
  useTeamFlags: () => ({ isMine: false, tracked: false, bookmarked: false, toggleTrack: () => {}, toggleBookmark: () => {}, setMine: () => {} }),
}));
vi.mock("../lib/yoursRow", () => ({ FOLLOWED_TEAM_PATH: "/my-teams", useYoursRow: () => ({ row: { kind: "followed" } }) }));
vi.mock("../lib/scouting", () => ({ useScouting: () => ({ entries: [], notes: {}, setNote: () => {}, ready: true }) }));
vi.mock("../components/ScoutConsensus", () => ({ TeamConsensusSection: () => <section data-testid="take"><h2>Your team’s take</h2></section> }));
// Charts measure the DOM: not what's under test here.
vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: ({ children }: { children: unknown }) => children }));

const { default: TeamPage } = await import("./TeamPage");
const { TooltipProvider } = await import("../components/ui/overlay");
const mount = (at = "/teams/4215") => render(<TooltipProvider><MemoryRouter initialEntries={[at]}><Routes><Route path="/teams/:number" element={<TeamPage />} /></Routes></MemoryRouter></TooltipProvider>);
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => { cleanup(); asked.clear(); answers.clear(); });
const FOLDED = ["Reliability", "Prediction report card", "Schedule difficulty"];
const fold = (name: string) => screen.getByRole("button", { name });
const sectionAsks = () => [...asked].filter((x) => /\/(report-card|schedule)\?/.test(x));

describe("team page order", () => {
  it("puts the scouting take after OPR, event history and matches", () => {
    current = profile([EVENT]);
    mount();
    const take = screen.getByTestId("take");
    for (const name of [/Offensive power rating/, /Season Road Map/, /^Matches$/]) {
      const heading = screen.getByRole("heading", { name });
      expect(follows(heading, take)).toBe(true);
    }
    // Nothing comes after it.
    const all = [...document.querySelectorAll("h2")];
    expect(all.at(-1)?.textContent).toBe("Your team’s take");
  });

  it("is last for a team with no results this season too", () => {
    current = profile([]);
    mount();
    const all = [...document.querySelectorAll("h2")];
    expect(all.at(-1)?.textContent).toBe("Your team’s take");
  });
});

describe("collapsed sections", () => {
  it("start closed, each with a chevron and a Show hint, and ask for nothing on load", () => {
    current = profile([EVENT]);
    mount();
    for (const name of FOLDED) {
      const b = fold(name);
      // A real button (Enter and Space press it), inside the section's heading.
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
      expect(b.closest("h2")).toBeTruthy();
      expect(b.getAttribute("aria-expanded")).toBe("false");
      expect(b.textContent).toMatch(/Show$/);
      expect(b.querySelector("svg")).toBeTruthy();
      expect(document.getElementById(b.getAttribute("aria-controls")!)!.hidden).toBe(true);
    }
    expect(screen.queryByText(/No qualification matches to estimate reliability/)).toBeNull();
    expect(sectionAsks()).toEqual([]);
  });

  it("asks for a section's data on its first opening, shows it loading, then the content; closing and reopening asks nothing new", () => {
    current = profile([EVENT]);
    const { rerender } = mount();
    const b = fold("Prediction report card");
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(b.textContent).toMatch(/Hide$/);
    expect(b.querySelector("svg")!.getAttribute("class")).toMatch(/rotate-180/);
    expect(sectionAsks()).toEqual(["/api/teams/4215/report-card?season=2025"]);
    const body = document.getElementById(b.getAttribute("aria-controls")!)!;
    expect(body.querySelector(".skeleton")).toBeTruthy();

    answers.set("/api/teams/4215/report-card", { team: 4215, season: 2025, reportCards: null });
    rerender(<TooltipProvider><MemoryRouter initialEntries={["/teams/4215"]}><Routes><Route path="/teams/:number" element={<TeamPage />} /></Routes></MemoryRouter></TooltipProvider>);
    expect(screen.getByText(/No scored live calls on 4215/)).toBeTruthy();

    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
    // Kept mounted while closed: the answer stays, nothing is asked again.
    asked.clear();
    fireEvent.click(b);
    expect(body.hidden).toBe(false);
    expect(screen.getByText(/No scored live calls on 4215/)).toBeTruthy();
    expect(sectionAsks()).toEqual([]);
    // The others are still closed and unasked.
    expect(fold("Schedule difficulty").getAttribute("aria-expanded")).toBe("false");
    expect([...asked].some((x) => x.includes("/schedule"))).toBe(false);
  });

  it("start closed and unasked again on another season, even one opened before", () => {
    current = profile([EVENT]);
    const { rerender } = mount();
    fireEvent.click(fold("Prediction report card"));
    fireEvent.click(fold("Prediction report card")); // opened once, then closed
    current = { ...profile([{ ...EVENT, season: 2024 }]), season: 2024 } as TeamProfile;
    asked.clear();
    rerender(<TooltipProvider><MemoryRouter initialEntries={["/teams/4215"]}><Routes><Route path="/teams/:number" element={<TeamPage />} /></Routes></MemoryRouter></TooltipProvider>);
    for (const name of FOLDED) expect(fold(name).getAttribute("aria-expanded")).toBe("false");
    expect(sectionAsks()).toEqual([]);
  });

  it("opens the section a link points at", () => {
    current = profile([EVENT]);
    mount("/teams/4215#schedule-difficulty");
    expect(fold("Schedule difficulty").getAttribute("aria-expanded")).toBe("true");
    expect(sectionAsks()).toEqual(["/api/teams/4215/schedule?season=2025"]);
    expect(fold("Reliability").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the Season Road Map", () => {
  const OLDER = { ...EVENT, code: "USNJQ0", name: "NJ Kickoff Qualifier", start: "2025-10-01", end: "2025-10-01", rank: 7 };

  it("is the one event list: history's cards newest first under the new heading, open, with no separate road map", () => {
    current = profile([OLDER, EVENT]); // the server lists events oldest first
    mount();
    const heading = screen.getByRole("heading", { name: "Season Road Map (2)" });
    expect(screen.queryByRole("heading", { name: /Event history/ })).toBeNull();
    expect(screen.getAllByRole("heading", { name: /road map/i })).toEqual([heading]);
    expect(heading.querySelector("button")).toBeNull();
    const section = heading.closest("section")!;
    expect(section.textContent).toMatch(/newest first/);
    const text = section.textContent!;
    expect(text.indexOf("NJ Qualifier")).toBeLessThan(text.indexOf("NJ Kickoff Qualifier"));
    expect(text).toMatch(/OPR/);
    expect([...asked].some((x) => x.includes("/roadmap"))).toBe(false);
  });

  it("no road map section for a team with no results either", () => {
    current = profile([]);
    mount();
    expect(screen.queryByRole("heading", { name: /road map/i })).toBeNull();
    expect([...asked].some((x) => x.includes("/roadmap"))).toBe(false);
  });
});
