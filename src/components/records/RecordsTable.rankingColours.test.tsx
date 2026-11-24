// @vitest-environment jsdom
// The event Rankings tab's colours (owner, 11-23): rank, RS and TBP shade green (best) → red (worst) by value, wins
// green, losses red, ties neutral, and no purple: no stat-category colour on np OPR and no slate team numbers.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const COLS = ["rank", "rp", "tb1", "wins", "losses", "ties", "totalPointsNpOpr"];
const row = (team: number, rank: number, rp: number, tb1: number, w: number, l: number, opr: number) =>
  ({ team, season: 2025, eventCode: "X", stats: { teamName: `T${team}`, rank, rp, tb1, wins: w, losses: l, ties: 0, totalPointsNpOpr: opr } });
const ROWS = [row(1, 1, 6, 208, 5, 0, 180), row(2, 2, 3.6, 91, 4, 1, 40), row(3, 3, 3, 79, 3, 2, 23), row(4, 4, 2, 55, 2, 3, 30), row(5, 5, 0.4, 35, 0, 5, 9)];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => ({
    data: path && /^\/api\/records\/\d+\/teamEvent/.test(path) ? { rows: ROWS, total: ROWS.length, page: 1, pageSize: 50 } : path ? { rows: ROWS, total: ROWS.length, page: 1, pageSize: 50 } : undefined,
    error: undefined, loading: false, reload: () => {},
  }),
  apiFetch: () => new Promise(() => {}),
}));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const { shadeColour } = await import("../../lib/rankShade");
const mount = (rankingColours: boolean) => render(
  <MemoryRouter initialEntries={["/events/2025/X"]}><TooltipProvider>
    <RecordsTable scope="teamEvent" season={2025} code="X" predictable defaultCols={COLS} defaultSort="rank" storageKey={`rc${rankingColours}`} noun="teams" rankingColours={rankingColours} />
  </TooltipProvider></MemoryRouter>,
);
const cell = (r: number, k: string) => document.querySelectorAll("tbody tr")[r].children[COLS.indexOf(k) + 1] as HTMLElement;
// jsdom drops color-mix() it can't parse from element.style, so read React's style through the attribute it wrote.
const colour = (el: HTMLElement) => el.style.color || /color:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1]?.trim() || "";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute("data-v8", "");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

describe("event rankings colours", () => {
  it("shades rank, RS and TBP from green (best) to red (worst)", () => {
    mount(true);
    for (const k of ["rank", "rp", "tb1"]) {
      expect(cell(0, k).hasAttribute("data-shade"), k).toBe(true);
      expect(colour(cell(0, k)).replace(/\s+/g, " "), k).toContain("100%");
      expect(colour(cell(4, k)).replace(/\s+/g, " "), k).toContain(" 0%");
    }
    expect(colour(cell(0, "rank")).replace(/\s+/g, " ")).toBe(shadeColour(1));
  });
  it("tones wins green, losses red, ties neutral", () => {
    mount(true);
    expect(cell(0, "wins").className).toContain("text-success");
    expect(cell(0, "losses").className).toContain("text-danger");
    expect(cell(0, "ties").className).toContain("text-text-muted");
  });
  it("drops the purple: np OPR in the body colour, team numbers not slate", () => {
    mount(true);
    expect(cell(0, "totalPointsNpOpr").className).not.toContain("violet");
    expect(document.querySelector("thead")!.innerHTML).not.toContain("violet");
    expect(document.querySelector("tbody .font-mono")!.className).not.toContain("v8:text-accent");
  });
  it("keeps phone team numbers plain too (the tap-for-name button)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {} }));
    mount(true);
    const btn = document.querySelector("tbody button[aria-label^='1 ']") as HTMLElement | null;
    expect(btn, "phone layout renders the team number as a button").not.toBeNull();
    expect(btn!.className).not.toContain("v8:text-accent");
  });
  it("leaves other event tables (Insights) as they were", () => {
    mount(false);
    expect(cell(0, "rank").hasAttribute("data-shade")).toBe(false);
    expect(cell(0, "totalPointsNpOpr").className).toContain("v8:text-violet-300");
  });
});
