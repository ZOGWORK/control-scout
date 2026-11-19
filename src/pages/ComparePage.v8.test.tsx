// @vitest-environment jsdom
// Compare in v8 (docs/design/v8-revamp-brief.md, <html data-v8>), rebuilt around "which of these teams is better, and
// at what?": the answer first, each team's count of stats led and which ones, the team ahead on most in the accent;
// then the table, the winner of each row in white on a faint fill and the rest grey, drawn without Motion.
// With v8 off the page is drawn as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CompareTeam, CompareView } from "../shared/api";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null, bookmarks: [], tracked: { teams: [], events: [] }, videoLinks: {} }, syncReady: false }) }));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, useTitle: () => {}, usePredictable: () => true }));

const { default: ComparePage, verdict } = await import("./ComparePage");
const { TooltipProvider } = await import("../components/ui/overlay");

const stat = (value: number) => ({ value, rank: 10, of: 100 });
const team = (n: number, opr: number, wins: number): CompareTeam => ({
  team: { number: n, name: `Team ${n} name` } as CompareTeam["team"],
  stats: { opr: { np: stat(opr), auto: stat(10), teleop: stat(opr - 20), endgame: stat(10), pen: -3 }, rating: null, record: { wins, losses: 2, ties: 0, matches: wins + 2, events: 2 }, avg: { np: 1, score: 1, pen: 1 } },
  events: [], awards: [],
});
const teams = [team(4215, 100, 8), team(6980, 90, 9)];
const view = (): CompareView => ({ season: 2025, teams, meetings: [] });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", async (path: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path.startsWith("/api/compare")) return json(view());
    return json({ hits: [] });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

const page = (url = "/compare?teams=4215,6980") => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ComparePage /></MemoryRouter></TooltipProvider>);
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("verdict", () => {
  it("counts the rows each team leads (ties lead for both), over the rows that have a leader", () => {
    const v = verdict(teams);
    expect(v.rows).toBe(6);
    expect(v.teams).toEqual([
      { team: 4215, leads: ["OPR", "Auto", "TeleOp", "Endgame", "Avg score"] },
      { team: 6980, leads: ["Auto", "Endgame", "Record", "Avg score"] },
    ]);
  });
});

describe("Compare, v8 on", () => {
  beforeEach(() => { document.documentElement.setAttribute("data-v8", ""); });

  it("puts the answer first: who's ahead, then the table", async () => {
    page();
    const card = await waitFor(() => { const e = document.querySelector("[data-verdict]"); if (!e) throw new Error("not yet"); return e; });
    expect(document.querySelector("[data-compare-v8]")).not.toBeNull();
    expect(card.querySelector("[data-verdict-line]")!.textContent).toBe("4215 leads on 5 of 6 stats.");
    const counts = [...card.querySelectorAll("[data-verdict-count]")];
    expect(counts.map((c) => c.textContent)).toEqual(["5", "4"]);
    expect(counts[0].className).toContain("text-accent");
    expect(counts[1].className).not.toContain("text-accent");
    expect(follows(card, document.querySelector("[data-stats-table]")!)).toBe(true);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-[1.375rem]");
  });

  it("marks each row's winner in white and greys the rest", async () => {
    page();
    await waitFor(() => expect(document.querySelector("[data-stats-table] tbody")).not.toBeNull());
    const opr = screen.getByRole("rowheader", { name: "OPR" }).parentElement!;
    const [a, b] = [...opr.querySelectorAll("td")];
    expect(a.hasAttribute("data-lead")).toBe(true);
    expect(a.querySelector("span")!.className).toContain("v8:text-text-base");
    expect(b.hasAttribute("data-lead")).toBe(false);
    expect(b.querySelector("span")!.className).toContain("v8:text-text-muted");
  });
});

describe("Compare, v8 off", () => {
  it("is drawn as before: no verdict", async () => {
    page();
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "OPR" })).toBeTruthy());
    expect(document.querySelector("[data-verdict]")).toBeNull();
    expect(document.querySelector("[data-compare-v8]")).toBeNull();
  });
});
