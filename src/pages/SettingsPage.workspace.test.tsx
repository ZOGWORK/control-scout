// @vitest-environment jsdom
// Settings → Workspace (Task 6): the section exists only for workspace members; members see the
// workspace's settings with every control disabled and a one-line reason; admins can change the
// defaults (a PUT with the version they edited); several workspaces get a selector.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "../shared/personal";
import { ENTRY_POLICY, type WorkspaceSettings } from "../shared/workspaceSettings";
import { TooltipProvider } from "../components/ui/overlay";
import { ADMINS_ONLY, MEMBERSHIP_NOTE } from "../components/settings/WorkspaceSection";

const h = vi.hoisted(() => ({
  personal: {} as Record<string, unknown>,
  /** The members API (Task 9); null: the default 500. */
  members: null as null | { list: () => unknown; remove: (body: { accountId: number }) => Response },
}));
const removes: { accountId: number }[] = [];
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));

const { default: SettingsPage } = await import("./SettingsPage");

type Ws = { id: string; name: string; role: "admin" | "member" };
const userIn = (workspaces: Ws[] | undefined): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "https://cp.test", ...(workspaces ? { workspaces } : {}) },
});
const settingsFor = (ws: string): WorkspaceSettings =>
  ({ workspaceId: ws, settingsVersion: 4, defaults: { season: 2024, eventCode: "USNYQ1" }, entryPolicy: ENTRY_POLICY, updatedAt: "2026-10-01T12:00:00Z", updatedBy: "Coach" });
const puts: { url: string; body: any }[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  puts.length = 0;
  removes.length = 0;
  h.members = null;
  resetFlags({ ...DEFAULT_FLAGS });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://x");
    const m = /^\/api\/scout\/workspaces\/([^/]+)\/(settings|template)$/.exec(u.pathname);
    if (m && m[2] === "settings" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push({ url, body });
      return new Response(JSON.stringify({ changed: true, dropped: [], settings: { ...settingsFor(m[1]), settingsVersion: 5, defaults: { ...settingsFor(m[1]).defaults, ...body.defaults } } }), { status: 200 });
    }
    const mem = /^\/api\/scout\/workspaces\/([^/]+)\/members(\/remove)?$/.exec(u.pathname);
    if (mem && h.members) {
      if (mem[2]) { const body = JSON.parse(String(init?.body)); removes.push(body); return h.members.remove(body); }
      return new Response(JSON.stringify(h.members.list()), { status: 200 });
    }
    if (m && m[2] === "settings") return new Response(JSON.stringify({ settings: settingsFor(m[1]) }), { status: 200 });
    if (m) return new Response(JSON.stringify({ template: { workspaceId: m[1], season: Number(u.searchParams.get("season")), version: 2, settingsVersion: 4, match: [], pit: null, updatedAt: null, updatedBy: "Coach" } }), { status: 200 });
    return new Response(JSON.stringify({ error: "offline in tests" }), { status: 500 });
  }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

function show(user: AccountUser | null, url = "/settings?section=workspace") {
  h.personal = { user, providers: { email: true, google: false }, sync: "synced", state: { ...EMPTY_STATE, settings: DEFAULT_SETTINGS }, update: vi.fn(), set: vi.fn(), refreshUser: vi.fn(async () => {}) };
  return render(<TooltipProvider><MemoryRouter initialEntries={[url]}><SettingsPage /></MemoryRouter></TooltipProvider>);
}
const nav = () => screen.getByRole("navigation", { name: "Settings sections" });

describe("Settings: Personal and Workspace", () => {
  it("not in a workspace (or signed out): no Workspace section, and asking for it lands on Profile", () => {
    for (const u of [userIn([]), userIn(undefined), null]) {
      show(u);
      expect(nav().textContent).not.toContain("Workspace");
      expect(nav().textContent).toContain("Personal");
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Profile");
      cleanup();
    }
  });

  it("workspace scouting switched off: no Workspace section", () => {
    resetFlags({ ...DEFAULT_FLAGS, workspaceScouting: false });
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }]));
    expect(nav().textContent).not.toContain("Workspace");
  });

  it("a member sees the workspace's settings, every control disabled, with the reasons", async () => {
    show(userIn([{ id: "77", name: "Gearheads", role: "member" }]));
    expect(nav().textContent).toContain("Workspace");
    await waitFor(() => expect((screen.getByLabelText("Default event") as HTMLInputElement).value).toBe("USNYQ1"));
    expect((screen.getByLabelText("Default event") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Default season" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save defaults/ })).toBeNull();
    expect((screen.getByRole("button", { name: /Edit template/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(MEMBERSHIP_NOTE)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(ADMINS_ONLY.replace(".", "\\."))).length).toBeGreaterThan(0);
    expect(screen.getByText("Member")).toBeTruthy();
    // The policy, read-only.
    expect(screen.getByText("Its author, or an admin")).toBeTruthy();
  });

  it("an admin changes the default event: a PUT with the version edited", async () => {
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }]));
    const input = await screen.findByLabelText("Default event") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("USNYQ1"));
    expect((input as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("link", { name: /Edit template/ }).getAttribute("href")).toMatch(/^\/scout\?space=77&season=\d{4}&view=template$/);
    const save = screen.getByRole("button", { name: /Save defaults/ });
    expect((save as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
    fireEvent.change(input, { target: { value: "usnyq2" } });
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe("/api/scout/workspaces/77/settings");
    expect(puts[0].body).toEqual({ defaults: { season: 2024, eventCode: "USNYQ2" }, baseVersion: 4 });
  });

  it("several workspaces: a selector, starting with the scout space last used here", async () => {
    localStorage.setItem("cs-scout-space", JSON.stringify({ id: "78", name: "Sprockets", account: 1 }));
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }, { id: "78", name: "Sprockets", role: "member" }]));
    expect(screen.getByRole("combobox", { name: "Workspace" }).textContent).toContain("Sprockets");
    await waitFor(() => expect((screen.getByLabelText("Default event") as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("Settings → Workspace → Members (Task 9)", () => {
  const people = (canRemove: boolean, removeUnavailable: string | null = null, source = "control-point") => ({
    source, canRemove, removeUnavailable,
    members: [
      { accountId: 9001, name: "Ada Admin", role: "admin", you: true },
      { accountId: null, name: "Bea Builder", role: "member", you: false },
      { accountId: 9002, name: "Max Member", role: "member", you: false },
    ],
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const list = () => screen.findByRole("list", { name: "Members of Gearheads" });

  it("a member sees everyone and their roles, with no Remove", async () => {
    h.members = { list: () => people(false), remove: () => json(500, {}) };
    show(userIn([{ id: "77", name: "Gearheads", role: "member" }]));
    const ul = await list();
    expect(ul.textContent).toContain("Ada Admin (you)");
    expect(ul.textContent).toContain("Bea BuilderNot on Control Scout yet");
    expect(ul.textContent).toContain("Max Member");
    expect(screen.getByText("Members (3)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });

  it("an admin removes someone after confirming; the list reloads", async () => {
    let gone = false;
    h.members = { list: () => (gone ? { ...people(true), members: people(true).members.filter((m) => m.accountId !== 9002) } : people(true)), remove: () => { gone = true; return json(200, { ok: true, self: false }); } };
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }]));
    await list();
    // Nobody can be removed from here who's never used Control Scout: no button on Bea's row.
    expect(screen.queryByRole("button", { name: "Remove Bea Builder" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Max Member" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Remove Max Member from Gearheads?");
    expect(dialog.textContent).toContain("personal data and entries stay");
    expect(removes).toEqual([]); // nothing until confirmed
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /^Remove$/ })); });
    await waitFor(() => expect(removes).toEqual([{ accountId: 9002 }]));
    await waitFor(() => expect(screen.queryByText("Max Member")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the last admin leaving: Control Point's refusal is shown in the dialog", async () => {
    h.members = { list: () => people(true), remove: () => json(409, { error: "You're the workspace's last admin. Make someone else an admin in Control Point before you leave.", code: "last_admin" }) };
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }]));
    await list();
    fireEvent.click(screen.getByRole("button", { name: "Leave Gearheads" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Leave Gearheads?");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Leave workspace/ })); });
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/last admin/);
    expect(h.personal.refreshUser).not.toHaveBeenCalled();
  });

  it("leaving works: the account is asked again so the workspace goes", async () => {
    h.members = { list: () => people(true), remove: () => json(200, { ok: true, self: true }) };
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }]));
    await list();
    fireEvent.click(screen.getByRole("button", { name: "Leave Gearheads" }));
    await act(async () => { fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Leave workspace/ })); });
    await waitFor(() => expect(h.personal.refreshUser).toHaveBeenCalled());
  });

  it("an older Control Point: Remove is off, with the reason; only Scout's members are listed", async () => {
    h.members = { list: () => ({ ...people(false, "Removing members needs the latest Control Point.", "scout"), members: people(false).members.filter((m) => m.accountId) }), remove: () => json(500, {}) };
    show(userIn([{ id: "77", name: "Gearheads", role: "admin" }]));
    await list();
    expect(screen.getByText("Removing members needs the latest Control Point.")).toBeTruthy();
    expect(screen.getByText(/Members who use Control Scout/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove Max Member" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
