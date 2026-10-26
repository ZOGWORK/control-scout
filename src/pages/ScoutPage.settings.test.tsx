// @vitest-environment jsdom
// Workspace defaults on the Scout page (Task 6): in a workspace's space with no season in the URL, the
// page opens on the workspace's default season and a new entry starts at its default event; a season
// in the URL wins; Personal is unchanged; a live settings change reaches an open new-entry form.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { announceSettingsChange } from "../lib/workspaceSettings";
import { saveScoutEntry } from "../lib/scouting";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { ENTRY_POLICY, type WorkspaceSettings } from "../shared/workspaceSettings";
import { TooltipProvider } from "../components/ui/overlay";
import { asEntries } from "./scoutTestUrl";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: false, state: { videoLinks: {} } },
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

const WS = "902";
const user: AccountUser = {
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: [{ id: WS, name: "Gearheads", role: "member" }] },
};
let settings: WorkspaceSettings;
const settingsAt = (v: number, season: number | null, eventCode: string | null): WorkspaceSettings =>
  ({ workspaceId: WS, settingsVersion: v, defaults: { season, eventCode }, entryPolicy: ENTRY_POLICY, updatedAt: null, updatedBy: "Coach" });
const fetched: string[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  fetched.length = 0;
  settings = settingsAt(2, 2024, "USNYQ1");
  h.personal = { user, providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {} } };
  resetFlags({ ...DEFAULT_FLAGS });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    const u = new URL(url, "http://x");
    if (u.pathname === `/api/scout/workspaces/${WS}/settings`) return new Response(JSON.stringify({ settings }), { status: 200 });
    if (u.pathname === `/api/scout/workspaces/${WS}/template`) {
      const season = Number(u.searchParams.get("season"));
      return new Response(JSON.stringify({ template: { workspaceId: WS, season, version: 0, settingsVersion: settings.settingsVersion, match: null, pit: null, updatedAt: null, updatedBy: null } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "offline in tests" }), { status: 500 });
  }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[asEntries(url)]}><ScoutPage /></MemoryRouter></TooltipProvider>);
const openNew = () => fireEvent.click(screen.getByRole("button", { name: /New entry/ }));
const eventField = () => screen.getByLabelText("Event code") as HTMLInputElement;
// The season picker's checked option (an open form's Match/Pit choice is a radio group too).
const checkedSeason = () => screen.getAllByRole("radio").map((r) => (r.getAttribute("aria-checked") === "true" ? r.getAttribute("aria-label") ?? "" : "")).find((l) => /^\d{4}/.test(l)) ?? "";

describe("workspace defaults on the Scout page", () => {
  it("a workspace's space opens on its default season, and a new entry starts at its default event", async () => {
    show(`/scout?space=${WS}`);
    await waitFor(() => expect(checkedSeason()).toMatch(/^2024/));
    openNew();
    await waitFor(() => expect(eventField().value).toBe("USNYQ1"));
    // Typed over: the member's own choice stays.
    fireEvent.change(eventField(), { target: { value: "USCAQ2" } });
    expect(eventField().value).toBe("USCAQ2");
  });

  it("a season in the URL wins (and the default event, for another season, isn't filled in)", async () => {
    show(`/scout?space=${WS}&season=2025`);
    openNew();
    await waitFor(() => expect(fetched.some((u) => u.includes("/settings"))).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(checkedSeason()).toMatch(/^2025/);
    expect(eventField().value).toBe("");
  });

  it("Personal is unaffected: no settings request, no default event", async () => {
    show("/scout?space=personal&season=2024");
    openNew();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(fetched.some((u) => u.includes("/settings"))).toBe(false);
    expect(eventField().value).toBe("");
  });

  it("a settings change while the form is open moves an untouched event to the new default", async () => {
    show(`/scout?space=${WS}&season=2024`);
    openNew();
    await waitFor(() => expect(eventField().value).toBe("USNYQ1"));
    settings = settingsAt(3, 2024, "USNYQ9");
    await act(async () => { announceSettingsChange({ space: WS, settingsVersion: 3 }); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(eventField().value).toBe("USNYQ9"));
  });

  it("the default applies when the space opens: a later change to it doesn't move the page", async () => {
    show(`/scout?space=${WS}`);
    await waitFor(() => expect(checkedSeason()).toMatch(/^2024/));
    settings = settingsAt(3, 2025, "USCAQ1");
    await act(async () => { announceSettingsChange({ space: WS, settingsVersion: 3 }); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(fetched.filter((u) => u.includes("/settings")).length).toBeGreaterThan(1));
    expect(checkedSeason()).toMatch(/^2024/);
  });

  it("editing an entry with no event keeps it without one (the default is for new entries only)", async () => {
    saveScoutEntry({ uuid: "editnoevent1", season: 2024, team: 4444, eventCode: null, matchLabel: "Q1", kind: "match", data: {}, notes: "", workspaceId: WS });
    show(`/scout?space=${WS}&season=2024&entry=editnoevent1`);
    await waitFor(() => expect(screen.getByLabelText("Event code")).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(eventField().value).toBe("");
  });

  it("leaving the space and coming back applies the default as it is then", async () => {
    const page = show(`/scout?space=${WS}`);
    await waitFor(() => expect(checkedSeason()).toMatch(/^2024/));
    settings = settingsAt(3, 2025, null);
    await act(async () => { announceSettingsChange({ space: WS, settingsVersion: 3 }); await new Promise((r) => setTimeout(r, 30)); });
    expect(checkedSeason()).toMatch(/^2024/); // held for this visit
    fireEvent.click(screen.getByRole("button", { name: /^Personal/ }));
    await waitFor(() => expect(fetched.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /^Gearheads/ }));
    await waitFor(() => expect(checkedSeason()).toMatch(/^2025/));
    page.unmount();
  });
});
