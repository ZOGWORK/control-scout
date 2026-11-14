// @vitest-environment jsdom
// The one offline indicator: nothing while online; "Offline · <time>" or "No internet on this Wi-Fi" otherwise, and a
// small panel with what's on the device, Try again and Downloads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectionPill, newestSaved, pillText, updatedLabel } from "./ConnectionStatus";
import { DEMO_KEY, checkInternet, resetConnection } from "../lib/connection";
import { writeSaved } from "../lib/offline/saved";

const pill = () => render(<MemoryRouter><ConnectionPill place="wide" /></MemoryRouter>);

beforeEach(() => { localStorage.clear(); resetConnection(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetConnection(); });

describe("words", () => {
  it("today's time, else the day", () => {
    const now = new Date(2026, 10, 13, 21, 0);
    expect(updatedLabel(new Date(2026, 10, 13, 20, 9).toISOString(), now)).toMatch(/8:09/);
    expect(updatedLabel(new Date(2026, 10, 12, 20, 9).toISOString(), now)).toBe("Nov 12, 2026");
  });
  it("offline with a time, offline without one, and a portal", () => {
    const now = new Date(2026, 10, 13, 21, 0);
    expect(pillText({ internet: "no" }, new Date(2026, 10, 13, 20, 9).toISOString(), now)).toMatchObject({ short: "Offline", time: expect.stringMatching(/8:09/) });
    expect(pillText({ internet: "no" }, null, now)).toEqual({ short: "Offline", long: "Offline", time: null });
    expect(pillText({ internet: "portal" }, null, now).short).toBe("No internet on this Wi-Fi");
  });
  it("the newest saved thing's data time", () => {
    expect(newestSaved(
      [{ season: 2025, version: "v", sha256: "a", bytes: 1, savedAt: 0, dataAsOf: "2026-11-10T00:00:00.000Z", builtAt: "" }],
      [{ season: 2025, code: "X", name: "X", end: null, version: "v", sha256: "a", bytes: 1, savedAt: 0, builtAt: "2026-11-12T00:00:00.000Z", dataAsOf: "2026-11-12T20:09:00.000Z", team: null, workspace: null, reports: 0, picklist: false } as never],
      { version: "v", bytes: 1, savedAt: 0, builtAt: "2026-11-11T00:00:00.000Z", engineVersion: "x" },
    )).toBe("2026-11-12T20:09:00.000Z");
    expect(newestSaved([], [], null)).toBeNull();
  });
});

describe("the pill", () => {
  it("shows nothing while online", () => {
    pill();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offline: says so with the saved data's time; the panel lists what's here, and Try again checks", async () => {
    writeSaved([{ season: 2025, version: "v", sha256: "a", bytes: 1, savedAt: 0, dataAsOf: new Date().toISOString(), builtAt: "" }]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await act(async () => { await checkInternet(); });
    pill();
    const btn = screen.getByRole("button", { name: /^Offline, data updated .+ Show what's on this device$/ });
    expect(btn.textContent).toMatch(/Offline· updated \d/);
    fireEvent.click(btn);
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText("2025–26 season")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Downloads" }).getAttribute("href")).toBe("/download");
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetch);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Try again/ })); });
    expect(fetch).toHaveBeenCalledWith("/api/health", expect.anything());
    expect(await screen.findByText("Still no internet.")).toBeTruthy();
  });

  it("a Wi-Fi sign-in page (the screenshot setting too) says there's no internet on this Wi-Fi", () => {
    localStorage.setItem(DEMO_KEY, "portal");
    pill();
    expect(screen.getByRole("button").textContent).toBe("No internet on this Wi-Fi");
  });
  it("below xl the wide pill is the icon alone, in the bar's own flow, so it never covers the search box", () => {
    localStorage.setItem(DEMO_KEY, "portal");
    pill();
    const box = screen.getByRole("status");
    expect(box.className).toMatch(/xl:absolute/);
    expect(box.className.split(" ")).not.toContain("absolute"); // floating only from xl up
    const words = screen.getByText("No internet on this Wi-Fi");
    expect(words.className).toContain("max-xl:hidden");
  });
});
