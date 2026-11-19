// @vitest-environment jsdom
// The v8 shell (docs/design/v8-revamp-brief.md §6): with <html data-v8> the sidebar is the Gemini-like one (mark, name,
// one round fold button, the pages, nothing at its foot), your picture top-right opens Settings, What's new, the owner
// console and your account, there's no light/dark switch, Report a bug is a corner circle, and the wash is tall on a
// top-level page and short inside one. Without it, the shell is as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetFlags } from "../../lib/flags";
import { washSize } from "./Wash";

type User = { id: number; email: string; displayName: string | null; createdAt: string; isOwner?: boolean; avatarUrl?: string | null };
const personal = vi.hoisted(() => ({ user: null as null | User, sync: "local", offlineAccount: false, signOut: vi.fn(async () => {}) }));
vi.mock("../../lib/personal", () => ({ SIGNED_IN: "cs-signed-in", usePersonal: () => ({ ...personal, providers: {}, state: { myTeam: null, settings: { theme: "dark" } }, update: () => true, syncReady: false }) }));
vi.mock("./Search", () => ({ GlobalSearch: () => null }));
vi.mock("./TopBarExtras", () => ({ ClockWeather: () => null, showsClockWeather: () => false }));
vi.mock("./InboxBell", () => ({ InboxBell: () => null }));
vi.mock("./Ambient", () => ({ Ambient: () => <div data-ambient /> }));
vi.mock("./SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null, useMediaQuery: () => true }));

const { Shell } = await import("./Shell");
const shell = (at = "/events") => render(<MemoryRouter initialEntries={[at]}><Shell><Routes><Route path="*" element={<p>page</p>} /></Routes></Shell></MemoryRouter>);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("EventSource", undefined);
  localStorage.clear();
  personal.user = null;
  document.documentElement.setAttribute("data-v8", "");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetFlags(); document.documentElement.removeAttribute("data-v8"); });

describe("v8 shell", () => {
  it("has the Gemini-like sidebar: the mark and name, one fold button, the pages, nothing at its foot", () => {
    const { container } = shell();
    const side = container.querySelector("[data-v8-sidebar]") as HTMLElement;
    expect(side).toBeTruthy();
    expect(within(side).getByRole("link", { name: "Control Scout home" }).querySelector("img")!.getAttribute("src")).toBe("/mark-white.webp");
    expect(within(side).getByRole("link", { name: "Events" })).toBeTruthy();
    expect(side.textContent).not.toMatch(/What.s new|Sign in|Settings|Owner console/);
    fireEvent.click(within(side).getByRole("button", { name: "Collapse sidebar" }));
    expect(side.hasAttribute("data-rail")).toBe(true);
    expect(localStorage.getItem("cs-sidebar")).toBe("1");
  });

  it("lights the current page without the sliding spring", () => {
    const { container } = shell("/events");
    const side = container.querySelector("[data-v8-sidebar]") as HTMLElement;
    expect(within(side).getByRole("link", { name: "Events" }).querySelector("[data-nav-pill]")).toBeTruthy();
  });

  it("puts your picture top-right: a guest one that signs in, with Settings and What's new above", () => {
    const { container } = shell();
    const header = container.querySelector("header") as HTMLElement;
    const me = within(header).getByRole("button", { name: "Sign in" });
    expect(me.hasAttribute("data-profile")).toBe(true);
    expect(me.querySelector("[data-guest]")).toBeTruthy();
    fireEvent.click(me);
    const links = container.querySelector("[data-corner-links]") as HTMLElement;
    expect([...links.querySelectorAll("a, button")].map((e) => e.textContent?.trim())).toEqual(["Settings", "What’s new"]);
  });

  it("adds the owner console to the owner's menu only", () => {
    personal.user = { id: 1, email: "owner@example.test", displayName: "Owner", createdAt: "", isOwner: true };
    const { container } = shell();
    fireEvent.click(within(container.querySelector("header") as HTMLElement).getByRole("button", { name: "Account: Owner" }));
    expect(container.querySelector("[data-corner-links] [data-owner-console]")).toBeTruthy();
  });

  it("drops the light/dark switch and the old ambient layer, and puts Report a bug in the corner", () => {
    const { container } = shell();
    expect(screen.queryByRole("button", { name: /light|dark/i })).toBeNull();
    expect(container.querySelector("[data-ambient]")).toBeNull();
    expect(container.querySelector("[data-corner][data-testid='bug-report-button']")).toBeTruthy();
  });

  it("washes the top: tall on a top-level page, short inside one", () => {
    expect(shell("/events").container.querySelector("[data-wash]")!.getAttribute("data-wash")).toBe("tall");
    cleanup();
    expect(shell("/teams/4215").container.querySelector("[data-wash]")!.getAttribute("data-wash")).toBe("short");
    expect([washSize("/"), washSize("/teams"), washSize("/teams/4215"), washSize("/events/2026/USNJ/")]).toEqual(["tall", "tall", "short", "short"]);
  });
});

describe("without v8", () => {
  it("keeps the shell as it was", () => {
    document.documentElement.removeAttribute("data-v8");
    const { container } = shell();
    expect(container.querySelector("[data-v8-sidebar]")).toBeNull();
    expect(container.querySelector("[data-wash]")).toBeNull();
    expect(container.querySelector("[data-ambient]")).toBeTruthy();
    expect(container.querySelector("header [data-profile]")).toBeNull();
  });
});

describe("v8 Rankings in the sidebar", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  it("opens its sub-pages on the Rankings page and on a sub-page", () => {
    for (const at of ["/rankings", "/rankings/regions"]) {
      const { container } = shell(at);
      const side = container.querySelector("[data-v8-sidebar]") as HTMLElement;
      expect(within(side).getByRole("group", { name: "More rankings" }).hidden).toBe(false);
      cleanup();
    }
  });
  it("stays shut elsewhere", () => {
    const { container } = shell("/events");
    const side = container.querySelector("[data-v8-sidebar]") as HTMLElement;
    expect((side.querySelector("[aria-label='More rankings']") as HTMLElement).hidden).toBe(true);
  });
});
