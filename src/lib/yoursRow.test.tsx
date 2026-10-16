// @vitest-environment jsdom
// The YOURS row: "My team" with exactly one Control Point workspace (opening its scout space),
// "My teams" with more than one (opening the picker), today's followed-team row with none or
// signed out. It counts workspaces, never FTC teams. And the picker opens the chosen space.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AccountUser } from "./personal";
import { yoursRow, yoursRowActive } from "./yoursRow";

const h = vi.hoisted(() => ({ user: null as AccountUser | null }));
vi.mock("./personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: { myTeam: null }, syncReady: false }) }));
// The shell's top bar and backdrop aren't what's under test.
vi.mock("../components/layout/Search", () => ({ GlobalSearch: () => null }));
vi.mock("../components/layout/AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("../components/layout/TopBarExtras", () => ({ ClockWeather: () => null, ThemeToggle: () => null }));
vi.mock("../components/layout/Ambient", () => ({ Ambient: () => null }));
vi.mock("../components/layout/SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("./meta", async (orig) => ({ ...(await orig<typeof import("./meta")>()), useMeta: () => null }));

const { WorkspaceList, WorkspacePickerSheet } = await import("../components/layout/WorkspacePicker");
const { Shell } = await import("../components/layout/Shell");
const { resetFlags } = await import("./flags");
const { DEFAULT_FLAGS } = await import("../shared/flags");

const ws = (id: string, name: string, role: "admin" | "member" = "member") => ({ id, name, role });
const user = (workspaces?: { id: string; name: string; role: "admin" | "member" }[], teams = [{ teamNumber: 18360, name: "A" }, { teamNumber: 9999, name: "B" }]): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9, member: true, teams, url: "", ...(workspaces ? { workspaces } : {}) },
});

describe("yoursRow", () => {
  it("signed out: today's row, My team to the followed-team page", () => {
    expect(yoursRow(null, true)).toEqual({ kind: "followed", label: "My team", to: "/my-team" });
  });
  it("no workspaces (or Control Point's answer unknown): today's row", () => {
    expect(yoursRow(user([]), true)).toMatchObject({ kind: "followed", label: "My team", to: "/my-team" });
    expect(yoursRow(user(undefined), true)).toMatchObject({ kind: "followed", label: "My team" });
    expect(yoursRow({ ...user([ws("1", "A")]), controlPoint: null }, true)).toMatchObject({ kind: "followed" });
  });
  it("exactly one workspace: My team, opening that workspace's scout space (two FTC teams don't make it plural)", () => {
    expect(yoursRow(user([ws("901", "Gearheads")]), true)).toEqual({ kind: "workspace", label: "My team", to: "/scout?space=901", workspace: ws("901", "Gearheads") });
  });
  it("two or more workspaces: My teams, with the picker", () => {
    const r = yoursRow(user([ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")], []), true);
    expect(r).toEqual({ kind: "picker", label: "My teams", workspaces: [ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")] });
    expect(yoursRow(user([ws("1", "A"), ws("2", "B"), ws("3", "C")]), true).label).toBe("My teams");
  });
  it("workspace scouting switched off: today's row", () => {
    expect(yoursRow(user([ws("901", "G"), ws("902", "B")]), false)).toMatchObject({ kind: "followed", label: "My team" });
  });
  it("lit on its own pages only: a workspace's space (not Personal), or the followed-team page", () => {
    const picker = yoursRow(user([ws("901", "G"), ws("902", "B")]), true);
    expect(yoursRowActive(picker, "/scout", "?space=902")).toBe(true);
    expect(yoursRowActive(picker, "/scout", "?space=personal")).toBe(false);
    expect(yoursRowActive(picker, "/my-team", "")).toBe(false);
    expect(yoursRowActive(yoursRow(null, true), "/my-team", "")).toBe(true);
  });
});

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  h.user = null;
  resetFlags({ ...DEFAULT_FLAGS });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the workspace picker", () => {
  it("lists each workspace with its role and pending count; choosing one opens its space", () => {
    localStorage.setItem("cs-scout-ws-dirty:902", JSON.stringify(["abc", "def"]));
    const chose = vi.fn();
    render(<MemoryRouter initialEntries={["/"]}><WorkspaceList workspaces={[ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")]} onChoose={chose} /><Where /></MemoryRouter>);
    const rows = within(screen.getByRole("list", { name: "Workspaces" })).getAllByRole("link");
    expect(rows.map((r) => r.textContent)).toEqual(["GearheadsAdmin", "Bolt BotsMember2 pending"]);
    fireEvent.click(rows[1]);
    expect(where).toBe("/scout?space=902");
    expect(chose).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /My followed team/ }).getAttribute("href")).toBe("/my-team");
  });

  it("as a bottom sheet (phones)", () => {
    render(<MemoryRouter><WorkspacePickerSheet workspaces={[ws("901", "Gearheads"), ws("902", "Bolt Bots")]} open onOpenChange={() => {}} /><Where /></MemoryRouter>);
    expect(screen.getByRole("dialog", { name: "Your teams" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /Gearheads/ }));
    expect(where).toBe("/scout?space=901");
  });
});

describe("in the app shell", () => {
  const shell = (url = "/") => render(<MemoryRouter initialEntries={[url]}><Shell><Routes><Route path="*" element={<Where />} /></Routes></Shell></MemoryRouter>);
  const sidebar = () => within(screen.getAllByRole("navigation", { name: "Main" })[0]);
  const tabs = () => within(screen.getAllByRole("navigation", { name: "Main" })[1]);

  it("signed out: My team links to the followed-team page, in the sidebar and the tab bar", () => {
    shell();
    expect(sidebar().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/my-team");
    expect(tabs().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/my-team");
  });

  it("one workspace: My team opens that workspace's scout space", () => {
    h.user = user([ws("901", "Gearheads")]);
    shell();
    expect(sidebar().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/scout?space=901");
    expect(tabs().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/scout?space=901");
    expect(screen.queryByText("My teams")).toBeNull();
  });

  it("two workspaces: My teams opens the picker, and choosing switches spaces (sidebar popover and phone sheet)", () => {
    h.user = user([ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")]);
    shell("/scout?space=901");
    fireEvent.click(sidebar().getByRole("button", { name: "My teams" }));
    fireEvent.click(screen.getByRole("link", { name: /Bolt Bots/ }));
    expect(where).toBe("/scout?space=902");
    fireEvent.click(tabs().getByRole("button", { name: "My teams" }));
    const sheet = within(screen.getByRole("dialog", { name: "Your teams" }));
    fireEvent.click(sheet.getByRole("link", { name: /Gearheads/ }));
    expect(where).toBe("/scout?space=901");
  });
});
