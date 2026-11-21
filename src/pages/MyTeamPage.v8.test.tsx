// @vitest-environment jsdom
// My team in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "what's my team's next match, and our
// chances?": no team set, one box to pick it and a quiet list of what's coming (no coloured icon chips); with a team,
// the next match and its chance to win come first, then the season's standing in one row. With v8 off the page is
// drawn as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MatchView, TeamProfile } from "../shared/api";

const h = vi.hoisted(() => ({ myTeam: 19641 as number | null }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, set: () => {}, update: () => {}, state: { myTeam: h.myTeam, videoLinks: {}, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, usePredictable: () => true, useTitle: () => {} }));

const { default: MyTeamPage, sideOf } = await import("./MyTeamPage");
const { TooltipProvider } = await import("../components/ui/overlay");
const { resetFlags } = await import("../lib/flags");
const { DEFAULT_FLAGS } = await import("../shared/flags");

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const stat = (value: number, rank: number) => ({ value, rank, of: 8000 });
const profile = {
  team: { number: 19641, name: "Mars" }, season: 2025, seasons: [2025],
  stats: { opr: { np: stat(100.6, 80), auto: stat(20, 600), teleop: stat(70, 600), endgame: stat(10, 600), pen: 0 }, rating: { np: 90, sd: 6, rank: 50, matches: 10 },
    record: { wins: 8, losses: 2, ties: 0, matches: 10, events: 1 }, avg: { np: 90, score: 95, pen: 5 } },
  events: [{ season: 2025, code: "USNJQ2", name: "NJ Qualifier Two", type: "Qualifier", start: day(0), end: day(1), rank: 3, wins: 8, losses: 2, ties: 0, opr: { np: 100.6 }, awards: [] }],
  awardsAllTime: [],
} as unknown as TeamProfile;
const side = (n: number[]) => ({ teams: n.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
const next: MatchView = { season: 2025, code: "USNJQ2", key: "qual:1:14", level: "qual", series: 1, number: 14, label: "Q14", time: null, startsAt: null, played: false,
  red: side([19641, 4215]), blue: side([123, 456]), video: null, prediction: { pRed: 0.64, redMean: 120, blueMean: 100, tier: "moderate", kind: "now", predictedAt: null } } as MatchView;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  h.myTeam = 19641;
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/teams/19641/matches")) return json({ matches: [next] });
    if (path.startsWith("/api/teams/19641")) return json(profile);
    return json({});
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

const page = () => render(<TooltipProvider><MemoryRouter initialEntries={["/my-team"]}><MyTeamPage /></MemoryRouter></TooltipProvider>);
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("My team, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("no team: the title, one box to pick it, and what's coming as quiet rows (no coloured icon chips)", () => {
    h.myTeam = null;
    page();
    expect(document.querySelector("[data-myteam-v8]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("My team");
    expect(document.querySelector("[data-pick-team]")!.querySelector("input")).not.toBeNull();
    const list = screen.getByRole("list", { name: "What your dashboard shows" });
    expect(list.querySelectorAll("li")).toHaveLength(4);
    for (const svg of list.querySelectorAll("svg")) expect(svg.getAttribute("class")).toContain("text-text-faint");
  });

  it("with a team: the next match's chance to win first, then the standing in one row", async () => {
    page();
    const chance = await waitFor(() => { const e = document.querySelector("[data-next-chance]"); if (!e) throw new Error("not yet"); return e; });
    expect(chance.textContent).toBe("64%");
    const nextCard = document.querySelector("[data-next]")!;
    expect(nextCard.textContent).toContain("Q14");
    expect(nextCard.textContent).toContain("Red alliance");
    expect(nextCard.textContent).toContain("4215"); // the partner
    expect(nextCard.textContent).toContain("123, 456"); // the opponents
    const standing = document.querySelector("[data-standing]")!;
    expect(follows(nextCard, standing)).toBe(true);
    expect(standing.querySelector("[data-hero-figure]")!.textContent).toMatch(/^Top /);
    expect(standing.textContent).toContain("8-2-0");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("19641");
    expect(h1.textContent).toContain("Mars");
    // Neutral cards: no coloured tile fills.
    expect(document.querySelector("[data-myteam-v8]")!.innerHTML).not.toMatch(/bg-(success|info)\/\[0\.07\]/);
  });

  it("a match's side: partners, opponents and the chance from that side", () => {
    const s = sideOf({ ...next }, 456)!;
    expect(s.color).toBe("blue");
    expect(s.partners.map((t) => t.number)).toEqual([123]);
    expect(s.opponents.map((t) => t.number)).toEqual([19641, 4215]);
    expect(s.p).toBeCloseTo(0.36);
    expect(sideOf(next, 1)).toBeNull();
  });
});

describe("My team, v8 off", () => {
  it("is drawn as before", async () => {
    page();
    await waitFor(() => expect(screen.getByText("Season so far")).toBeTruthy());
    expect(document.querySelector("[data-myteam-v8]")).toBeNull();
    expect(document.querySelector("[data-next-chance]")).toBeNull();
  });
});
