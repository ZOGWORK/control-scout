// Each parse remembered for a few seconds (./parse.ts parseQuery): the same reading for the same text, day and
// preferred teams, each caller its own copy, and read fresh for a context parseContext didn't make.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { CONTEXT_KEY, parseQuery } from "./parse";
import { parseContext } from "./context";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Town', 'NJ', 'USA')");
});

describe("parse memo", () => {
  it("gives each caller an equal copy of the one reading", async () => {
    const ctx = await parseContext();
    expect(typeof (ctx as unknown as Record<symbol, unknown>)[CONTEXT_KEY]).toBe("string");
    const a = await parseQuery("4215 opr in new jersey", ctx);
    const b = await parseQuery("4215 opr in new jersey", await parseContext());
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    a.teams.length = 0;
    expect((await parseQuery("4215 opr in new jersey", ctx)).teams.length).toBe(b.teams.length);
  });

  it("reads again for other preferred teams or another day", async () => {
    const isEvent = vi.fn(async () => false);
    const counted = async (prefer: ReadonlySet<string>, now = Date.now()) => ({ ...(await parseContext(now, prefer)), isEvent });
    // A copy of a parseContext context keeps its key: remembered by it.
    const ctx = await counted(new Set());
    await parseQuery("garden state meet", ctx);
    const once = isEvent.mock.calls.length;
    expect(once).toBeGreaterThan(0);
    await parseQuery("garden state meet", ctx);
    expect(isEvent.mock.calls.length).toBe(once);
    await parseQuery("garden state meet", await counted(new Set(["team:4215"])));
    expect(isEvent.mock.calls.length).toBeGreaterThan(once);
    const twice = isEvent.mock.calls.length;
    await parseQuery("garden state meet", await counted(new Set(), Date.now() + 86_400_000));
    expect(isEvent.mock.calls.length).toBeGreaterThan(twice);
  });

  it("reads again once its five seconds are up, not before", async () => {
    const isEvent = vi.fn(async () => false);
    const ctx = { ...(await parseContext()), isEvent };
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    try {
      await parseQuery("garden state meet again", ctx);
      const once = isEvent.mock.calls.length;
      expect(once).toBeGreaterThan(0);
      clock.mockReturnValue(start + 4_999);
      await parseQuery("garden state meet again", ctx);
      expect(isEvent.mock.calls.length).toBe(once);
      clock.mockReturnValue(start + 5_000);
      await parseQuery("garden state meet again", ctx);
      expect(isEvent.mock.calls.length).toBe(once * 2);
    } finally {
      clock.mockRestore();
    }
  });

  it("reads fresh for a context parseContext didn't make", async () => {
    const isEvent = vi.fn(async () => false);
    const { [CONTEXT_KEY]: _key, ...plain } = (await parseContext()) as unknown as Record<string | symbol, unknown>;
    const ctx = { ...plain, isEvent } as unknown as Awaited<ReturnType<typeof parseContext>>;
    await parseQuery("garden state meet", ctx);
    const once = isEvent.mock.calls.length;
    await parseQuery("garden state meet", ctx);
    expect(once).toBeGreaterThan(0);
    expect(isEvent.mock.calls.length).toBe(once * 2);
  });
});
