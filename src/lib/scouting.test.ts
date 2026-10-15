// @vitest-environment jsdom
// Scouting's device store with spaces: personal entries keep their old
// localStorage shape (and old entries still load), workspace entries get their
// own keys, queue, cursor and sync, and pending counts are split by space.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalScouting, deleteScoutEntry, exportLocalScouting, importLocalScouting, localScoutEntries, pendingScoutCounts,
  pullScouting, saveScoutEntry, syncScouting, type ScoutEntry,
} from "./scouting";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const base = { season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: { auto: 3 }, notes: "fast" };

/** A fake server: records requests, answers from `answer`. */
function server(answer: (path: string, body: any) => unknown) {
  const calls: { path: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    return new Response(JSON.stringify(answer(path, body)), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

describe("scouting spaces on the device", () => {
  it("an entry saved before workspaces still loads, as a personal entry", () => {
    const old = { uuid: "aaaaaaaaaaaa", ...base, updatedAt: 1000 };
    localStorage.setItem("cs-scout:aaaaaaaaaaaa", JSON.stringify(old));
    expect(localScoutEntries()).toEqual([{ ...old, workspaceId: null, authorAccountId: 0, authorDisplayName: "" }]);
  });

  it("personal entries are stored exactly as before (no new fields), in the same queue", () => {
    const e = saveScoutEntry({ uuid: "bbbbbbbbbbbb", ...base });
    expect(JSON.parse(localStorage.getItem("cs-scout:bbbbbbbbbbbb")!)).toEqual({ uuid: "bbbbbbbbbbbb", ...base, updatedAt: e.updatedAt });
    expect(localStorage.getItem("cs-scout:bbbbbbbbbbbb")).toBe(JSON.stringify({ uuid: "bbbbbbbbbbbb", ...base, updatedAt: e.updatedAt }));
    expect(JSON.parse(localStorage.getItem("cs-scout-dirty")!)).toEqual(["bbbbbbbbbbbb"]);
    expect(e).toMatchObject({ workspaceId: null, authorAccountId: 0, authorDisplayName: "" });
  });

  it("workspace entries live in their own space: own keys, own queue, counts split by space", () => {
    saveScoutEntry({ uuid: "cccccccccccc", ...base });
    saveScoutEntry({ uuid: "dddddddddddd", ...base, workspaceId: "41" });
    saveScoutEntry({ uuid: "eeeeeeeeeeee", ...base, workspaceId: "41" });
    saveScoutEntry({ uuid: "ffffffffffff", ...base, workspaceId: "42" });
    expect(localScoutEntries().map((e) => e.uuid)).toEqual(["cccccccccccc"]); // Personal (what the Scout page shows today)
    expect(localScoutEntries("41").map((e) => e.uuid).sort()).toEqual(["dddddddddddd", "eeeeeeeeeeee"]);
    expect(localScoutEntries("41")[0].workspaceId).toBe("41");
    expect(pendingScoutCounts()).toEqual({ personal: 1, workspaces: { 41: 2, 42: 1 } });
  });

  it("pushes a workspace's queue with its workspaceId and adopts the server's stored copy", async () => {
    const e = saveScoutEntry({ uuid: "gggggggggggg", ...base, workspaceId: "41" });
    const calls = server((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: { ...x, authorAccountId: 7, authorDisplayName: "Priya", editorAccountId: 7, editorDisplayName: "Priya" } })) }));
    await syncScouting("41");
    expect(calls[0].path).toBe("/api/me/scout/sync");
    expect(calls[0].body.workspaceId).toBe("41");
    expect(calls[0].body.entries.map((x: ScoutEntry) => x.uuid)).toEqual([e.uuid]);
    expect(localScoutEntries("41")[0]).toMatchObject({ uuid: e.uuid, authorAccountId: 7, authorDisplayName: "Priya" });
    expect(pendingScoutCounts().workspaces).toEqual({});
  });

  it("the personal push is unchanged on the wire (no workspaceId, entries in their old shape)", async () => {
    const e = saveScoutEntry({ uuid: "hhhhhhhhhhhh", ...base });
    const calls = server(() => ({ results: [{ uuid: e.uuid, ok: true }] }));
    await syncScouting();
    expect(calls[0].body).toEqual({ entries: [{ uuid: e.uuid, ...base, updatedAt: e.updatedAt }] });
    expect(pendingScoutCounts().personal).toBe(0);
  });

  it("pulls a workspace by cursor, pages through, and merges newer-wins (keeping a newer queued edit)", async () => {
    const mine = saveScoutEntry({ uuid: "iiiiiiiiiiii", ...base, workspaceId: "41", notes: "mine, newer" });
    const pages = [
      { entries: [{ uuid: "jjjjjjjjjjjj", ...base, workspaceId: "41", updatedAt: 10, authorAccountId: 9, authorDisplayName: "Marcus" }, { uuid: mine.uuid, ...base, notes: "theirs, older", updatedAt: 5 }], cursor: 2, more: true },
      { entries: [{ uuid: "kkkkkkkkkkkk", ...base, updatedAt: 20, deleted: true, data: {}, notes: "" }], cursor: 3, more: false },
    ];
    const calls = server(() => pages.shift());
    await pullScouting("41");
    expect(calls.map((c) => c.path)).toEqual(["/api/scout/sync?workspaceId=41&since=0", "/api/scout/sync?workspaceId=41&since=2"]);
    expect(localStorage.getItem("cs-scout-ws-cursor:41")).toBe("3");
    const got = Object.fromEntries(localScoutEntries("41").map((e) => [e.uuid, e]));
    expect(got.jjjjjjjjjjjj).toMatchObject({ authorDisplayName: "Marcus", workspaceId: "41" });
    expect(got[mine.uuid].notes).toBe("mine, newer");
    expect(got.kkkkkkkkkkkk.deleted).toBe(true); // tombstones arrive too
    expect(localScoutEntries()).toEqual([]); // nothing leaked into Personal
  });

  it("export / clear / import carry every space (an account's stash on account switch)", () => {
    saveScoutEntry({ uuid: "llllllllllll", ...base });
    const w = saveScoutEntry({ uuid: "mmmmmmmmmmmm", ...base, workspaceId: "41" });
    deleteScoutEntry(w);
    localStorage.setItem("cs-scout-ws-cursor:41", "12");
    const stash = exportLocalScouting();
    clearLocalScouting();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("cs-scout"))).toEqual([]);
    importLocalScouting(JSON.parse(JSON.stringify(stash)));
    expect(localScoutEntries().map((e) => e.uuid)).toEqual(["llllllllllll"]);
    expect(localScoutEntries("41")[0]).toMatchObject({ uuid: "mmmmmmmmmmmm", deleted: true });
    expect(pendingScoutCounts()).toEqual({ personal: 1, workspaces: { 41: 1 } });
    expect(localStorage.getItem("cs-scout-ws-cursor:41")).toBe("12");
    // A stash written before workspaces (no `spaces`) still imports.
    clearLocalScouting();
    importLocalScouting({ entries: stash.entries, dirty: stash.dirty });
    expect(localScoutEntries().map((e) => e.uuid)).toEqual(["llllllllllll"]);
  });
});
