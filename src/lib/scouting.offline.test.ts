// @vitest-environment jsdom
// Scouting with no signal (the offline + Lite brief, journey 5): entries saved offline wait in the device's outbox,
// survive the app being closed and opened again, and go up once the signal is back, each exactly once, under the
// same id they were made with (the server keeps one entry per id, server/auth/auth.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { localStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

const base = { season: 2026, eventCode: "AUBRQ1", matchLabel: "Q1", kind: "match" as const, data: { autoLeave: true }, notes: "" };

describe("the scouting outbox with no signal", () => {
  it("survives a reload, then sends each entry once with its own id; a second sync sends nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const first = await import("./scouting");
    const made = [23332, 18439, 11506, 12993].map((team) => first.saveScoutEntry({ uuid: first.newScoutId(), team, ...base, workspaceId: "41" }));
    await first.syncScouting("41").catch(() => {});
    expect(first.pendingScoutCounts().workspaces).toEqual({ 41: 4 });

    // The app is closed and opened again (fresh modules, the same storage), still offline: all four still queued.
    vi.resetModules();
    const again = await import("./scouting");
    expect(again.pendingScoutCounts().workspaces).toEqual({ 41: 4 });
    expect(again.localScoutEntries("41").map((e) => e.uuid).sort()).toEqual(made.map((e) => e.uuid).sort());

    // Back online: one push carries each entry once, by the id it was made with.
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_p: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push(...body.entries.map((x: { uuid: string }) => x.uuid));
      return new Response(JSON.stringify({ results: body.entries.map((x: { uuid: string }) => ({ uuid: x.uuid, ok: true, entry: x })) }), { status: 200 });
    }));
    await again.syncScouting("41");
    expect(sent.sort()).toEqual(made.map((e) => e.uuid).sort());
    expect(again.pendingScoutCounts().workspaces).toEqual({});
    await again.syncScouting("41");
    expect(sent).toHaveLength(4);
  });

  it("an answer lost on the way back keeps the entries queued, and the retry sends the same ids", async () => {
    const s = await import("./scouting");
    const e = s.saveScoutEntry({ uuid: s.newScoutId(), team: 23332, ...base, workspaceId: "41" });
    const ids: string[] = [];
    // The request reaches the server, the answer doesn't (the wifi dropped).
    vi.stubGlobal("fetch", vi.fn(async (_p: string, init?: RequestInit) => {
      ids.push(...JSON.parse(String(init?.body)).entries.map((x: { uuid: string }) => x.uuid));
      throw new TypeError("Failed to fetch");
    }));
    await s.syncScouting("41").catch(() => {});
    expect(s.pendingScoutCounts().workspaces).toEqual({ 41: 1 });
    vi.stubGlobal("fetch", vi.fn(async (_p: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      ids.push(...body.entries.map((x: { uuid: string }) => x.uuid));
      return new Response(JSON.stringify({ results: body.entries.map((x: { uuid: string }) => ({ uuid: x.uuid, ok: true, entry: x })) }), { status: 200 });
    }));
    await s.syncScouting("41");
    expect(ids.every((id) => id === e.uuid)).toBe(true);
    expect(s.pendingScoutCounts().workspaces).toEqual({});
  });
});
