// The video library against the real app on an in-memory database: Saved, Watch later and History a person keeps,
// notes on a video at a moment, what one video's page reads, and that nobody reads or writes anyone else's.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { deleteUser, sha256 } from "../auth/session";
import { cleanItem, HISTORY_CAP, LIBRARY_PAGE, type LibraryCounts, type LibraryItemState, type LibraryPage, type NotesPage, type VideoNote } from "../../src/shared/videoLibrary";
import { cpNote, putLibrary } from "./videoLibrary";

let server: Server;
let base = "";
let n = 0;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function account() {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [`lib${++n}@example.test`, new Date().toISOString()]);
  const id = Number(u!.id);
  const t = `tok-lib-${n}-${Math.random()}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return { id, cookie: `cs_session=${t}` };
}
const call = async <T = unknown>(method: string, path: string, cookie?: string, body?: unknown) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { "X-CS-Test": "1", ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
};
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`;
const card = (i: number, extra: Record<string, unknown> = {}) => ({
  key: `c:${vid(i)}`, kind: "creator", source: "behindTheBot", videoId: vid(i), t: 0, title: `Episode ${i}`, thumb: `https://i.ytimg.com/vi/${vid(i)}/hqdefault.jpg`,
  teams: [21229], published: "2026-11-18T23:30:38Z", reason: "Behind the Bot", channel: "FUN Robotics Network", series: "behind-the-bot", duration: 900, ...extra,
});

describe("cleanItem", () => {
  it("keeps what a card draws and drops what could point elsewhere", () => {
    const c = cleanItem(card(1, { href: "javascript:alert(1)", thumb: "https://evil.example/x.jpg", event: { season: 2025, code: "USNJQ1", name: "NJ", href: "//evil.example" }, extra: "x" }))!;
    expect(c.href).toBeUndefined();
    expect(c.thumb).toBe(`https://i.ytimg.com/vi/${vid(1)}/hqdefault.jpg`);
    expect(c.event).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(c.reason).toBe("");
    expect(cleanItem(card(2, { href: "/matches/2025/USNJQ1/qual/0/12" }))!.href).toBe("/matches/2025/USNJQ1/qual/0/12");
    expect(cleanItem({ ...card(3), key: "../x" })).toBeNull();
    expect(cleanItem({ ...card(3), videoId: "short" })).toBeNull();
    expect(cleanItem({ ...card(3), title: "  " })).toBeNull();
  });
});

describe("the video library", () => {
  it("is for signed-in people only, and writes are JSON", async () => {
    expect((await call("GET", "/videos/library?list=saved")).status).toBe(401);
    expect((await call("PUT", "/videos/library/saved", undefined, { item: card(1) })).status).toBe(401);
    expect((await call("GET", "/videos/notes")).status).toBe(401);
    const me = await account();
    const r = await fetch(`${base}/api/videos/library/saved`, { method: "PUT", headers: { "content-type": "text/plain", "X-CS-Test": "1", cookie: me.cookie }, body: "x" });
    expect(r.status).toBe(415);
  });

  it("saves, queues and removes; a list reads newest first, a page at a time", async () => {
    const me = await account();
    for (let i = 1; i <= LIBRARY_PAGE + 3; i++) await putLibrary(me.id, "later", cleanItem(card(i))!, Date.parse("2026-11-01T00:00:00Z") + i * 1000);
    const p1 = await call<LibraryPage>("GET", "/videos/library?list=later", me.cookie);
    expect(p1.body.items.length).toBe(LIBRARY_PAGE);
    expect(p1.body.items[0].item.title).toBe(`Episode ${LIBRARY_PAGE + 3}`);
    const p2 = await call<LibraryPage>("GET", `/videos/library?list=later&cursor=${encodeURIComponent(p1.body.next!)}`, me.cookie);
    expect(p2.body.items.map((e) => e.item.title)).toEqual(["Episode 3", "Episode 2", "Episode 1"]);
    expect(p2.body.next).toBeNull();

    expect((await call("PUT", "/videos/library/saved", me.cookie, { item: card(1) })).status).toBe(200);
    expect((await call("PUT", "/videos/library/saved", me.cookie, { item: { nope: 1 } })).status).toBe(400);
    expect((await call("PUT", "/videos/library/elsewhere", me.cookie, { item: card(1) })).status).toBe(400);
    const st = await call<LibraryItemState>("GET", `/videos/library/item?key=${encodeURIComponent(`c:${vid(1)}`)}`, me.cookie);
    expect(st.body.lists.sort()).toEqual(["later", "saved"]);
    expect((await call("DELETE", `/videos/library/saved/${encodeURIComponent(`c:${vid(1)}`)}`, me.cookie)).status).toBe(200);
    const counts = await call<LibraryCounts>("GET", "/videos/library/counts", me.cookie);
    expect(counts.body).toEqual({ saved: 0, later: LIBRARY_PAGE + 3, history: 0, notes: 0 });
  });

  it("keeps history to its cap and clears it", async () => {
    const me = await account();
    const t0 = Date.parse("2026-11-01T00:00:00Z");
    for (let i = 0; i < HISTORY_CAP + 2; i++) await putLibrary(me.id, "history", cleanItem(card(i))!, t0 + i);
    expect((await get<{ n: number }>("SELECT COUNT(*) AS n FROM video_library WHERE user_id = ? AND list = 'history'", [me.id]))!.n).toBe(HISTORY_CAP);
    // Watched again: back on top, still once.
    await putLibrary(me.id, "history", cleanItem(card(5))!, t0 + 10_000);
    const top = await call<LibraryPage>("GET", "/videos/library?list=history", me.cookie);
    expect(top.body.items[0].item.key).toBe(`c:${vid(5)}`);
    expect((await call("DELETE", "/videos/library/history", me.cookie)).status).toBe(200);
    expect((await call<LibraryPage>("GET", "/videos/library?list=history", me.cookie)).body.items).toEqual([]);
  });

  it("takes notes at a moment, edits and deletes them, and keeps them to their writer", async () => {
    const me = await account(), other = await account();
    const a = await call<{ note: VideoNote }>("POST", "/videos/notes", me.cookie, { item: card(7), t: 192, body: "  Their intake grabs two at once.\r\n " });
    expect(a.status).toBe(200);
    expect(a.body.note).toMatchObject({ t: 192, body: "Their intake grabs two at once.", videoId: vid(7), key: `c:${vid(7)}` });
    await call("POST", "/videos/notes", me.cookie, { item: card(7), t: 30, body: "Drivetrain: mecanum" });
    await call("POST", "/videos/notes", me.cookie, { item: card(7), t: null, body: "Ask them about their auto" });
    expect((await call("POST", "/videos/notes", me.cookie, { item: card(7), t: -4, body: "x" })).status).toBe(400);
    expect((await call("POST", "/videos/notes", me.cookie, { item: card(7), t: 4, body: "   " })).status).toBe(400);

    const st = await call<LibraryItemState>("GET", `/videos/library/item?key=${encodeURIComponent(`c:${vid(7)}`)}`, me.cookie);
    expect(st.body.notes.map((x) => x.t)).toEqual([30, 192, null]);

    const id = a.body.note.id;
    expect((await call("PATCH", `/videos/notes/${id}`, other.cookie, { body: "mine now" })).status).toBe(404);
    expect((await call("DELETE", `/videos/notes/${id}`, other.cookie)).status).toBe(404);
    expect((await call<NotesPage>("GET", "/videos/notes", other.cookie)).body.notes).toEqual([]);

    const ed = await call<{ note: VideoNote }>("PATCH", `/videos/notes/${id}`, me.cookie, { body: "Grabs two at once, every cycle", t: 195 });
    expect(ed.body.note).toMatchObject({ body: "Grabs two at once, every cycle", t: 195 });
    const all3 = await call<NotesPage>("GET", "/videos/notes", me.cookie);
    expect(all3.body.notes.length).toBe(3);
    expect(all3.body.notes[0].id).toBe(id);
    expect((await call("DELETE", `/videos/notes/${id}`, me.cookie)).status).toBe(200);
    expect((await call<LibraryCounts>("GET", "/videos/library/counts", me.cookie)).body.notes).toBe(2);
  });

  it("hands Control Point the note with where to watch it", () => {
    const note: VideoNote = { id: "9", key: `c:${vid(1)}`, videoId: vid(1), t: 75, body: "Fast lift", item: cleanItem(card(1))!, createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z" };
    expect(cpNote(note)).toEqual({ scoutId: "9", videoId: vid(1), key: `c:${vid(1)}`, t: 75, body: "Fast lift", title: "Episode 1", watch: `/watch/${vid(1)}?t=75`, createdAt: note.createdAt, updatedAt: note.updatedAt });
  });

  it("goes with the account", async () => {
    const me = await account();
    await call("PUT", "/videos/library/saved", me.cookie, { item: card(1) });
    await call("POST", "/videos/notes", me.cookie, { item: card(1), t: 1, body: "x" });
    await deleteUser(me.id);
    expect(await all("SELECT 1 FROM video_library WHERE user_id = ?", [me.id])).toEqual([]);
    expect(await all("SELECT 1 FROM video_notes WHERE user_id = ?", [me.id])).toEqual([]);
  });
});
