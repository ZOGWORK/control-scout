// @vitest-environment jsdom
// The Data hub's rows follow the space and role (Personal, member, admin, read-only), show their counts, and
// Export CSV is the same download link the page builds today.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataHub, dataHubExportUrl, dataHubRows, type DataHubProps } from "./DataHub";
import { workspaceExportUrl } from "../../../shared/scoutExport";

afterEach(cleanup);
const WS = { id: "w1", name: "Riverside" };
const base: Omit<DataHubProps, "onOpen"> = { workspace: null, season: 2025, entryCount: 3 };
const keys = (p: Partial<DataHubProps>) => dataHubRows({ ...base, ...p }).map((r) => r.key);

describe("Data hub rows", () => {
  it("Personal: entries, pit scouting and recordings only", () => {
    expect(keys({})).toEqual(["entries", "pit", "recordings"]);
  });
  it("a member: everything but the template", () => {
    expect(keys({ workspace: WS })).toEqual(["entries", "picklist", "activity", "assignments", "pit", "recordings", "export"]);
  });
  it("an admin: the template too, last", () => {
    expect(keys({ workspace: WS, isAdmin: true })).toEqual(["entries", "picklist", "activity", "assignments", "pit", "recordings", "export", "template"]);
  });
  it("a read-only workspace keeps what reads and exports, and drops the template even for an admin", () => {
    expect(keys({ workspace: WS, isAdmin: true, readOnly: true })).toEqual(["entries", "picklist", "activity", "assignments", "pit", "recordings", "export"]);
    const rows = dataHubRows({ ...base, workspace: WS, readOnly: true });
    expect(rows.find((r) => r.key === "entries")!.detail).toMatch(/read$/);
    expect(rows.find((r) => r.key === "picklist")!.detail).toMatch(/read-only/);
  });
});

describe("Data hub counts", () => {
  it("entries, assignments open for you and pit progress", () => {
    render(<DataHub {...base} workspace={WS} entryCount={84} openForYou={2} pit={{ done: 18, total: 24 }} eventCode="USNJQ1" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Entries/ }).textContent).toContain("84 entries in 2025");
    const assign = screen.getByRole("button", { name: /Assignments/ });
    expect(assign.textContent).toContain("2 open for you");
    expect(assign.querySelector("[data-slot=badge]")?.textContent).toBe("2");
    expect(screen.getByRole("button", { name: /Pit scouting/ }).textContent).toContain("18 of 24 teams done at USNJQ1");
  });
  it("one entry reads singular; no open assignments shows no badge; unknown pit progress says what pit scouting is", () => {
    render(<DataHub {...base} workspace={WS} entryCount={1} openForYou={0} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Entries/ }).textContent).toContain("1 entry in 2025");
    expect(screen.getByRole("button", { name: /Assignments/ }).textContent).not.toMatch(/open for you|\d/);
    expect(screen.getByRole("button", { name: /Pit scouting/ }).textContent).toContain("Robot details");
  });
});

describe("Data hub actions", () => {
  it("each row opens its view", () => {
    const onOpen = vi.fn();
    render(<DataHub {...base} workspace={WS} isAdmin onOpen={onOpen} />);
    for (const [name, view] of [["Entries", "entries"], ["Pick list", "picklist"], ["Activity", "activity"], ["Assignments", "assignments"], ["Pit scouting", "pit"], ["Match recordings", "recordings"], ["Template", "template"]] as const) {
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
