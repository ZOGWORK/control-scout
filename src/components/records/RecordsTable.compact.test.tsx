// @vitest-environment jsdom
// A records table on a phone (/teams, /matches under 768px): the season, a chip per filter that's on and a
// Filters button in one row; every control in the sheet. A chip takes its filter out of the URL; the sheet's
// "Edit conditions" and "Saved filters" close it and open the filter builder on the right side.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => {
    const records = !!path && /^\/api\/records\/\d+\/teams\?/.test(path);
    const regions = path === "/api/records/2025/regions";
    return {
      data: records ? { rows: [], total: 120, page: 1, pageSize: 50 } : regions ? { regions: [{ code: "USTX", country: "USA", state: "TX" }] } : undefined,
      error: undefined, loading: false, reload: () => {},
    };
  },
  apiFetch: () => new Promise(() => {}),
}));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

let search = "";
function Probe() { search = useLocation().search; return null; }

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const mount = (url: string, scope: "teamSeason" | "teamEvent" = "teamSeason") => render(
  <MemoryRouter initialEntries={[url]}><TooltipProvider>
    <RecordsTable scope={scope} season={2025} predictable defaultCols={["totalPointsNpOpr"]} defaultSort="totalPointsNpOpr" storageKey="t" noun="teams"
      controls={{ onSeason: () => {}, region: true, eventType: true, dates: true }} selectable />
    <Probe />
  </TooltipProvider></MemoryRouter>,
);
const q = () => new URLSearchParams(search);
const phone = (on: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({ matches: on, media: query, addEventListener() {}, removeEventListener() {} }));
const filtersButton = () => screen.getByRole("button", { name: /^Filters/, hidden: true });

beforeEach(() => { localStorage.clear(); phone(true); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("records table on a phone", () => {
  it("folds the controls into one row: season, a chip per filter, Filters; count and sort stay in view", () => {
    mount("/teams?season=2025&country=US&region=USTX&type=Qualifier&from=2025-10-01&to=2025-11-01", "teamEvent");
    const chips = screen.getByRole("list", { name: "Filters on" });
    const names = [...chips.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Remove filter: Region: Texas",
      "Remove filter: Teams from United States",
      "Remove filter: Event type: Qualifier",
      expect.stringMatching(/^Remove filter: Dates: /),
    ]);
    expect(filtersButton().getAttribute("aria-label")).toBe("Filters, 4 on");
    expect(screen.getByRole("combobox", { name: "Season" })).toBeTruthy();
    // The inline controls and the toolbar aren't on the page; the count and the sort are.
    expect(screen.queryByRole("button", { name: /^Region:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Date range:/ })).toBeNull();
    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText(/Sorted by/)).toBeTruthy();
  });

  it("removing a chip takes only that filter out of the URL", () => {
    mount("/teams?view=season&season=2025&country=US&region=USTX&page=3");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Region: Texas" }));
    expect(q().get("region")).toBeNull();
    expect(q().get("country")).toBe("US");
    expect(q().get("view")).toBe("season");
    expect(q().get("page")).toBeNull(); // back to the first page
  });

  it("a stat filter shows as one chip in words, and removing it clears the filter", () => {
    mount("/teams?view=season&season=2025&filter=and-totalPointsOpr.gte.55-");
    const chip = screen.getByRole("button", { name: /^Remove filter: .*55/ });
    fireEvent.click(chip);
    expect(q().get("filter")).toBeNull();
  });

  it("the sheet holds every control: region, type, dates, quick filters, conditions, saved filters, columns, export", async () => {
    mount("/teams?view=season&season=2025");
    fireEvent.click(filtersButton());
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    for (const name of [/^Region:/, /^Date range:/, /Add a condition/, /Saved filters/, /Statistics/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("combobox", { name: "Event type" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Quick filters" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Export CSV/ })).toBeTruthy();
    expect(dialog.textContent).toContain("120");
    expect(screen.getByRole("button", { name: "Show 120 teams" })).toBeTruthy();
  });

  it("Edit conditions closes the sheet and opens the filter builder", async () => {
    mount("/teams?view=season&season=2025");
    fireEvent.click(filtersButton());
    fireEvent.click(await screen.findByRole("button", { name: /Add a condition/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("tab", { name: /Build/, selected: true })).toBeTruthy());
  });

  it("Saved filters opens the builder on the saved filters", async () => {
    mount("/teams?view=season&season=2025");
    fireEvent.click(filtersButton());
    fireEvent.click(await screen.findByRole("button", { name: /Saved filters/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Saved filters/, selected: true })).toBeTruthy());
    expect(screen.getByText("No saved filters yet.")).toBeTruthy();
  });

  it("asking for the other side while the builder is open turns it there", async () => {
    mount("/teams?view=season&season=2025");
    fireEvent.click(filtersButton());
    fireEvent.click(await screen.findByRole("button", { name: /Saved filters/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Saved filters/, selected: true })).toBeTruthy());
    // The builder panel stays open (it isn't modal); the sheet opens again over it.
    fireEvent.click(filtersButton());
    fireEvent.click(await screen.findByRole("button", { name: /Add a condition/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("tab", { name: /Build/, selected: true, hidden: true })).toBeTruthy());
    fireEvent.click(filtersButton());
    fireEvent.click(await screen.findByRole("button", { name: /Saved filters/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Saved filters/, selected: true, hidden: true })).toBeTruthy());
  });

  it("wider screens keep the inline controls and toolbar", () => {
    phone(false);
    mount("/teams?view=season&season=2025&region=USTX");
    expect(screen.queryByRole("list", { name: "Filters on" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Region:/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Filters/ })).toBeTruthy();
  });
});
