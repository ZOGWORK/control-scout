// @vitest-environment jsdom
// The owner console, as Control Point's: "Owner console" with Refresh, tabs that show what's waiting,
// a Users tab (search, then an account in a side sheet) and the Scout workspaces on Overview.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AuditEntry, OwnerOverview, OwnerUser, OwnerUserDetail, OwnerWorkspace } from "../shared/owner";

const OVERVIEW = {
  accounts: { total: 2, active30d: 2, new7d: 1 }, controlPointLinked: 1, workspaces: 1, orphanedWorkspaces: 1,
  scoutEntries: { personal: 3, workspace: 4 }, storage: { databaseBytes: 1e6, databaseLocal: true, packsBytes: null, packFiles: 0 },
  inbox: { openFeedback: 3, errorReports: 2, unfiledErrors: 0 },
  health: { release: null, engineVersion: "2.1.1", startedAt: "2026-10-18T00:00:00Z", uptimeSeconds: 60, dataAsOf: null, statsAt: null, packsAt: null, writer: null },
} as OwnerOverview;
const USERS: OwnerUser[] = [
  { id: 2, email: "priya@example.com", displayName: "Priya", createdAt: "2026-10-01T00:00:00Z", lastSeen: "2026-10-18T00:00:00Z", providers: ["control-point", "email"], personalEntries: 3, workspaces: 1 },
  { id: 1, email: "sam@example.com", displayName: null, createdAt: "2026-10-02T00:00:00Z", lastSeen: null, providers: ["google"], personalEntries: 0, workspaces: 0 },
];
const DETAIL: OwnerUserDetail = {
  id: 2, email: "priya@example.com", displayName: "Priya", createdAt: "2026-10-01T00:00:00Z", lastSeen: "2026-10-18T00:00:00Z", signIns: ["control-point", "email"], controlPointAccount: 9001,
  sessions: [{ createdAt: "2026-10-17T00:00:00Z", expiresAt: "2026-11-17T00:00:00Z", device: "Mozilla/5.0 (iPhone)" }], saved: [{ key: "bookmarks", updatedAt: 5 }],
  personalEntries: { count: 3, lastUpdated: null }, workspaces: [{ id: "cp1", name: "Hypnotic Robotics", role: "admin", orphaned: false, authoredEntries: 4 }],
};
const WORKSPACES: OwnerWorkspace[] = [{ id: "cp1", name: "Hypnotic Robotics", createdAt: "2026-10-02", members: 2, entries: 4, lastEntryAt: null, orphaned: null }];
const LONG_WHAT = { workspaceId: "ws1", workspaceName: "Riverside Robotics scouting and strategy (north region, 2025-26)", name: "Alexandra Whitfield-Montgomery", accountId: 3, actorAccountId: 1, origin: "control-point" };
const LONG_RESULT = "failed: FIRST events API answered 503 for 3 of 41 events; the next scheduled sync retries them automatically";
const AUDIT: AuditEntry[] = [
  { id: 2, at: "2026-10-18T12:30:00.000Z", actor: "owner@example.test", action: "workspace.member_removed", details: LONG_WHAT, result: LONG_RESULT },
  { id: 1, at: "2026-10-18T09:00:00.000Z", actor: "owner@example.test", action: "ops.caches", details: null, result: null },
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

  it("shows what's waiting on the tabs", () => {
    mount();
    expect(within(screen.getByRole("tab", { name: /Feedback/ })).getByText("3")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Errors/ })).getByText("2")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Orphaned spaces/ })).getByText("1")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Usage/ })).queryByText(/\d/)).toBeNull();
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
    // Short ones get no toggle.
    expect(short.textContent).toContain("Clear caches");
    expect(short.textContent).toContain("Done");
    expect(within(short).queryByRole("button")).toBeNull();
  });

  it("Audit log on wider screens keeps the When / What / Result / Who table", async () => {
    mount("/owner?panel=audit");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["When", "What", "Result", "Who"]);
    expect(within(table).getByText(LONG_RESULT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
  });
});
