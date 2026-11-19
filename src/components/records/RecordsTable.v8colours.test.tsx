// @vitest-environment jsdom
// v8's stat-category colours in a records table (Sushil, 11-19: one colour means one category, everywhere):
// np OPR purple, Auto blue, DC orange, Endgame green, Penalties red, on the column head and its numbers, and the
// preset chips' dots in their category's colour. Ranks and counts stay white. Every class is a v8: one.
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const COLS = ["totalPointsNpOpr", "autoPointsOpr", "dcPointsOpr", "endgamePointsOpr", "penaltyPointsCommittedOpr"];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => ({
    data: path && /^\/api\/records\/\d+\/teams\?/.test(path)
      ? { rows: [{ team: 1111, season: 2025, stats: { teamName: "One", totalPointsNpOpr: 120, autoPointsOpr: 30, dcPointsOpr: 80, endgamePointsOpr: 10, penaltyPointsCommittedOpr: 2 } }], total: 1, page: 1, pageSize: 50 }
      : undefined,
    error: undefined, loading: false, reload: () => {},
  }),
  apiFetch: () => new Promise(() => {}),
}));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const mount = () => render(
  <MemoryRouter initialEntries={["/teams?season=2025"]}><TooltipProvider>
    <RecordsTable scope="teamSeason" season={2025} predictable defaultCols={COLS} defaultSort="totalPointsNpOpr" storageKey="v8c" noun="teams" controls={{ onSeason: () => {} }} />
  </TooltipProvider></MemoryRouter>,
);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute("data-v8", "");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-v8"); });

describe("records table, v8 category colours", () => {
  const want: Record<string, string> = {
    totalPointsNpOpr: "v8:text-violet-300", autoPointsOpr: "v8:text-blue-300", dcPointsOpr: "v8:text-orange-300",
    endgamePointsOpr: "v8:text-emerald-300", penaltyPointsCommittedOpr: "v8:text-red-300",
  };
  it("colours each scoring category's head and numbers, each in its own colour", () => {
    mount();
    const heads = [...document.querySelectorAll("thead th")];
    const idx = (k: string) => COLS.indexOf(k) + 1; // after the Team column
    const body = document.querySelector("tbody tr")!;
    for (const [k, cls] of Object.entries(want)) {
      expect(heads[idx(k)].innerHTML).toContain(cls);
      expect(body.children[idx(k)].className).toContain(cls);
    }
  });
  it("shows each preset chip's dot in its category colour", () => {
    mount();
    const dot = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label)?.querySelector("span.rounded-full")?.className ?? "";
    expect(dot("Elite OPR")).toContain("v8:bg-violet-300");
    expect(dot("Auto specialists")).toContain("v8:bg-blue-300");
    expect(dot("Strong endgame")).toContain("v8:bg-emerald-300");
    expect(dot("Clean drivers")).toContain("v8:bg-red-300");
  });
});

describe("v8CategoryOf", () => {
  it("colours a scoring category's stats only; stats that share a tone by key alone stay white", async () => {
    const { v8CategoryOf } = await import("../../lib/records/describe");
    const { STAT_BY_KEY } = await import("../../shared/statCatalog");
    expect(v8CategoryOf(STAT_BY_KEY.get("totalPointsNpOpr"))).toBe("v8:text-violet-300");
    expect(v8CategoryOf(STAT_BY_KEY.get("autoPointsOpr"))).toBe("v8:text-blue-300");
    for (const k of ["winningMargin", "highScore", "combinedScore", "rank", "qualMatchesPlayed"]) expect(v8CategoryOf(STAT_BY_KEY.get(k))).toBeUndefined();
  });
});
