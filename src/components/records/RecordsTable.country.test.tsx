// @vitest-environment jsdom
// ?country= on a team records table (PUB-F05): a known country filters and pages as before; an unknown one
// (country=ZZ) is shown as a problem with a way out, and never fetches the every-country table under an
// address that looks filtered. Back/forward bring each state back.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

const asked: (string | null)[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => {
    // The table's own request (the region picker asks for /api/records/:season/regions).
    const records = !!path && /^\/api\/records\/\d+\/teams\?/.test(path);
    if (path == null || records) asked.push(path);
    return { data: records ? { rows: [], total: 120, page: Number(new URL(path!, "http://x").searchParams.get("page")), pageSize: 50 } : undefined, error: undefined, loading: false, reload: () => {} };
  },
  apiFetch: () => new Promise(() => {}),
}));

let search = "";
let nav: NavigateFunction;
function Probe() { search = useLocation().search; nav = useNavigate(); return null; }

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><TooltipProvider>
    <RecordsTable scope="teamSeason" season={2025} predictable defaultCols={["totalPointsNpOpr"]} defaultSort="totalPointsNpOpr" storageKey="t" noun="teams" controls={{ region: true }} />
    <Probe />
  </TooltipProvider></MemoryRouter>,
);
const lastAsked = () => asked.at(-1) ?? null;
const param = (k: string) => new URL(lastAsked()!, "http://x").searchParams.get(k);

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("records table ?country=", () => {
  it("shows an unknown country as a problem and fetches nothing", () => {
    mount("/teams?view=season&country=ZZ&season=2025");
    expect(screen.getByRole("alert").textContent).toContain("Unknown country ZZ");
    expect(asked.every((p) => p === null)).toBe(true);
    expect(search).toContain("country=ZZ");
  });

  it("clears it with one button, keeping the rest of the address", () => {
    mount("/teams?view=season&country=ZZ&season=2025");
    fireEvent.click(screen.getByRole("button", { name: /Show every country/ }));
    expect(search).toBe("?view=season&season=2025");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(param("country")).toBeNull();
  });

  it("keeps a known country through paging, and back/forward restore each state", () => {
    mount("/teams?view=season&country=ZZ&season=2025");
    act(() => nav("/teams?view=season&country=us&season=2025"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(param("country")).toBe("US");
    expect(screen.getByRole("button", { name: /Teams from United States: show every country/ })).toBeTruthy();
    act(() => nav("/teams?view=season&country=US&season=2025&page=2"));
    expect(param("country")).toBe("US");
    expect(param("page")).toBe("2");
    act(() => nav(-2));
    expect(screen.getByRole("alert").textContent).toContain("Unknown country ZZ");
    expect(lastAsked()).toBeNull();
    act(() => nav(1));
    expect(param("country")).toBe("US");
  });
});
