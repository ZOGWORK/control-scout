// @vitest-environment jsdom
// Offline, a records table answers only its saved view. Another sort or a page past the saved ones says so, with
// one tap back to the saved view, never "Can't reach the server" and a Try again that can't work.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

const REFUSED = "Saved for offline: the first pages of this table as it opens. Filters and other sorts need a connection.";
vi.mock("../../lib/api", async (orig) => {
  const real = await orig<typeof import("../../lib/api")>();
  return {
    ...real,
    useApi: (path: string | null) => {
      const records = !!path && /^\/api\/records\/\d+\/teams\?/.test(path);
      if (!records) return { data: undefined, error: undefined, loading: false, reload: () => {} };
      const sp = new URL(path!, "http://x").searchParams;
      const saved = (sp.get("sort") ?? "totalPointsNpOpr") === "totalPointsNpOpr" && !sp.get("dir") && Number(sp.get("page") ?? 1) === 1;
      if (saved) return { data: { rows: [], total: 0, page: 1, pageSize: 50 }, error: undefined, loading: false, reload: () => {} };
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

beforeEach(() => { vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })); });
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
  });
  it("a page past the saved ones says so too", () => {
    mount("/teams?view=season&season=2025&page=3");
    expect(screen.getByText("This view needs a connection")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to the saved view/ }));
    expect(search).not.toContain("page=");
  });
});
