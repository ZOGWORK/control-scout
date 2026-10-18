// @vitest-environment jsdom
// The YOURS row: "My team" with exactly one Control Point workspace, "My teams" with more, both opening
// the My teams page (/my-teams); today's followed-team row with none or signed out. It counts
// workspaces, never FTC teams. Scout stays Scout: a workspace's space lights Scout, not My teams.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, within, screen } from "@testing-library/react";
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
  it("exactly one workspace: My team, opening My teams (two FTC teams don't make it plural)", () => {
    expect(yoursRow(user([ws("901", "Gearheads")]), true)).toEqual({ kind: "teams", label: "My team", to: "/my-teams" });
  });
  it("two or more workspaces: My teams, opening My teams", () => {
    expect(yoursRow(user([ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")], []), true)).toEqual({ kind: "teams", label: "My teams", to: "/my-teams" });
    expect(yoursRow(user([ws("1", "A"), ws("2", "B"), ws("3", "C")]), true).label).toBe("My teams");
  });
  it("workspace scouting switched off: today's row", () => {
    expect(yoursRow(user([ws("901", "G"), ws("902", "B")]), false)).toMatchObject({ kind: "followed", label: "My team" });
  });
  it("lit on its own page only: My teams (never a scout space), or the followed-team page", () => {
    const teams = yoursRow(user([ws("901", "G"), ws("902", "B")]), true);
    expect(yoursRowActive(teams, "/my-teams")).toBe(true);
    expect(yoursRowActive(teams, "/scout")).toBe(false);
    expect(yoursRowActive(teams, "/my-team")).toBe(false);
    expect(yoursRowActive(yoursRow(null, true), "/my-team")).toBe(true);
    expect(yoursRowActive(yoursRow(null, true), "/my-teams")).toBe(false);
  });
});

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  h.user = null;
  where = "";
  resetFlags({ ...DEFAULT_FLAGS });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("in the app shell", () => {
  const shell = (url = "/") => render(<MemoryRouter initialEntries={[url]}><Shell><Routes><Route path="*" element={<Where />} /></Routes></Shell></MemoryRouter>);
  const sidebar = () => within(screen.getAllByRole("navigation", { name: "Main" })[0]);
  const tabs = () => within(screen.getAllByRole("navigation", { name: "Main" })[1]);

  it("signed out: My team links to the followed-team page, in the sidebar and the tab bar", () => {
    shell();
    expect(sidebar().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/my-team");
    expect(tabs().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/my-team");
  });

  it("one workspace: My team opens My teams", () => {
    h.user = user([ws("901", "Gearheads")]);
    shell();
    expect(sidebar().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/my-teams");
    expect(tabs().getByRole("link", { name: "My team" }).getAttribute("href")).toBe("/my-teams");
    expect(screen.queryByText("My teams")).toBeNull();
  });

  it("two workspaces: My teams is a link to its own page, not a picker", () => {
    h.user = user([ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")]);
    shell("/my-teams");
    const row = sidebar().getByRole("link", { name: "My teams" });
    expect(row.getAttribute("href")).toBe("/my-teams");
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(tabs().getByRole("link", { name: "My teams" }).getAttribute("href")).toBe("/my-teams");
    expect(screen.queryByRole("button", { name: "My teams" })).toBeNull();
  });

  it("a workspace's scout space lights Scout, never My teams", () => {
    h.user = user([ws("901", "Gearheads", "admin"), ws("902", "Bolt Bots")]);
    shell("/scout?space=901");
    expect(sidebar().getByRole("link", { name: "My teams" }).getAttribute("aria-current")).not.toBe("page");
    expect(sidebar().getByRole("link", { name: "Scout" }).getAttribute("aria-current")).toBe("page");
    expect(where).toBe("/scout?space=901");
  });
});
