// @vitest-environment jsdom
// A team page opens on the team's own numbers: OPR, trends, event history and
// matches come first, and the workspace's scouting take ("Your team's take")
// sits at the very bottom, after Matches, with results or without.
import { cleanup, render, screen } from "@testing-library/react";
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
  stats: events.length ? { opr: { np: stat(80, 600), auto: stat(20, 800), teleop: stat(50, 600), endgame: stat(10, 900), pen: 2 }, rating: null, record: { wins: 4, losses: 1, ties: 0, matches: 5, events: 1 }, avg: { np: 85, score: 90, pen: 5 } } : null,
  events, awardsAllTime: [],
}) as unknown as TeamProfile;

let current: TeamProfile = profile([EVENT]);
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => ({ data: path?.startsWith("/api/teams/4215/matches") ? { matches: [] } : path?.startsWith("/api/teams/4215") ? current : undefined, error: undefined, loading: false, reload: () => {} }),
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
const mount = () => render(<TooltipProvider><MemoryRouter initialEntries={["/teams/4215"]}><Routes><Route path="/teams/:number" element={<TeamPage />} /></Routes></MemoryRouter></TooltipProvider>);
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(cleanup);

describe("team page order", () => {
  it("puts the scouting take after OPR, event history and matches", () => {
    current = profile([EVENT]);
    mount();
    const take = screen.getByTestId("take");
    for (const name of [/Offensive power rating/, /Event history/, /^Matches$/]) {
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
