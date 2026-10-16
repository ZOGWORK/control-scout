// @vitest-environment jsdom
// The Scout feed's search and filters (Task 17): the URL drives the feed (team, event, author, match,
// kind, q, sort), the search box and the chips write it, the count, the "No entries match" state and its
// Clear filters, Export CSV carrying the same filters, and Personal without the author filter.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { saveScoutEntry } from "../lib/scouting";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TooltipProvider } from "../components/ui/overlay";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: false, state: { videoLinks: {} } },
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

const gear = { id: "901", name: "Gearheads", role: "member" as const };
const signedIn = (): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: [gear] },
});

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ScoutPage /><Where /></MemoryRouter></TooltipProvider>);
const params = () => new URLSearchParams(where.split("?")[1]);
/** The feed's cards, by team number (each card starts with its team). */
const feed = () => screen.queryAllByRole("listitem").map((li) => /^\d+/.exec(li.textContent ?? "")![0]);
const count = () => screen.getByTestId("entry-count").textContent;
const exportHref = () => new URL(screen.getByRole("link", { name: /CSV/ }).getAttribute("href")!, "http://x");

const base = { season: 2025, eventCode: "USCAQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };
function seed() {
  const ws = { workspaceId: "901" };
  saveScoutEntry({ uuid: "ws0000000001", ...base, ...ws, team: 111, matchLabel: "Q10", notes: "Fast INTAKE", authorAccountId: 9001, authorDisplayName: "Ada" });
  saveScoutEntry({ uuid: "ws0000000002", ...base, ...ws, team: 222, matchLabel: "Q2", notes: "slow", authorAccountId: 42, authorDisplayName: "Marcus" });
  saveScoutEntry({ uuid: "ws0000000003", ...base, ...ws, team: 333, eventCode: "USTXCMP", kind: "pit", matchLabel: null, data: { drivetrain: "Swerve" }, authorAccountId: 42, authorDisplayName: "Marcus" });
  // Made on this device, not synced yet: no author stamped. It's Ada's.
  saveScoutEntry({ uuid: "ws0000000004", ...base, ...ws, team: 444, matchLabel: "F1", notes: "great auto" });
  saveScoutEntry({ uuid: "personal0001", ...base, team: 555, notes: "personal fast" });
  saveScoutEntry({ uuid: "personal0002", ...base, team: 666, kind: "pit", matchLabel: null });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  h.personal = { user: signedIn(), providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {} } };
  resetFlags({ ...DEFAULT_FLAGS });
  seed();
  localStorage.setItem("cs-scout-tpl:901:2025", JSON.stringify({ workspaceId: "901", season: 2025, version: 0, settingsVersion: 0, match: null, pit: null, updatedAt: null, updatedBy: null }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

describe("Scout feed filters (workspace)", () => {
  it("no filters: every entry, and the count", () => {
    show("/scout?season=2025&space=901");
    expect(feed().sort()).toEqual(["111", "222", "333", "444"]);
    expect(count()).toBe("4 entries");
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("each filter from the URL alone", () => {
    const cases: [string, string[]][] = [
      ["team=111", ["111"]], ["event=ustxcmp", ["333"]], ["author=42", ["222", "333"]], ["author=9001", ["111", "444"]],
      ["match=q2", ["222"]], ["kind=pit", ["333"]], ["q=intake", ["111"]], ["q=SWERVE", ["333"]],
    ];
    for (const [q, want] of cases) {
      show(`/scout?season=2025&space=901&${q}`);
      expect(feed().sort(), q).toEqual(want);
      expect(count(), q).toBe(`${want.length} of 4 entries`);
      cleanup();
    }
  });

  it("filters combine", () => {
    show("/scout?season=2025&space=901&author=42&kind=match");
    expect(feed()).toEqual(["222"]);
    cleanup();
    show("/scout?season=2025&space=901&team=111,222&q=slow");
    expect(feed()).toEqual(["222"]);
  });

  it("sorts: by team, and by match in playing order (Q2 before Q10, finals after quals, pit last)", () => {
    show("/scout?season=2025&space=901&sort=team");
    expect(feed()).toEqual(["111", "222", "333", "444"]);
    cleanup();
    show("/scout?season=2025&space=901&sort=match");
    // USCAQ1: Q2, Q10, F1; then USTXCMP's pit entry.
    expect(feed()).toEqual(["222", "111", "444", "333"]);
  });

  it("the search box writes q to the URL (keeping the space and season) and filters as you type", async () => {
    show("/scout?season=2025&space=901");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search entries" }), { target: { value: "Great" } });
    await waitFor(() => expect(params().get("q")).toBe("Great"));
    expect(params().get("space")).toBe("901");
    expect(params().get("season")).toBe("2025");
    expect(feed()).toEqual(["444"]);
  });

  it("kind picks write the URL", async () => {
    show("/scout?season=2025&space=901");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Filter by kind" })).getByRole("radio", { name: "Pit" }));
    await waitFor(() => expect(params().get("kind")).toBe("pit"));
    expect(feed()).toEqual(["333"]);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Filter by kind" })).getByRole("radio", { name: "All" }));
    await waitFor(() => expect(params().has("kind")).toBe(false));
  });

  it("a chip removes its filter", async () => {
    show("/scout?season=2025&space=901&team=111&kind=match");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Team 111" }));
    await waitFor(() => expect(params().has("team")).toBe(false));
    expect(params().get("kind")).toBe("match");
    expect(feed().sort()).toEqual(["111", "222", "444"]);
  });

  it("nothing matches: says so, and Clear filters brings everything back (the space and season stay)", async () => {
    show("/scout?season=2025&space=901&team=222&kind=pit&sort=team");
    expect(screen.getByText("No entries match")).toBeTruthy();
    expect(count()).toBe("0 of 4 entries");
    const clears = screen.getAllByRole("button", { name: "Clear filters" });
    fireEvent.click(clears[clears.length - 1]);
    await waitFor(() => expect(feed().sort()).toEqual(["111", "222", "333", "444"]));
    expect([...params().keys()].sort()).toEqual(["season", "sort", "space"]);
  });

  it("Export CSV carries the feed's filters", () => {
    show("/scout?season=2025&space=901&team=111&event=USCAQ1&author=9001&match=Q10&kind=match&q=fast&sort=match&view=x");
    const url = exportHref();
    expect(url.pathname).toBe("/api/scout/workspaces/901/export.csv");
    expect(Object.fromEntries(url.searchParams)).toEqual({ season: "2025", team: "111", event: "USCAQ1", kind: "match", author: "9001", match: "Q10", q: "fast" });
    expect(screen.getByRole("link", { name: /CSV/ }).getAttribute("aria-label")).toBe("Export the 1 filtered 2025 entries as CSV");
  });

  it("a filter the export would refuse is dropped from the URL, so the feed and the export agree", async () => {
    show("/scout?season=2025&space=901&team=abc&kind=match");
    await waitFor(() => expect(params().has("team")).toBe(false));
    expect(params().get("kind")).toBe("match");
    expect(exportHref().searchParams.has("team")).toBe(false);
  });

  it("a team filter alone doesn't open the form; Scout this team (new=1) does, with the team", () => {
    show("/scout?season=2025&space=901&team=111");
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    cleanup();
    show("/scout?season=2025&space=901&team=111&new=1");
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
    expect((screen.getByLabelText("Team") as HTMLInputElement).value).toBe("111");
  });
});

describe("Scout feed filters (Personal)", () => {
  it("the same filters minus author: an author in the URL is ignored there", () => {
    show("/scout?season=2025&space=personal&author=42&q=fast");
    expect(feed()).toEqual(["555"]);
    expect(screen.queryByRole("combobox", { name: "Filter by author" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Filter by team" })).toBeTruthy();
    expect(count()).toBe("1 of 2 entries");
  });
});
