// @vitest-environment jsdom
// The team page in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "how good is this team right
// now, and what's next?": identity, the standing in one row (numbers in the slate-blue accent) and what's next first,
// every action in a row under the standing (one primary), then the matches; OPR and the rating as one quiet Strength table (mint only on its bars), how
// it's computed behind a disclosure; no hover lift or glow; the closed sections as card headers with no colour wash.
// With v8 off the page is drawn exactly as before.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TeamProfile } from "../shared/api";

const stat = (value: number, rank: number) => ({ value, rank, of: 8000 });
const EVENT = {
  season: 2025, code: "USNJQ1", name: "NJ Qualifier", type: "Qualifier", start: "2025-11-01", end: "2025-11-01", city: "Edison", state: "NJ", country: "USA",
  rank: 1, rp: 2, wins: 4, losses: 1, ties: 0, played: 5, qualPlayed: 5, onField: true, opr: { np: 80, auto: 20, teleop: 50, endgame: 10, pen: 2 }, avg: { score: 90, np: 85, pen: 5 },
  awards: [{ type: "Inspire", placement: 1 }], alliance: null,
};
const RELIABILITY = { index: 84, matches: 32, fieldIndex: 70, noShows: 0, dqs: 0, nearZero: 1, parts: { swing: 1, penaltyRatio: 1, predictabilityRatio: 1 }, recent: { matches: 10, noShows: 0, nearZero: 0 } };
const profile = {
  team: { number: 4215, name: "Hypnotic Robotics", fullName: null, school: "Oradell Public School", sponsors: [], city: "Oradell", state: "NJ", country: "USA", rookieYear: 2010, website: null, homeRegion: "USNJ" },
  season: 2025, seasons: [2025, 2024],
  stats: { opr: { np: stat(80, 600), auto: stat(20, 800), teleop: stat(50, 600), endgame: stat(10, 900), pen: 2 }, rating: { np: 70, sd: 6, auto: 18, teleop: 45, endgame: 7, pen: 2, rank: 500, matches: 32 }, reliability: RELIABILITY, record: { wins: 4, losses: 1, ties: 0, matches: 5, events: 1 }, avg: { np: 85, score: 90, pen: 5 } },
  events: [EVENT], awardsAllTime: [{ season: 2025, code: "USNJQ1", event: "NJ Qualifier", type: "Inspire", placement: 1 }],
  highlights: true, recordSplit: null,
} as unknown as TeamProfile;

/** The viewer's flags on the team (My team, tracked, shortlisted); a test may set them. */
const flags = vi.hoisted(() => ({ isMine: false, tracked: false, bookmarked: false }));

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    const data = !path ? undefined : path.includes("/matches") ? { matches: [] } : /\/(report-card|schedule|next|conference)/.test(path) ? undefined : profile;
    return { data, error: undefined, loading: !!path && data === undefined, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), usePredictable: () => true, useTitle: () => {}, useCurrentSeason: () => 2025, useMeta: () => null }));
vi.mock("../lib/afterPaint", () => ({ useAfterFirstPaint: () => true }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useFlag: () => true }));
vi.mock("../lib/personal", () => ({
  usePersonal: () => ({ user: null, syncReady: false, state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [], settings: { notify: {} } }, update: () => {}, set: () => {} }),
  useTeamFlags: () => ({ ...flags, toggleTracked: () => {}, toggleBookmark: () => {}, setMine: () => {} }),
}));
vi.mock("../lib/yoursRow", () => ({ FOLLOWED_TEAM_PATH: "/my-teams", useYoursRow: () => ({ row: { kind: "followed" } }) }));
vi.mock("../lib/scouting", () => ({ useScouting: () => ({ entries: [], notes: {}, setNote: () => {}, ready: true }) }));
vi.mock("../components/ScoutConsensus", () => ({ TeamConsensusSection: () => null }));
vi.mock("../components/CommonsSection", () => ({ CommonsSection: () => null }));
vi.mock("recharts", async (orig) => ({ ...(await orig<typeof import("recharts")>()), ResponsiveContainer: ({ children }: { children: unknown }) => children }));

const { default: TeamPage } = await import("./TeamPage");
const { TooltipProvider } = await import("../components/ui/overlay");
const mount = () => render(<TooltipProvider><MemoryRouter initialEntries={["/teams/4215"]}><Routes><Route path="/teams/:number" element={<TeamPage />} /></Routes></MemoryRouter></TooltipProvider>);

const hero = () => document.querySelector<HTMLElement>("[data-team-hero]")!;
const folded = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const FOLDED = ["Reliability", "Prediction report card", "Schedule difficulty"];
/** The default (primary) Button variant's own fill. */
const primaries = (root: ParentNode) => [...root.querySelectorAll('[data-slot="button"]')].filter((b) => b.className.includes("bg-accent text-accent-ink"));
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(() => { cleanup(); document.documentElement.removeAttribute("data-v8"); Object.assign(flags, { isMine: false, tracked: false, bookmarked: false }); });

describe("team page, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("opens on identity, standing and what's next, then the matches", () => {
    mount();
    expect(document.querySelector("[data-team-v8]")).not.toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("4215");
    expect(h1.textContent).toContain("Hypnotic Robotics");
    expect(document.querySelector("[data-identity-line]")!.textContent).toBe("Oradell Public School · Oradell, NJ, USA · Rookie year 2010");
    const standing = document.querySelector("[data-standing]")!, next = document.querySelector("[data-whats-next]")!;
    const matches = screen.getByRole("heading", { name: /^Matches$/ });
    expect(follows(h1, standing) && follows(standing, next) && follows(next, matches)).toBe(true);
    // Matches come before events, strength, trends and the closed sections.
    for (const name of [/^Events \(1\)$/, /^Strength$/, /^Trends$/]) expect(follows(matches, screen.getByRole("heading", { name }))).toBe(true);
    expect(follows(matches, folded("Reliability"))).toBe(true);
  });

  it("keeps the percentile blue, glance values neutral, and record outcomes colored without duplicating OPR", () => {
    mount();
    const figure = document.querySelector("[data-hero-figure]")!;
    expect(figure.textContent).toMatch(/^Top \d+%$/);
    expect(figure.className).toContain("text-accent");
    const terms = [...document.querySelectorAll("[data-glance-stats] dt")];
    expect(terms.map((d) => d.textContent)).toEqual(["Rating", "Record", "Reliability"]);
    for (const dt of terms) {
      expect(dt.className).toContain("text-text-faint");
      expect((dt.nextElementSibling as HTMLElement).className).toContain("text-foreground");
    }
    const record = terms.find((d) => d.textContent === "Record")!.nextElementSibling!;
    expect(record.querySelector(".text-emerald-400")?.textContent).toBe("4");
    expect(record.querySelector(".text-red-400")?.textContent).toBe("1");
    expect(record.querySelector(".text-yellow-300")?.textContent).toBe("0");
    // The name stays white.
    expect(screen.getByRole("heading", { level: 1 }).querySelector(".text-text-base")!.textContent).toContain("Hypnotic Robotics");
    expect(document.querySelector("[data-opr-tiles]")).toBeNull();
    expect(document.querySelector("[data-hero-glow]")).toBeNull();
  });

  it("shows every action in one row under the standing: My team primary, the rest outlined or quiet, rare ones as links", () => {
    mount();
    const actions = document.querySelector<HTMLElement>("[data-hero-actions]")!;
    // Under the standing, in the left column beside What's next (not in the header).
    expect(hero().contains(actions)).toBe(false);
    expect(follows(document.querySelector("[data-standing]")!, actions)).toBe(true);
    expect(follows(actions, document.querySelector("[data-whats-next]")!)).toBe(true);
    expect(primaries(actions)).toHaveLength(1);
    expect(primaries(hero())).toHaveLength(0);
    expect(within(actions).getByRole("button", { name: /Mark as my team/ }).className).toContain("bg-accent text-accent-ink");
    for (const b of [within(actions).getByRole("button", { name: /^Track/ }), within(actions).getByRole("button", { name: /^Shortlist/ }), within(actions).getByRole("link", { name: /Compare/ }), within(actions).getByRole("link", { name: /Highlights/ })]) {
      expect(b.className).toContain("border-text-base/25");
    }
    expect(within(actions).getByRole("button", { name: /Share/ })).toBeTruthy();
    // Highlights is an action now, not a link on the Matches header.
    expect(document.querySelector("#matches [data-highlights-link]")).toBeNull();
    // The rare ones as quiet links under the row, as on classic; no More button left in the row.
    expect(within(actions).queryByRole("button", { name: "More actions" })).toBeNull();
    const links = document.querySelector<HTMLElement>("[data-hero-links]")!;
    expect(follows(actions, links)).toBe(true);
    expect(within(links).getByRole("link", { name: /Manage this team in Control Point/ })).toBeTruthy();
  });

  it("draws My team filled once it's set, with no primary left, and Tracking and Shortlisted pressed", () => {
    Object.assign(flags, { isMine: true, tracked: true, bookmarked: true });
    mount();
    const actions = document.querySelector<HTMLElement>("[data-hero-actions]")!;
    expect(primaries(actions)).toHaveLength(0);
    for (const name of [/^My team$/, /^Tracking$/, /^Shortlisted$/]) {
      const b = within(actions).getByRole("button", { name });
      expect(b.getAttribute("aria-pressed")).toBe("true");
      expect(b.className).toContain("bg-text-base/[0.1]");
    }
  });

  it("keeps Advancement odds beside Predict in What's next", () => {
    mount();
    const next = document.querySelector<HTMLElement>("[data-whats-next]")!;
    expect(within(next).getByRole("link", { name: /Predict a match with 4215/ })).toBeTruthy();
    // The next event is over (2025-11-01), so the glance links the season's advancement odds.
    expect(within(next).getByRole("link", { name: /Advancement odds/ })).toBeTruthy();
  });

  it("picks the season in the header above the standing, outside the action row", () => {
    mount();
    const actions = document.querySelector<HTMLElement>("[data-hero-actions]")!;
    const select = within(hero()).getByRole("combobox", { name: /Season 2025/ });
    expect(select.className).toContain("text-text-base");
    expect(select.className).toContain("border-white/30");
    expect(within(actions).queryByRole("combobox")).toBeNull();
    expect(follows(select, document.querySelector("[data-standing]")!)).toBe(true);
    expect(hero().querySelector("[data-eyebrow]")!.textContent).toBe("FTC team");
    expect(within(actions).queryAllByRole("radio")).toHaveLength(0);
  });

  it("shows each phase's OPR above the fold with its world rank and percentile, in its own colour", () => {
    mount();
    const quick = document.querySelector<HTMLElement>("[data-standing] [data-quick-stats]")!;
    const cells = [...quick.querySelectorAll<HTMLElement>("[data-quick-stat]")];
    expect(cells.map((c) => c.querySelector("dt")!.textContent)).toEqual(["NP OPR", "Auto OPR", "TeleOp OPR", "Endgame OPR"]);
    expect(cells[0].textContent).toContain("80");
    expect(cells[0].textContent).toContain("#600 · top 8%");
    const colours = ["#c4a7e7", "#7dd3fc", "#fdba74", "#86efac"];
    cells.forEach((c, i) => {
      expect(c.querySelector("dd")!.className).toContain(colours[i]);
      expect(c.querySelector("[data-bar]")).not.toBeNull();
    });
  });

  it("merges OPR and the rating into one Strength table, mint only on its bars, how it's computed behind a disclosure", () => {
    mount();
    const rows = [...document.querySelectorAll("[data-strength-row]")].map((r) => r.getAttribute("data-strength-row"));
    expect(rows).toEqual(["np", "auto", "teleop", "endgame", "rating"]);
    const bars = document.querySelectorAll("[data-strength] [data-bar]");
    expect(bars).toHaveLength(4);
    for (const b of bars) expect(b.className).toContain("bg-accent");
    expect(document.querySelector("[data-strength]")!.querySelectorAll("[class*='bg-info'], [class*='bg-success'], [class*='bg-violet']")).toHaveLength(0);
    // Each phase's OPR in its category colour (OPR purple, Auto blue, TeleOp orange, Endgame green).
    const val = (k: string) => document.querySelector("[data-strength-row=\"" + k + "\"] td:nth-child(2)")!.className;
    expect(val("np")).toContain("v8:text-violet-300");
    expect(val("auto")).toContain("v8:text-blue-300");
    expect(val("teleop")).toContain("v8:text-orange-300");
    expect(val("endgame")).toContain("v8:text-emerald-300");
    // The explanation stays closed until asked for.
    expect(document.querySelector("[data-strength-how]")?.textContent ?? "").not.toMatch(/least squares/);
    fireEvent.click(screen.getByRole("button", { name: /How it's computed/ }));
    expect(document.querySelector("[data-strength-how]")!.textContent).toMatch(/least squares/);
    // A phase opens its event-by-event numbers.
    const teleop = screen.getByRole("button", { name: /^TeleOp/ });
    fireEvent.click(teleop);
    expect(teleop.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-opr-breakdown]")).not.toBeNull();
  });

  it("draws each award's icon and name in gold, the event line grey", () => {
    mount();
    const name = document.querySelector<HTMLElement>("#awards [data-award-name]")!;
    expect(name.textContent).toBe("Inspire");
    expect(name.className).toContain("v8:text-[#fcd34d]");
    expect(name.previousElementSibling!.getAttribute("class")).toContain("v8:text-[#fcd34d]");
    expect(name.closest("a")!.lastElementChild!.className).toContain("text-muted-foreground");
  });

  it("leaves the hover lift off every row and card", () => {
    mount();
    expect(document.querySelectorAll(".lift")).toHaveLength(0);
  });

  it("keeps the folded sections closed, drawn as card headers: icon, title, quiet count, a faint colour wash", () => {
    mount();
    for (const name of FOLDED) {
      const b = folded(name);
      expect(b.getAttribute("aria-expanded")).toBe("false");
      // The wash from what's inside, at half the classic strength (3.5% on the card, not 7%).
      expect(b.style.backgroundImage).toContain("gradient");
      expect(b.style.backgroundImage).toContain(" 3.5%");
      expect(b.querySelectorAll("svg")).toHaveLength(2); // the icon before the title, and the chevron
    }
    expect(folded("Reliability").querySelector("[data-section-count]")!.textContent).toContain("32 matches");
  });
});

describe("team page, v8 off (unchanged)", () => {
  it("draws the classic header, OPR tiles and coloured section wash", () => {
    mount();
    expect(document.querySelector("[data-team-v8]")).toBeNull();
    expect(document.querySelector("[data-standing]")).toBeNull();
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0); // the season pills
    expect(screen.getByRole("button", { name: /Share/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Highlights/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Season Road Map \(1\)/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Show event by event$/ })).toHaveLength(4);
    expect(document.querySelectorAll(".lift").length).toBeGreaterThan(0);
    for (const name of FOLDED) {
      const b = folded(name);
      expect(b.style.backgroundImage).toContain("gradient");
      expect(b.querySelectorAll("svg")).toHaveLength(1); // the chevron only: no icon
      expect(b.querySelector("[data-section-count]")).toBeNull();
    }
  });
});
