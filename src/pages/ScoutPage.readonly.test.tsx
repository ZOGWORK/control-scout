// @vitest-environment jsdom
// A read-only scout space (Task 19): the workspace was deleted in Control Point (or has no admin left).
// The page shows the banner, keeps every entry readable (View, not Edit), and offers nothing that writes:
// no New entry, no Delete, no Template, no comment box, no Save. Export still works. A writable space
// shows none of this.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { localScoutEntries } from "../lib/scouting";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { orphanBanner, type OrphanState } from "../shared/orphaned";
import { TooltipProvider } from "../components/ui/overlay";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: true, state: { videoLinks: {} } },
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

const base = { season: 2025, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };
const signedIn = (orphaned?: OrphanState): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: [{ id: "901", name: "Gearheads", role: "admin", ...(orphaned ? { orphaned } : {}) }] },
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  // Synced (an author on the server), so its comment thread loads.
  localStorage.setItem("cs-scout-ws:901:gearheads001", JSON.stringify({ uuid: "gearheads001", ...base, team: 2222, notes: "steady intake", updatedAt: 1000, workspaceId: "901", authorAccountId: 5, authorDisplayName: "Max" }));
  localStorage.setItem("cs-scout-tpl:901:2025", JSON.stringify({ workspaceId: "901", season: 2025, version: 0, settingsVersion: 0, match: null, pit: null, updatedAt: null, updatedBy: null }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/comment-counts")) return new Response(JSON.stringify({ counts: {} }), { status: 200 });
    if (url.includes("/comments")) return new Response(JSON.stringify({ comments: [], entryDeleted: false }), { status: 200 });
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ScoutPage /></MemoryRouter></TooltipProvider>);

describe("read-only space", () => {
  it("deleted in Control Point: the banner, entries readable, nothing that writes", async () => {
    h.personal.user = signedIn({ at: "2026-10-16T09:00:00.000Z", reason: "deleted" });
    show("/scout?season=2025&space=901");
    expect(await screen.findByText(orphanBanner("deleted"))).toBeTruthy();
    expect(screen.getByText("This workspace no longer exists in Control Point — this space is read-only. Your entries are preserved.")).toBeTruthy();
    expect(screen.getByText("2222")).toBeTruthy(); // the entry is still there
    expect(screen.queryByRole("button", { name: /new entry/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /template/i })).toBeNull(); // Ada was an admin: no longer changes anything
    expect(screen.queryByRole("button", { name: "Delete entry" })).toBeNull();
    expect(screen.getByRole("link", { name: /export/i })).toBeTruthy(); // reading and exporting still work
    // The switcher says so.
    expect(screen.getAllByText("read-only").length).toBeGreaterThan(0);
    // View opens the entry with every field disabled and no Save; comments read, no box to add one.
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const notes = await screen.findByLabelText("Notes") as HTMLTextAreaElement;
    expect(notes.value).toBe("steady intake");
    expect(notes.matches(":disabled")).toBe(true); // inside the disabled fieldset
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(await screen.findByText(/comments can be read, not added to/)).toBeTruthy();
    expect(screen.queryByLabelText("Add a comment")).toBeNull();
  });

  it("no admin left: its own banner, the same read-only page", async () => {
    h.personal.user = signedIn({ at: "2026-10-16T09:00:00.000Z", reason: "no_admin" });
    show("/scout?season=2025&space=901");
    expect(await screen.findByText(orphanBanner("no_admin"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new entry/i })).toBeNull();
  });

  it("going read-only while a new entry is open keeps the draft, and Save keeps it in Personal", async () => {
    h.personal.user = signedIn();
    const view = show("/scout?season=2025&space=901");
    fireEvent.click(await screen.findByRole("button", { name: /new entry/i }));
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "2222" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "typed before the workspace went" } });
    // A live update: the workspace was deleted in Control Point.
    h.personal.user = signedIn({ at: "2026-10-16T09:00:00.000Z", reason: "deleted" });
    view.rerender(<TooltipProvider><MemoryRouter initialEntries={["/scout?season=2025&space=901"]}><ScoutPage /></MemoryRouter></TooltipProvider>);
    expect(await screen.findByText(orphanBanner("deleted"))).toBeTruthy();
    const notes = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    expect(notes.value).toBe("typed before the workspace went"); // the draft is still there, editable
    expect(notes.matches(":disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save to Personal" }));
    await waitFor(() => expect(localScoutEntries(null).map((e) => [e.team, e.notes, e.workspaceId])).toEqual([[2222, "typed before the workspace went", null]]));
    expect(localScoutEntries("901").map((e) => e.uuid)).toEqual(["gearheads001"]); // nothing new queued for the read-only space
  });

  it("a writable space: no banner, writing as ever", async () => {
    h.personal.user = signedIn();
    show("/scout?season=2025&space=901");
    expect(await screen.findByRole("button", { name: /new entry/i })).toBeTruthy();
    expect(screen.queryByText(/this space is read-only/)).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /template/i })).toBeTruthy();
  });
});
