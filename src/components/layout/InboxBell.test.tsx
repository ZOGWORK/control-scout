// @vitest-environment jsdom
// The notification inbox's bell: top right of the header and nowhere else (never the sidebar, the
// tab bar or the More sheet), only when signed in; the unread badge; the list (a panel, or a sheet on
// phones); tapping an item marks it read and opens its link; "Mark all read".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AccountUser } from "../../lib/personal";
import type { InboxItem } from "../../shared/inbox";

const h = vi.hoisted(() => ({
  user: null as AccountUser | null,
  unread: 0,
  items: [] as InboxItem[],
  calls: [] as { path: string; init?: { method?: string; json?: unknown } }[],
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: { myTeam: null }, syncReady: false }) }));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  apiFetch: async (path: string, init?: { method?: string; json?: { ids?: number[]; all?: boolean } }) => {
    h.calls.push({ path, init });
    if (path === "/api/inbox/unread-count") return { unread: h.unread };
    if (path.startsWith("/api/inbox?")) return { items: h.items, more: false, unread: h.unread };
    if (path === "/api/inbox/read") {
      const ids = init?.json?.ids ?? h.items.map((i) => i.id);
      h.items = h.items.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i));
      h.unread = h.items.filter((i) => !i.read).length;
      return { unread: h.unread };
    }
    throw new Error(`unexpected ${path}`);
  },
}));
vi.mock("./Search", () => ({ GlobalSearch: () => null }));
vi.mock("./AccountMenu", () => ({ AccountMenu: () => null }));
vi.mock("./TopBarExtras", () => ({ ClockWeather: () => null, ThemeToggle: () => null }));
vi.mock("./Ambient", () => ({ Ambient: () => null }));
vi.mock("./SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { Shell } = await import("./Shell");
const { InboxBell } = await import("./InboxBell");

const user: AccountUser = { id: 7, email: "priya@scout.test", displayName: "Priya", createdAt: "", controlPointLinked: true, controlPoint: { accountId: 9, member: true, teams: [], url: "", workspaces: [{ id: "901", name: "Gearheads", role: "member" }] } };
const item = (id: number, over: Partial<InboxItem> = {}): InboxItem => ({
  id, at: Date.now() - 120_000, workspaceId: "901", workspaceName: "Gearheads", category: "edits", type: "entry.edited", actorName: "Coach",
  title: "Coach edited your entry", body: "team 18360 · match Q1", link: `/scout?space=901&entry=e${id}`, read: false, ...over,
});

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
let phone = false;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width") ? phone : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("EventSource", undefined); // no stream here: the bell polls the count
  localStorage.clear();
  h.user = null; h.unread = 0; h.items = []; h.calls = []; phone = false; where = "";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const shell = () => render(<MemoryRouter initialEntries={["/"]}><Shell><Routes><Route path="*" element={<Where />} /></Routes></Shell></MemoryRouter>);

describe("the bell's place", () => {
  it("signed in: in the header (top right, before the account button), never in the sidebar, the tab bar or the More sheet", async () => {
    h.user = user;
    shell();
    const bell = await screen.findByRole("button", { name: /^Notifications/ });
    expect(screen.getAllByRole("button", { name: /^Notifications/ })).toHaveLength(1);
    expect(bell.closest("header")).toBe(screen.getByRole("banner"));
    expect(bell.closest("aside")).toBeNull();
    for (const nav of screen.getAllByRole("navigation")) expect(within(nav).queryByRole("button", { name: /^Notifications/ })).toBeNull();
    // The More sheet (phones' full menu) doesn't carry it either.
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const more = screen.getByRole("dialog");
    expect(within(more).queryByRole("button", { name: /^Notifications/ })).toBeNull();
    expect(within(more).queryByText("Notifications")).toBeNull();
  });

  it("signed out: no bell anywhere", () => {
    shell();
    expect(screen.queryByRole("button", { name: /^Notifications/ })).toBeNull();
    expect(document.querySelector("[data-inbox-bell]")).toBeNull();
  });
});

describe("the bell", () => {
  const bell = (initial = "/") => render(<MemoryRouter initialEntries={[initial]}><InboxBell /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);

  it("shows the unread count from the server, and lists items when opened", async () => {
    h.user = user; h.unread = 2; h.items = [item(2), item(1, { title: "You were added to Gearheads", category: "membership", read: true })];
    bell();
    const button = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(document.querySelector("[data-inbox-badge]")?.textContent).toBe("2");
    fireEvent.click(button);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    await waitFor(() => expect(within(panel).getAllByRole("listitem")).toHaveLength(2));
    expect(within(panel).getByText("Coach edited your entry")).toBeTruthy();
    expect(within(panel).getAllByText("Gearheads · 2m ago")).toHaveLength(2);
  });

  it("tapping an item marks it read on the server and opens its link", async () => {
    h.user = user; h.unread = 1; h.items = [item(5)];
    bell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(await screen.findByRole("button", { name: /Coach edited your entry/ }));
    expect(where).toBe("/scout?space=901&entry=e5");
    await waitFor(() => expect(h.calls.some((c) => c.path === "/api/inbox/read" && JSON.stringify(c.init?.json) === JSON.stringify({ ids: [5] }))).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")).toBeNull());
  });

  it("mark all read: up to the newest item shown", async () => {
    h.user = user; h.unread = 2; h.items = [item(9), item(8)];
    bell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(h.calls.find((c) => c.path === "/api/inbox/read")?.init?.json).toEqual({ all: true, upTo: 9 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
  });

  it("on a phone the list is a bottom sheet", async () => {
    phone = true;
    h.user = user; h.unread = 1; h.items = [item(3)];
    bell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    const sheet = await screen.findByRole("dialog", { name: "Notifications" });
    expect(sheet.getAttribute("data-slot")).toBe("sheet-content");
    await waitFor(() => expect(within(sheet).getByText("Coach edited your entry")).toBeTruthy());
  });

  it("nothing yet: says so", async () => {
    h.user = user;
    bell();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
    await act(async () => {});
  });
});
