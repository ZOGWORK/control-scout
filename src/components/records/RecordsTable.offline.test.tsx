// @vitest-environment jsdom
// Offline, a records table answers only its saved view. Another sort or a page past the saved ones says so, with
// one tap back to the saved view, never "Can't reach the server" and a Try again that can't work.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

const REFUSED = "Saved for offline: the first pages of this table as it opens. Filters and other sorts need a connection.";
// The saved answer: one row, so a test can see it's what the table shows.
const SAVED = vi.hoisted(() => ({ season: 2025, scope: "teamSeason", filter: null, sort: "totalPointsNpOpr", dir: "desc", page: 1, pageSize: 50, total: 1,
  columns: ["teamName", "totalPointsNpOpr"], rows: [{ season: 2025, team: 4215, stats: { teamName: "Saved Row Robotics", totalPointsNpOpr: 99.5 } }] }));
vi.mock("../../lib/api", async (orig) => {
  const real = await orig<typeof import("../../lib/api")>();
  return {
    ...real,
    useApi: (path: string | null) => {
      const records = !!path && /^\/api\/records\/\d+\/teams\?/.test(path);
      if (!records) return { data: undefined, error: undefined, loading: false, reload: () => {} };
      const sp = new URL(path!, "http://x").searchParams;
      // The saved view: the default sort in its default direction (recordsUrl always sends dir), page 1.
      const saved = (sp.get("sort") ?? "totalPointsNpOpr") === "totalPointsNpOpr" && (sp.get("dir") ?? "desc") === "desc" && Number(sp.get("page") ?? 1) === 1;
      if (saved) return { data: SAVED, error: undefined, loading: false, reload: () => {} };
      const error = Object.assign(new Error(REFUSED), { offline: true, status: 0 });
      return { data: undefined, error, loading: false, reload: () => {} };
    },
    apiFetch: () => new Promise(() => {}),
  };
});

let search = "";
function Probe() { search = useLocation().search; return null; }
const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><TooltipProvider>
    <RecordsTable scope="teamSeason" season={2025} predictable defaultCols={["totalPointsNpOpr"]} defaultSort="totalPointsNpOpr" storageKey="t" noun="teams" />
    <Probe />
  </TooltipProvider></MemoryRouter>,
);

class NoObserver { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  // The saved rows render a table (it measures itself).
  vi.stubGlobal("ResizeObserver", NoObserver);
  vi.stubGlobal("IntersectionObserver", NoObserver);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("records table offline, no filters", () => {
  it("another sort says it needs a connection and goes back to the saved view in one tap", () => {
    mount("/teams?view=season&season=2025&sort=autoPointsOpr");
    expect(screen.getByText("This view needs a connection")).toBeTruthy();
    expect(screen.getByText(REFUSED)).toBeTruthy();
    expect(screen.queryByText(/Can't reach the server/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back to the saved view/ }));
    expect(search).not.toContain("sort=");
    expect(screen.queryByText("This view needs a connection")).toBeNull();
    // The saved answer is what shows now.
    expect(screen.getAllByText("Saved Row Robotics").length).toBeGreaterThan(0);
  });
  it("a page past the saved ones says so too", () => {
    mount("/teams?view=season&season=2025&page=3");
    expect(screen.getByText("This view needs a connection")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to the saved view/ }));
    expect(search).not.toContain("page=");
    expect(screen.queryByText("This view needs a connection")).toBeNull();
    expect(screen.getAllByText("Saved Row Robotics").length).toBeGreaterThan(0);
  });
  it("the saved view itself (dir=desc, as recordsUrl sends it) shows its rows", () => {
    mount("/teams?view=season&season=2025");
    expect(screen.queryByText("This view needs a connection")).toBeNull();
    expect(screen.getAllByText("Saved Row Robotics").length).toBeGreaterThan(0);
  });
});
