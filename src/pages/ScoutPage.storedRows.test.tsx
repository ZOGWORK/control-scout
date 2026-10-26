// @vitest-environment jsdom
// Audit PRIVATE-F02: rows stored on the device with the wrong types (object notes from an import before the
// checks, a 1e300 timestamp, an answer that's an object, a row that isn't JSON) never crash the Scout page.
// Each valid observation shows, the bad field is repaired and written back, the unreadable row is hidden but
// kept in storage, and the scout is told once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TooltipProvider } from "../components/ui/overlay";
import { asEntries } from "./scoutTestUrl";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: true, state: { videoLinks: {} } },
  warnings: [] as string[],
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));
vi.mock("../components/ui/sonner", async (orig) => {
  const real = await orig<typeof import("../components/ui/sonner")>();
  return { ...real, toast: Object.assign((..._a: unknown[]) => undefined, real.toast, { warning: (t: string) => { h.warnings.push(t); } }) };
});

const { default: ScoutPage } = await import("./ScoutPage");

const row = (uuid: string, over: Record<string, unknown>) => JSON.stringify({ uuid, season: 2025, team: 101, eventCode: "AUDIT1", matchLabel: "Q1", kind: "match", data: {}, notes: "", updatedAt: 1000, ...over });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  h.warnings.length = 0;
  resetFlags({ ...DEFAULT_FLAGS });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[asEntries(url)]}><ScoutPage /></MemoryRouter></TooltipProvider>);

describe("rows stored with bad values", () => {
  it("object notes, a 1e300 timestamp and an object answer: the page renders every observation and says what it repaired", async () => {
    localStorage.setItem("cs-scout:auditimport1", row("auditimport1", { notes: { invalid: "object" } }));
    localStorage.setItem("cs-scout:auditpoison01", row("auditpoison01", { team: 202, notes: "keep me", updatedAt: 1e300, data: { auto: 3, weird: { a: 1 } } }));
    localStorage.setItem("cs-scout:auditbroken1", "{not json");
    localStorage.setItem("cs-scout:audithealth1", row("audithealth1", { team: 303, notes: "healthy" }));
    show("/scout?season=2025");
    expect(await screen.findByText("303")).toBeTruthy();
    expect(screen.getByText("101")).toBeTruthy();
    expect(screen.getByText("202")).toBeTruthy();
    expect(screen.queryByText(/hit a problem/i)).toBeNull();
    // Repaired on the device: the notes kept as text, the timestamp superseded by anything, the answer as text.
    expect(JSON.parse(localStorage.getItem("cs-scout:auditimport1")!).notes).toBe('{"invalid":"object"}');
    expect(JSON.parse(localStorage.getItem("cs-scout:auditpoison01")!)).toMatchObject({ updatedAt: 0, notes: "keep me", data: { auto: 3, weird: '{"a":1}' } });
    // The unreadable row is hidden, not removed.
    expect(localStorage.getItem("cs-scout:auditbroken1")).toBe("{not json");
    await waitFor(() => expect(h.warnings).toEqual([
      "2 scouting entries on this device had damaged fields and were repaired. The observations were kept. 1 scouting entry on this device couldn't be read and is hidden. Nothing was deleted.",
    ]));
  });

  it("a repair that can't be stored (storage full) is still reported only once", async () => {
    localStorage.setItem("cs-scout:auditfull0001", row("auditfull0001", { notes: { invalid: "object" } }));
    const { localScoutEntries } = await import("../lib/scouting");
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    try {
      for (let i = 0; i < 3; i++) expect(localScoutEntries()[0].notes).toBe('{"invalid":"object"}');
      await new Promise((r) => setTimeout(r, 10));
      for (let i = 0; i < 3; i++) localScoutEntries();
      await new Promise((r) => setTimeout(r, 10));
    } finally { set.mockRestore(); }
    expect(h.warnings).toEqual(["1 scouting entry on this device had damaged fields and was repaired. The observations were kept."]);
  });

  it("stays working after a reload (the repaired rows are stored repaired: nothing more to say)", async () => {
    localStorage.setItem("cs-scout:auditreload01", row("auditreload01", { notes: { invalid: "object" } }));
    show("/scout?season=2025");
    expect(await screen.findByText("101")).toBeTruthy();
    await waitFor(() => expect(h.warnings.length).toBe(1));
    cleanup();
    h.warnings.length = 0;
    show("/scout?season=2025");
    expect(await screen.findByText("101")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.warnings).toEqual([]);
  });
});
