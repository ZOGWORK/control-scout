// @vitest-environment jsdom
// The Data hub's groups follow the space and role (Personal, member, admin, read-only), each card says one live
// fact or, empty, what to do, and Export CSV is the same download link the page builds today.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DataHub, dataHubExportUrl, dataHubLayout, pitTeams, type DataHubProps } from "./DataHub";

const recs = vi.hoisted(() => ({ count: vi.fn(async () => 4), list: vi.fn() }));
vi.mock("../../../lib/recordings", () => ({ CHANGED: "cs-recordings-changed", countRecordings: recs.count, listRecordings: recs.list }));
import { workspaceExportUrl } from "../../../shared/scoutExport";

afterEach(cleanup);
const WS = { id: "w1", name: "Riverside" };
const base: Omit<DataHubProps, "onOpen"> = { workspace: null, season: 2025, entryCount: 3, recordingCount: 2 };
const groups = (p: Partial<DataHubProps>) => {
  const l = dataHubLayout({ ...base, ...p });
  return { yours: l.yours.map((c) => c.key), planning: l.planning.map((c) => c.key), manage: l.manage.map((a) => a.key) };
};
const card = (key: string) => document.querySelector(`[data-card=${key}]`) as HTMLElement;

describe("Data hub groups", () => {
  it("Personal: your data only (entries, pit scouting, recordings), nothing to plan or manage", () => {
    expect(groups({})).toEqual({ yours: ["entries", "pit", "recordings"], planning: [], manage: [] });
    render(<DataHub {...base} onOpen={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Team planning" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Manage" })).toBeNull();
  });
  it("a member: team planning, and activity and export under Manage", () => {
    expect(groups({ workspace: WS })).toEqual({ yours: ["entries", "pit", "recordings"], planning: ["picklist", "assignments", "alliance"], manage: ["activity", "export"] });
  });
  it("an admin: the template too; scouting alliance goes when the owner switches it off", () => {
    expect(groups({ workspace: WS, alliances: false }).planning).not.toContain("alliance");
    expect(groups({ workspace: WS, isAdmin: true }).manage).toEqual(["activity", "template", "export"]);
  });
  it("a read-only workspace keeps what reads and exports, marks it, and drops the template even for an admin", () => {
    expect(groups({ workspace: WS, isAdmin: true, readOnly: true }).manage).toEqual(["activity", "export"]);
    const l = dataHubLayout({ ...base, workspace: WS, readOnly: true });
    expect(l.yours.find((c) => c.key === "entries")!.note).toBe("Read-only");
    expect(l.planning.find((c) => c.key === "picklist")!.note).toBe("Read-only");
  });
  it("entries and pick list are the featured cards, first in their group", () => {
    const l = dataHubLayout({ ...base, workspace: WS });
    expect(l.yours[0]).toMatchObject({ key: "entries", featured: true });
    expect(l.planning[0]).toMatchObject({ key: "picklist", featured: true });
  });
});

describe("Data hub facts", () => {
  it("entries, assignments open for you, pit progress and recordings", () => {
    render(<DataHub {...base} workspace={WS} entryCount={84} openForYou={2} pit={{ done: 18, total: 24 }} recordingCount={3} eventCode="USNJQ1" onOpen={vi.fn()} />);
    expect(card("entries").textContent).toContain("84 entries in 2025–26");
    expect(card("assignments").textContent).toContain("2 assignments open for you");
    expect(card("assignments").querySelector("[data-slot=badge]")?.textContent).toBe("2");
    expect(card("pit").textContent).toContain("18 of 24 teams done at USNJQ1");
    expect(card("recordings").textContent).toContain("3 videos on this device");
  });
  it("singulars; nothing open shows no badge; pit falls back to the robots written up", () => {
    render(<DataHub {...base} workspace={WS} entryCount={1} openForYou={0} pitCount={1} recordingCount={1} onOpen={vi.fn()} />);
    expect(card("entries").textContent).toContain("1 entry in 2025–26");
    expect(card("assignments").textContent).toContain("Nothing open for you");
    expect(card("assignments").querySelector("[data-slot=badge]")).toBeNull();
    expect(card("pit").textContent).toContain("1 robot written up");
    expect(card("recordings").textContent).toContain("1 video on this device");
  });
  it("empty cards say what to do, not 0, and the empty Entries card starts scouting", () => {
    const onStart = vi.fn(), onOpen = vi.fn();
    render(<DataHub {...base} entryCount={0} pitCount={0} recordingCount={0} onOpen={onOpen} onStartScouting={onStart} />);
    for (const k of ["entries", "pit", "recordings"]) {
      expect(card(k).textContent).not.toMatch(/\b0\b/);
      expect(card(k).textContent).toMatch(/yet/);
    }
    fireEvent.click(within(card("entries")).getByRole("button", { name: "Start scouting" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("a read-only space with no entries offers no Start scouting", () => {
    render(<DataHub {...base} workspace={WS} readOnly entryCount={0} onOpen={vi.fn()} onStartScouting={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Start scouting" })).toBeNull();
    expect(card("entries").textContent).toContain("No entries in 2025–26");
  });
});

describe("Data hub counting", () => {
  it("pit teams: a robot written up twice counts once; match entries don't count", () => {
    expect(pitTeams([{ kind: "pit", team: 1 }, { kind: "pit", team: 1 }, { kind: "pit", team: 2 }, { kind: "match", team: 3 }])).toBe(2);
  });
  it("recordings are counted on the device without reading them, and recounted when they change", async () => {
    render(<DataHub {...base} recordingCount={undefined} onOpen={vi.fn()} />);
    expect(await screen.findByText("4 videos on this device")).toBeTruthy();
    expect(recs.list).not.toHaveBeenCalled();
    recs.count.mockResolvedValueOnce(5);
    window.dispatchEvent(new Event("cs-recordings-changed"));
    expect(await screen.findByText("5 videos on this device")).toBeTruthy();
  });
});

describe("Data hub actions", () => {
  it("each card and Manage button opens its view", () => {
    const onOpen = vi.fn();
    render(<DataHub {...base} workspace={WS} isAdmin onOpen={onOpen} />);
    for (const [name, view] of [["Entries", "entries"], ["Pick list", "picklist"], ["Activity", "activity"], ["Assignments", "assignments"], ["Scouting alliance", "alliance"], ["Pit scouting", "pit"], ["Match recordings", "recordings"], ["Template", "template"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
      expect(onOpen).toHaveBeenLastCalledWith(view);
    }
  });
  it("Export CSV is a download link carrying the page's filters and the season, as the page builds it", () => {
    const sp = new URLSearchParams("team=21010&view=data&tab=data&q=fast");
    render(<DataHub {...base} workspace={WS} filters={sp} filteredCount={4} onOpen={vi.fn()} />);
    const link = screen.getByRole("link", { name: /Export CSV/ });
    expect(link.hasAttribute("download")).toBe(true);
    const page = new URLSearchParams(sp); page.set("season", "2025");
    expect(link.getAttribute("href")).toBe(workspaceExportUrl("w1", page));
    expect(link.getAttribute("href")).toBe("/api/scout/workspaces/w1/export.csv?season=2025&team=21010&q=fast");
    expect(link.textContent).toContain("(the 4 filtered 2025 entries)");
  });
  it("unfiltered export says all of the season", () => {
    render(<DataHub {...base} workspace={WS} onOpen={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Export CSV/ }).textContent).toContain("(all 2025 entries)");
    expect(dataHubExportUrl("w 1", new URLSearchParams(), 2024)).toBe("/api/scout/workspaces/w%201/export.csv?season=2024");
  });
  it("Personal has no export link", () => {
    render(<DataHub {...base} onOpen={vi.fn()} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
