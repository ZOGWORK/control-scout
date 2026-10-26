// @vitest-environment jsdom
// The notification inbox's bell: top right of the header and nowhere else (never the sidebar, the
// tab bar or the menu sheet), only when signed in; the unread badge; the list (a panel, or a sheet on
// phones); tapping an item marks it read and opens its link; "Mark all read"; per-item Mark unread and
// Follow up toggles (accessible names, pressed state, the badge) and the Follow up filter.
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
  failNext: {} as Record<string, number>,
}));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: { myTeam: null }, syncReady: false }) }));
vi.mock("../../lib/api", async (orig) => { const real = await orig<typeof import("../../lib/api")>(); return {
  ...real,
  apiFetch: async (path: string, init?: { method?: string; json?: { ids?: number[]; all?: boolean; on?: boolean } }) => {
    h.calls.push({ path, init });
    // A write the server refuses this many more times (V4-PRIVATE-002: 503 while it's away).
    if (h.failNext[path] > 0) { h.failNext[path]--; throw new real.ApiError(503, "Service unavailable"); }
    const followUp = () => h.items.filter((i) => i.followUp).length;
    if (path === "/api/inbox/unread-count") return { unread: h.unread };
    if (path.startsWith("/api/inbox?")) {
      const keep = (/keep=([0-9,]+)/.exec(path)?.[1] ?? "").split(",").map(Number);
      const items = path.includes("filter=followUp") ? h.items.filter((i) => i.followUp || keep.includes(i.id)) : h.items;
      return { items, more: false, unread: h.unread, followUp: followUp() };
    }
    if (path === "/api/inbox/unread") {
      const ids = init!.json!.ids!;
      h.items = h.items.map((i) => (ids.includes(i.id) ? { ...i, read: false } : i));
      h.unread = h.items.filter((i) => !i.read).length;
      return { unread: h.unread };
    }
    if (path === "/api/inbox/follow-up") {
      const ids = init!.json!.ids!;
      h.items = h.items.map((i) => (ids.includes(i.id) ? { ...i, followUp: !!init!.json!.on } : i));
      return { unread: h.unread, followUp: followUp() };
    }
    if (path === "/api/inbox/read") {
      const ids = init?.json?.ids ?? h.items.map((i) => i.id);
      h.items = h.items.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i));
      h.unread = h.items.filter((i) => !i.read).length;
      return { unread: h.unread };
    }
    throw new Error(`unexpected ${path}`);
  },
}; });
vi.mock("./Search", () => ({ GlobalSearch: () => null }));
vi.mock("./AccountMenu", () => ({ AccountProvider: ({ children }: { children: React.ReactNode }) => children, AccountFooter: () => null, useAccountPanel: () => ({ open: false, setOpen() {} }) }));
vi.mock("./TopBarExtras", () => ({ ClockWeather: () => null, ThemeToggle: () => null }));
vi.mock("./Ambient", () => ({ Ambient: () => null }));
vi.mock("./SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));

const { Shell } = await import("./Shell");
const { InboxBell } = await import("./InboxBell");

const user: AccountUser = { id: 7, email: "priya@scout.test", displayName: "Priya", createdAt: "", controlPointLinked: true, controlPoint: { accountId: 9, member: true, teams: [], url: "", workspaces: [{ id: "901", name: "Gearheads", role: "member" }] } };
const item = (id: number, over: Partial<InboxItem> = {}): InboxItem => ({
  id, at: Date.now() - 120_000, workspaceId: "901", workspaceName: "Gearheads", category: "edits", type: "entry.edited", actorName: "Coach",
  title: "Coach edited your entry", body: "team 18360 · match Q1", link: `/scout?space=901&entry=e${id}`, read: false, followUp: false, ...over,
});

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
let phone = false;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width") ? phone : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("EventSource", undefined); // no stream here: the bell polls the count
  localStorage.clear();
  h.user = null; h.unread = 0; h.items = []; h.calls = []; h.failNext = {}; phone = false; where = "";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const shell = () => render(<MemoryRouter initialEntries={["/"]}><Shell><Routes><Route path="*" element={<Where />} /></Routes></Shell></MemoryRouter>);

describe("the bell's place", () => {
  it("signed in: in the header (top right, before the account button), never in the sidebar, the tab bar or the menu sheet", async () => {
    h.user = user;
    shell();
    const bell = await screen.findByRole("button", { name: /^Notifications/ });
    expect(screen.getAllByRole("button", { name: /^Notifications/ })).toHaveLength(1);
    expect(bell.closest("header")).toBe(screen.getByRole("banner"));
    expect(bell.closest("aside")).toBeNull();
    for (const nav of screen.getAllByRole("navigation")) expect(within(nav).queryByRole("button", { name: /^Notifications/ })).toBeNull();
    // The menu sheet (phones' full menu) doesn't carry it either.
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
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
    fireEvent.click(await screen.findByRole("button", { name: /^Coach edited your entry/ }));
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

describe("follow-up state", () => {
  const bell = () => render(<MemoryRouter initialEntries={["/"]}><InboxBell /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  const openPanel = async (unread: number) => {
    bell();
    fireEvent.click(await screen.findByRole("button", { name: unread ? `Notifications, ${unread} unread` : "Notifications" }));
    return screen.findByRole("dialog", { name: "Notifications" });
  };

  it("each item has Mark unread and Follow up toggles with clear names and pressed state", async () => {
    h.user = user; h.unread = 1; h.items = [item(2), item(1, { title: "You were added to Gearheads", category: "membership", read: true, followUp: true })];
    const panel = await openPanel(1);
    const unread2 = await within(panel).findByRole("button", { name: "Mark 'Coach edited your entry' unread" });
    expect(unread2.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByRole("button", { name: "Mark 'You were added to Gearheads' unread" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(panel).getByRole("button", { name: "Follow up on 'Coach edited your entry'" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(panel).getByRole("button", { name: "Follow up on 'You were added to Gearheads'" }).getAttribute("aria-pressed")).toBe("true");
    // Real buttons (keyboard reachable), never nested in the row's open button.
    for (const b of within(panel).getAllByRole("button", { name: /^(Mark|Follow up on) / })) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.parentElement?.closest("button")).toBeNull();
    }
  });

  it("mark unread: the badge goes up, the server hears it, and the item isn't opened", async () => {
    h.user = user; h.unread = 0; h.items = [item(4, { read: true })];
    const panel = await openPanel(0);
    const toggle = await within(panel).findByRole("button", { name: "Mark 'Coach edited your entry' unread" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")?.textContent).toBe("1"));
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
    await waitFor(() => expect(h.calls.find((c) => c.path === "/api/inbox/unread")?.init?.json).toEqual({ ids: [4] }));
    expect(where).toBe("/");
    // Pressed again: read.
    fireEvent.click(toggle);
    await waitFor(() => expect(h.calls.find((c) => c.path === "/api/inbox/read")?.init?.json).toEqual({ ids: [4] }));
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")).toBeNull());
  });

  it("follow up: flags the item without changing the badge; the filter lists flagged items with their count", async () => {
    h.user = user; h.unread = 1; h.items = [item(7), item(6, { title: "Coach assigned you to scout team 18360", category: "assignments", read: true })];
    const panel = await openPanel(1);
    const all = within(panel).getByRole("button", { name: "All" });
    const filter = within(panel).getByRole("button", { name: /^Follow up(, [0-9]+ flagged)?$/ });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(filter.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(await within(panel).findByRole("button", { name: "Follow up on 'Coach assigned you to scout team 18360'" }));
    await waitFor(() => expect(h.calls.find((c) => c.path === "/api/inbox/follow-up")?.init?.json).toEqual({ ids: [6], on: true }));
    expect(document.querySelector("[data-inbox-badge]")?.textContent).toBe("1");
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Follow up, 1 flagged" })).toBeTruthy());

    fireEvent.click(within(panel).getByRole("button", { name: "Follow up, 1 flagged" }));
    await waitFor(() => expect(h.calls.some((c) => c.path.includes("filter=followUp"))).toBe(true));
    await waitFor(() => expect(within(panel).getAllByRole("listitem")).toHaveLength(1));
    expect(within(panel).getByText("Coach assigned you to scout team 18360")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Follow up, 1 flagged" }).getAttribute("aria-pressed")).toBe("true");
    // Mark all read belongs to the whole inbox, not this view.
    expect(within(panel).queryByRole("button", { name: /Mark all read/ })).toBeNull();

    // Unflagged here: it stays on screen (unpressed) so focus isn't lost; it's gone the next time the view opens.
    const flag = within(panel).getByRole("button", { name: "Follow up on 'Coach assigned you to scout team 18360'" });
    fireEvent.click(flag);
    await waitFor(() => expect(h.calls.filter((c) => c.path === "/api/inbox/follow-up").at(-1)?.init?.json).toEqual({ ids: [6], on: false }));
    await waitFor(() => expect(h.calls.some((c) => c.path.includes("filter=followUp") && c.path.includes("keep=6"))).toBe(true));
    expect(within(panel).getByRole("button", { name: "Follow up on 'Coach assigned you to scout team 18360'" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(panel).getByRole("button", { name: "All" }));
    fireEvent.click(within(panel).getByRole("button", { name: /^Follow up(, [0-9]+ flagged)?$/ }));
    expect(await within(panel).findByText("Nothing to follow up")).toBeTruthy();
  });

  it("mark all read leaves follow-up flags alone", async () => {
    h.user = user; h.unread = 2; h.items = [item(9, { followUp: true }), item(8)];
    const panel = await openPanel(2);
    fireEvent.click(await within(panel).findByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Follow up on 'Coach edited your entry'", pressed: true })).toBeTruthy());
    expect(h.calls.some((c) => c.path === "/api/inbox/follow-up")).toBe(false);
  });
});

// V4-PRIVATE-002: a toggle the server refuses (503) is reported on its row, with a Retry, never rolled back silently.
describe("a change that isn't saved", () => {
  const bell = () => render(<MemoryRouter initialEntries={["/"]}><InboxBell /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
  const openPanel = async (unread: number) => {
    bell();
    fireEvent.click(await screen.findByRole("button", { name: unread ? `Notifications, ${unread} unread` : "Notifications" }));
    return screen.findByRole("dialog", { name: "Notifications" });
  };
  const posts = (path: string) => h.calls.filter((c) => c.path === path);
  const title = "Coach assigned you to scout team 18360";

  it("flag refused: back to unflagged with an alert on that row; Retry sends it once more and focus returns to the flag", async () => {
    h.user = user; h.items = [item(7, { read: true }), item(6, { title, category: "assignments", read: true })];
    h.failNext["/api/inbox/follow-up"] = 1;
    const panel = await openPanel(0);
    const flag = await within(panel).findByRole("button", { name: `Follow up on '${title}'` });
    flag.focus();
    fireEvent.click(flag);
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("Couldn't save the follow-up flag.");
    expect(alert.closest("li")).toBe(flag.closest("li"));
    expect(flag.getAttribute("aria-pressed")).toBe("false");
    expect(flag.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(flag);
    expect(where).toBe("/");
    // The other row is untouched.
    expect(within(panel).getByRole("button", { name: "Follow up on 'Coach edited your entry'" }).getAttribute("aria-pressed")).toBe("false");

    const retry = within(alert).getByRole("button", { name: `Retry: follow up on '${title}'` });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(posts("/api/inbox/follow-up")).toHaveLength(2));
    expect(posts("/api/inbox/follow-up")[1].init?.json).toEqual({ ids: [6], on: true });
    await waitFor(() => expect(flag.getAttribute("aria-pressed")).toBe("true"));
    expect(within(panel).queryByRole("alert")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(flag));
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Follow up, 1 flagged" })).toBeTruthy());
    expect(posts("/api/inbox/follow-up")).toHaveLength(2);
  });

  it("unflag refused in the Follow up view: the row stays flagged and on screen, focus stays on its flag", async () => {
    h.user = user; h.items = [item(6, { title, category: "assignments", read: true, followUp: true })];
    const panel = await openPanel(0);
    fireEvent.click(await within(panel).findByRole("button", { name: "Follow up, 1 flagged" }));
    const flag = await within(panel).findByRole("button", { name: `Follow up on '${title}'`, pressed: true });
    h.failNext["/api/inbox/follow-up"] = 1;
    flag.focus();
    fireEvent.click(flag);
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("Couldn't remove the follow-up flag.");
    await waitFor(() => expect(h.calls.filter((c) => c.path.includes("filter=followUp")).at(-1)?.path).toContain("keep=6"));
    const now = within(panel).getByRole("button", { name: `Follow up on '${title}'` });
    expect(now.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(now);
    expect(document.activeElement).not.toBe(document.body);
    expect(h.items[0].followUp).toBe(true);
  });

  it("mark unread refused: the item is read again, the badge with it, and the row says so", async () => {
    h.user = user; h.items = [item(4, { read: true })];
    h.failNext["/api/inbox/unread"] = 1;
    const panel = await openPanel(0);
    const toggle = await within(panel).findByRole("button", { name: "Mark 'Coach edited your entry' unread" });
    fireEvent.click(toggle);
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("Couldn't mark this unread.");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    // The badge animates out.
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")).toBeNull());
    fireEvent.click(within(alert).getByRole("button", { name: "Retry: mark unread 'Coach edited your entry'" }));
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")?.textContent).toBe("1"));
    expect(within(panel).queryByRole("alert")).toBeNull();
  });

  it("mark all read refused: everything is unread again, with one alert and a Retry", async () => {
    h.user = user; h.unread = 2; h.items = [item(9), item(8)];
    h.failNext["/api/inbox/read"] = 1;
    const panel = await openPanel(2);
    fireEvent.click(await within(panel).findByRole("button", { name: /Mark all read/ }));
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("Couldn't mark everything read.");
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")?.textContent).toBe("2"));
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.querySelector("[data-inbox-badge]")).toBeNull());
    expect(posts("/api/inbox/read").map((c) => c.init?.json)).toEqual([{ all: true, upTo: 9 }, { all: true, upTo: 9 }]);
    expect(within(panel).queryByRole("alert")).toBeNull();
  });
});
