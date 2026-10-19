// @vitest-environment jsdom
// Scouting's device store with spaces: personal entries keep their old
// localStorage shape (and old entries still load), workspace entries get their
// own keys, queue, cursor and sync, and pending counts are split by space.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canDeleteScoutEntry, clearLocalScouting, deleteScoutEntry, refusalMessage, SCOUT_REFUSED, type ScoutRefusal, exportLocalScouting, importLocalScouting, localScoutEntries, pendingScoutCounts,
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

  it("an entry stays queued if the server's copy (a newer edit that won) can't be saved on the device", async () => {
    const e = saveScoutEntry({ uuid: "nnnnnnnnnnnn", ...base, workspaceId: "41", notes: "mine, older" });
    server((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true, entry: { ...x, notes: "theirs, newer", updatedAt: x.updatedAt + 1000 } })) }));
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === "cs-scout-ws:41:nnnnnnnnnnnn") throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, k, v);
    });
    try { await syncScouting("41"); } finally { spy.mockRestore(); }
    expect(pendingScoutCounts().workspaces).toEqual({ 41: 1 });
    await syncScouting("41"); // room again: the server's copy lands and the queue clears
    expect(localScoutEntries("41")[0]).toMatchObject({ uuid: e.uuid, notes: "theirs, newer" });
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
    // A restore that can't put every entry back drops the cursor, so the next pull brings them all again.
    clearLocalScouting();
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("cs-scout-ws:41:")) throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, k, v);
    });
    try { importLocalScouting(JSON.parse(JSON.stringify(stash))); } finally { spy.mockRestore(); }
    expect(localStorage.getItem("cs-scout-ws-cursor:41")).toBeNull();
    // A stash written before workspaces (no `spaces`) still imports.
    clearLocalScouting();
    importLocalScouting({ entries: stash.entries, dirty: stash.dirty });
    expect(localScoutEntries().map((e) => e.uuid)).toEqual(["llllllllllll"]);
  });
});

describe("workspace permissions on the device", () => {
  /** The server's copy as a refused write gets it back. */
  const theirs = (x: ScoutEntry, over: Partial<ScoutEntry> = {}) => ({ ...x, deleted: false, data: { auto: 3 }, notes: "A's note", updatedAt: 500, authorAccountId: 7, authorDisplayName: "Priya", editorAccountId: 7, editorDisplayName: "Priya", ...over });
  const refusals = () => {
    const got: ScoutRefusal[] = [];
    const fn = (ev: Event) => got.push((ev as CustomEvent<ScoutRefusal>).detail);
    window.addEventListener(SCOUT_REFUSED, fn);
    return { got, off: () => window.removeEventListener(SCOUT_REFUSED, fn) };
  };

  it("a refused delete puts the server's copy back, clears the queue and says why", async () => {
    const e = saveScoutEntry({ uuid: "pppppppppppp", ...base, workspaceId: "41", authorAccountId: 7, authorDisplayName: "Priya" });
    deleteScoutEntry(e);
    expect(localScoutEntries("41")[0].deleted).toBe(true);
    server((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: false, error: "forbidden", entry: theirs(x) })) }));
    const r = refusals();
    try { await syncScouting("41"); } finally { r.off(); }
    expect(localScoutEntries("41")[0]).toMatchObject({ uuid: e.uuid, deleted: false, notes: "A's note", authorAccountId: 7 });
    expect(pendingScoutCounts().workspaces).toEqual({});
    expect(r.got).toEqual([{ space: "41", uuid: e.uuid, kind: "delete" }]);
    expect(refusalMessage(r.got[0])).toMatch(/^Only the author or a workspace admin can delete this entry/);
  });

  it("a refused edit of an entry deleted meanwhile takes the tombstone and says so", async () => {
    const e = saveScoutEntry({ uuid: "qqqqqqqqqqqq", ...base, workspaceId: "41", authorAccountId: 7, authorDisplayName: "Priya" });
    server((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: false, error: "forbidden", entry: theirs(x, { deleted: true, data: {}, notes: "" }) })) }));
    const r = refusals();
    try { await syncScouting("41"); } finally { r.off(); }
    expect(localScoutEntries("41")[0]).toMatchObject({ uuid: e.uuid, deleted: true });
    expect(r.got.map((x) => x.kind)).toEqual(["edit-deleted"]);
    expect(refusalMessage(r.got[0])).toMatch(/deleted by its author or a workspace admin/);
  });

  it("a refusal in an early batch is announced even if a later batch's request fails", async () => {
    const first = saveScoutEntry({ uuid: "tttttttttttt", ...base, workspaceId: "41", authorAccountId: 7 });
    deleteScoutEntry(first);
    for (let i = 0; i < 200; i++) saveScoutEntry({ uuid: `u${String(i).padStart(11, "0")}`, ...base, workspaceId: "41" });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_p: string, init?: RequestInit) => {
      if (++calls > 1) return new Response(JSON.stringify({ error: "down" }), { status: 500, headers: { "Content-Type": "application/json" } });
      const body = JSON.parse(String(init!.body));
      const results = body.entries.map((x: ScoutEntry) => (x.uuid === first.uuid ? { uuid: x.uuid, ok: false, error: "forbidden", entry: theirs(x) } : { uuid: x.uuid, ok: true }));
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const r = refusals();
    try { await expect(syncScouting("41")).rejects.toBeTruthy(); } finally { r.off(); }
    expect(r.got.map((x) => x.uuid)).toEqual([first.uuid]);
    expect(localScoutEntries("41").find((e) => e.uuid === first.uuid)).toMatchObject({ deleted: false });
  });

  it("a refused delete of something already deleted is quiet", async () => {
    const e = saveScoutEntry({ uuid: "rrrrrrrrrrrr", ...base, workspaceId: "41", authorAccountId: 7 });
    deleteScoutEntry(e);
    server((_p, body) => ({ results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: false, error: "forbidden", entry: theirs(x, { deleted: true }) })) }));
    const r = refusals();
    try { await syncScouting("41"); } finally { r.off(); }
    expect(r.got).toEqual([]);
    expect(pendingScoutCounts().workspaces).toEqual({});
  });

  it("who sees Delete: personal always; in a workspace the author (or an unsynced entry) and admins", () => {
    const ws = (authorAccountId: number) => ({ uuid: "ssssssssssss", ...base, workspaceId: "41", updatedAt: 1, authorAccountId, authorDisplayName: "" }) as ScoutEntry;
    expect(canDeleteScoutEntry({ ...ws(0), workspaceId: null }, null)).toBe(true);
    expect(canDeleteScoutEntry(ws(7), { accountId: 7, role: "member" })).toBe(true);
    expect(canDeleteScoutEntry(ws(7), { accountId: 8, role: "member" })).toBe(false);
    expect(canDeleteScoutEntry(ws(0), { accountId: 8, role: "member" })).toBe(true);
    expect(canDeleteScoutEntry(ws(7), { accountId: 8, role: "admin" })).toBe(true);
    expect(canDeleteScoutEntry(ws(7), { accountId: 7 })).toBe(false); // not a member any more
    expect(canDeleteScoutEntry(ws(7), { role: "member" })).toBe(false); // an older server without accountId
  });
});

// Audit PRIVATE-F01 / PRIVATE-F02: rows stored before the checks (src/shared/scoutEntry.ts) are read repaired.
describe("stored rows with bad values", () => {
  it("a workspace copy stamped 1e300 is read as 0, and the next edit is stamped now (a time the server accepts)", () => {
    localStorage.setItem("cs-scout-ws:41:poisoned0001", JSON.stringify({ uuid: "poisoned0001", ...base, updatedAt: 1e300, workspaceId: "41", authorAccountId: 7, authorDisplayName: "Priya" }));
    expect(localScoutEntries("41")[0]).toMatchObject({ uuid: "poisoned0001", updatedAt: 0, notes: "fast" });
    const before = Date.now();
    const e = saveScoutEntry({ ...localScoutEntries("41")[0], notes: "edited" });
    expect(e.updatedAt).toBeGreaterThanOrEqual(before);
    expect(e.updatedAt).toBeLessThanOrEqual(Date.now());
  });

  it("a copy from the server with notes or answers of the wrong type is stored repaired", async () => {
    server(() => ({ entries: [{ uuid: "fromserver01", ...base, notes: { invalid: "object" }, data: { auto: { x: 1 } }, updatedAt: 10, workspaceId: "41" }], cursor: 1, more: false }));
    await pullScouting("41");
    expect(localScoutEntries("41")[0]).toMatchObject({ notes: '{"invalid":"object"}', data: { auto: '{"x":1}' } });
  });

  it("a row with no usable identity is hidden, not removed; a JSON-broken one too", () => {
    localStorage.setItem("cs-scout:noteamrow001", JSON.stringify({ uuid: "noteamrow001", ...base, team: "abc", updatedAt: 1 }));
    localStorage.setItem("cs-scout:brokenrow001", "{");
    expect(localScoutEntries()).toEqual([]);
    expect(localStorage.getItem("cs-scout:noteamrow001")).not.toBeNull();
    expect(localStorage.getItem("cs-scout:brokenrow001")).toBe("{");
  });
});
