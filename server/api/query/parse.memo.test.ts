// Each parse remembered for a few seconds (./parse.ts parseQuery): the same reading for the same text, day and
// preferred teams, each caller its own copy, and read fresh for a context parseContext didn't make or one whose
// fields were replaced.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";

// Real parses counted: the shared parser, wrapped.
const fresh = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../src/shared/query/parse.js", async (orig) => {
  const m = await orig<typeof import("../../../src/shared/query/parse.js")>();
  return { ...m, parseQuery: (...a: Parameters<typeof m.parseQuery>) => { fresh.n++; return m.parseQuery(...a); } };
});
const { CONTEXT_KEY, parseQuery } = await import("./parse");
const { parseContext } = await import("./context");

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Town', 'NJ', 'USA')");
});
beforeEach(() => { fresh.n = 0; vi.restoreAllMocks(); });

describe("parse memo", () => {
  it("gives each caller an equal copy of the one reading", async () => {
    const ctx = await parseContext();
    expect((ctx as unknown as Record<symbol, unknown>)[CONTEXT_KEY]).toBeTruthy();
    const a = await parseQuery("4215 opr in new jersey", ctx);
    const b = await parseQuery("4215 opr in new jersey", await parseContext());
    expect(fresh.n).toBe(1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    a.teams.length = 0;
    expect((await parseQuery("4215 opr in new jersey", ctx)).teams.length).toBe(b.teams.length);
    expect(fresh.n).toBe(1);
  });

  it("reads again for other preferred teams or another day; a plain copy shares", async () => {
    const ctx = await parseContext();
    await parseQuery("garden state meet", ctx);
    await parseQuery("garden state meet", { ...ctx });
    expect(fresh.n).toBe(1);
    await parseQuery("garden state meet", await parseContext(Date.now(), new Set(["team:4215"])));
    expect(fresh.n).toBe(2);
    await parseQuery("garden state meet", await parseContext(Date.now() + 86_400_000));
    expect(fresh.n).toBe(3);
  });

  it("reads fresh for a copy with any field replaced", async () => {
    const ctx = await parseContext();
    await parseQuery("garden state meet replaced", ctx);
    expect(fresh.n).toBe(1);
    const replaced = [
      { ...ctx, prefer: new Set(["team:4215"]) },
      { ...ctx, today: "2001-01-01" },
      { ...ctx, isEvent: async () => true },
      { ...ctx, teamEvent: async () => null },
      { ...ctx, nearTeam: async () => null },
    ];
    for (const [i, c] of replaced.entries()) {
      await parseQuery("garden state meet replaced", c);
      expect(fresh.n).toBe(i + 2);
    }
  });

  it("reads fresh for a context parseContext didn't make", async () => {
    const { [CONTEXT_KEY]: _key, ...plain } = (await parseContext()) as unknown as Record<string | symbol, unknown>;
    const ctx = plain as unknown as Awaited<ReturnType<typeof parseContext>>;
    await parseQuery("garden state meet plain", ctx);
    await parseQuery("garden state meet plain", ctx);
    expect(fresh.n).toBe(2);
  });

  it("reads again once its five seconds are up, not before", async () => {
    const ctx = await parseContext();
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    await parseQuery("garden state meet again", ctx);
    clock.mockReturnValue(start + 4_999);
    await parseQuery("garden state meet again", ctx);
    expect(fresh.n).toBe(1);
    clock.mockReturnValue(start + 5_000);
    await parseQuery("garden state meet again", ctx);
    expect(fresh.n).toBe(2);
  });
});
