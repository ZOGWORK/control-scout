// @vitest-environment jsdom
// The owner console, as Control Point's: "Owner console" with Refresh, one tab per section of the owner's
// brief showing what's waiting, Health first on Overview, an Accounts tab (search, then an account in a
// side sheet), the Scout workspaces on Overview, and an audit log with every change's old and new value.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AuditEntry, OwnerOverview, OwnerUser, OwnerUserDetail, OwnerWorkspace } from "../shared/owner";

const OVERVIEW = {
  accounts: { total: 2, active30d: 2, new7d: 1 }, controlPointLinked: 1, workspaces: 1, orphanedWorkspaces: 1,
  scoutEntries: { personal: 3, workspace: 4 }, storage: { databaseBytes: 1e6, databaseLocal: true, packsBytes: null, packFiles: 0 },
  inbox: { openFeedback: 3, errorReports: 2, unfiledErrors: 0 },
  health: {
    release: null, engineVersion: "2.1.1", startedAt: "2026-10-18T00:00:00Z", uptimeSeconds: 60, dataAsOf: null, statsAt: null, packsAt: null, writer: null,
    ledger: { kind: "live", season: 2025, accuracy: 0.712, n: 4321 },
    packManifest: { version: "2026-10-28.1", builtAt: "2026-10-28T06:00:00Z", dataAsOf: "2026-10-28T05:50:00Z", engineVersion: "2.1.1" },
    errors: { reports24h: 1, reports7d: 4, server5xxToday: 2, server5xx7d: 9 },
  },
} as OwnerOverview;
const USERS: OwnerUser[] = [
  { id: 2, email: "priya@example.com", displayName: "Priya", createdAt: "2026-10-01T00:00:00Z", lastSeen: "2026-10-18T00:00:00Z", providers: ["control-point", "email"], personalEntries: 3, workspaces: 1 },
  { id: 1, email: "sam@example.com", displayName: null, createdAt: "2026-10-02T00:00:00Z", lastSeen: null, providers: ["google"], personalEntries: 0, workspaces: 0 },
];
const DETAIL: OwnerUserDetail = {
  id: 2, email: "priya@example.com", displayName: "Priya", createdAt: "2026-10-01T00:00:00Z", lastSeen: "2026-10-18T00:00:00Z", signIns: ["control-point", "email"], controlPointAccount: 9001,
  sessions: 1, saved: [{ key: "bookmarks", updatedAt: 5 }],
  personalEntries: { count: 3, lastUpdated: null }, workspaces: [{ id: "cp1", name: "Hypnotic Robotics", role: "admin", orphaned: false, authoredEntries: 4 }],
};
const WORKSPACES: OwnerWorkspace[] = [{ id: "cp1", name: "Hypnotic Robotics", createdAt: "2026-10-02", members: 2, entries: 4, lastEntryAt: null, orphaned: null }];
const LONG_WHAT = { workspaceId: "ws1", workspaceName: "Riverside Robotics scouting and strategy (north region, 2025-26)", name: "Alexandra Whitfield-Montgomery", accountId: 3, actorAccountId: 1, origin: "control-point" };
const LONG_RESULT = "failed: FIRST events API answered 503 for 3 of 41 events; the next scheduled sync retries them automatically";
const AUDIT: AuditEntry[] = [
  { id: 2, at: "2026-10-18T12:30:00.000Z", actor: "owner@example.test", action: "workspace.member_removed", details: LONG_WHAT, result: LONG_RESULT, change: null },
  { id: 3, at: "2026-10-18T10:00:00.000Z", actor: "owner@example.test", action: "flag.set", details: { flag: "offlinePacks", enabled: false }, result: null, change: { from: true, to: false } },
  { id: 1, at: "2026-10-18T09:00:00.000Z", actor: "owner@example.test", action: "ops.caches", details: null, result: null, change: null },
];
const asked: string[] = [];
const stale = vi.fn();

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  markStale: (p: string) => stale(p),
  useApi: (path: string | null) => {
    if (path) asked.push(path);
    const data = !path ? undefined
      : path === "/api/owner/overview" ? OVERVIEW
      : path.startsWith("/api/owner/users/") ? DETAIL
      : path.startsWith("/api/owner/users") ? (path.includes("q=sam") ? { users: [USERS[1]], total: 1 } : { users: USERS, total: 2 })
      : path === "/api/owner/workspaces" ? { workspaces: WORKSPACES }
      : path.startsWith("/api/owner/audit") ? { entries: AUDIT }
      : undefined;
    return { data, error: undefined, loading: !data, reload: () => {} };
  },
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
vi.mock("../components/owner/StoragePanel", () => ({ StorageBanner: () => null, StoragePanel: () => null }));
vi.mock("../components/owner/PowerRankingsPanel", () => ({ PowerRankingsPanel: () => null }));

const { default: OwnerPage } = await import("./OwnerPage");
const { TooltipProvider } = await import("../components/ui/overlay");
const mount = (url = "/owner") => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><OwnerPage /></MemoryRouter></TooltipProvider>);

let phone = false;
beforeEach(() => {
  asked.length = 0; stale.mockClear(); phone = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width") ? phone : false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(cleanup);

describe("owner console", () => {
  it("is the Owner console, with a Refresh that reloads every owner request", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Owner console");
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(stale).toHaveBeenCalledWith("/api/owner/");
  });

  it("has one tab per section of the brief, and shows what's waiting on them", () => {
    mount();
    expect(screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+/g, ""))).toEqual([
      "Overview", "Data & sync", "Predictions & ledger", "Rankings & content", "Features", "Feedback & errors", "Analytics", "Accounts", "Photo storage", "Audit log",
    ]);
    const feedback = screen.getByRole("tab", { name: /Feedback & errors/ });
    expect(within(feedback).getByLabelText("3 open feedback")).toBeTruthy();
    expect(within(feedback).getByLabelText("2 error reports")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Accounts/ })).getByLabelText("1 orphaned spaces")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Analytics/ })).queryByText(/\d/)).toBeNull();
  });

  it("opens on Overview with Health first: site, sync, engine, ledger, packs and errors", () => {
    mount();
    const health = screen.getByRole("heading", { name: "Health" }).closest("section")!;
    expect(screen.getAllByRole("heading", { level: 2 })[0].textContent).toBe("Health");
    expect(within(health).getByText("Up")).toBeTruthy();
    expect(within(health).getByText("Never")).toBeTruthy();
    expect(within(health).getByText("v2.1.1")).toBeTruthy();
    expect(within(health).getByText("Live ledger")).toBeTruthy();
    expect(within(health).getByText(/4,321 live calls/)).toBeTruthy();
    expect(within(health).getByText(/Version 2026-10-28\.1/)).toBeTruthy();
    expect(within(health).getByText("2 server · 1 app")).toBeTruthy();
  });

  it("old per-panel links open the section that holds the panel now", () => {
    mount("/owner?panel=flags");
    expect(screen.getByRole("tab", { name: /Features/ }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    mount("/owner?panel=nonsense");
    expect(screen.getByRole("tab", { name: /Overview/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("lists the Scout workspaces on Overview", () => {
    mount();
    const table = screen.getByText("Workspaces (1)").closest("section")!;
    expect(within(table).getByText("Hypnotic Robotics")).toBeTruthy();
  });

  it("Users: lists accounts, searches, and opens one in a sheet", async () => {
    mount("/owner?panel=users");
    expect(screen.getByText("Users (2)")).toBeTruthy();
    expect(screen.getByText("priya@example.com")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "sam" } });
    await waitFor(() => expect(asked).toContain("/api/owner/users?q=sam"));
    fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Priya/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Priya/ }));
    const sheet = await screen.findByRole("dialog");
    expect(asked).toContain("/api/owner/users/2");
    expect(within(sheet).getByText("Control Point, Email code")).toBeTruthy();
    expect(within(sheet).getByText("#9001")).toBeTruthy();
    expect(within(sheet).getByText("Signed in on 1 device")).toBeTruthy();
    // A count only: no browser or device strings in the console.
    expect(sheet.textContent).not.toMatch(/Mozilla|iPhone/);
    expect(within(sheet).getByText("Hypnotic Robotics")).toBeTruthy();
  });

  it("What's new: the releases visitors see, from CHANGELOG.md", async () => {
    mount("/owner?panel=whatsNew");
    const rail = await screen.findByRole("navigation", { name: "Releases" });
    expect(within(rail).getAllByRole("button")[0].textContent).toMatch(/^v\d+\.\d+\.\d+Latest$/);
  });

  it("Audit log on a phone: one card per entry with who, when and what; long summaries and results expand", async () => {
    phone = true;
    mount("/owner?panel=audit");
    const list = await screen.findByRole("list", { name: "Audit log entries" });
    expect(screen.queryByRole("table")).toBeNull();
    const [long, short] = within(list).getAllByTestId("audit-entry");
    const summary = "Alexandra Whitfield-Montgomery is no longer in Riverside Robotics scouting and strategy (north region, 2025-26) (changed in Control Point)";
    // The whole text is in the page (clamped visually only), with a toggle that says what it opens.
    const what = within(long).getByText(summary);
    expect(what.className).toContain("line-clamp-2");
    const more = within(long).getByRole("button", { name: "Show more of the summary" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(what.id);
    fireEvent.click(more);
    expect(what.className).not.toContain("line-clamp-2");
    expect(within(long).getByRole("button", { name: "Show less of the summary" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(long).getByText(LONG_RESULT).parentElement!.className).toContain("text-danger");
    expect(within(long).getByRole("button", { name: "Show more of the result" })).toBeTruthy();
    // Who and when stay on every card, with the exact time machine-readable.
    expect(long.textContent).toContain("owner@example.test");
    expect(long.querySelector("time")!.getAttribute("dateTime")).toBe("2026-10-18T12:30:00.000Z");
    // A change shows its old and new value.
    expect(within(list).getAllByTestId("audit-change").map((c) => c.textContent)).toEqual(["Changed on → off"]);
    // Short ones get no toggle.
    expect(short.textContent).toContain("Turned Offline pack auto-updates off");
    expect(within(short).queryByRole("button")).toBeNull();
    const last = within(list).getAllByTestId("audit-entry")[2];
    expect(last.textContent).toContain("Clear caches");
    expect(last.textContent).toContain("Done");
  });

  it("Audit log on wider screens: When / What / Old → new / Result / Who, with no way to edit or delete", async () => {
    mount("/owner?panel=audit");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["When", "What", "Old → new", "Result", "Who"]);
    expect(within(table).getByText("on → off")).toBeTruthy();
    expect(within(table).queryAllByRole("button")).toEqual([]);
    expect(within(table).getByText(LONG_RESULT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });
});
