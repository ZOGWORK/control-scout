// The owner's streams are read under the recordings (server/videos/recordings.ts), which online go on without them:
// the season pack's events board must not. A failing seasonStreams fails the board; the online list still answers
// and logs why.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, setDb } from "../db";

vi.mock("../portal/streams.js", async (orig) => ({
  ...(await orig<typeof import("../portal/streams.js")>()),
  seasonStreams: vi.fn(async () => { throw new Error("streams table unreadable"); }),
}));
vi.mock("../api/events.js", async (orig) => ({
  ...(await orig<typeof import("../api/events.js")>()),
  listEvents: vi.fn(async () => [{ season: 2026, code: "USTXQ1", name: "Texas Qualifier", venue: null, divisionCode: null, region: "USTX", remote: false }]),
}));

const { eventListAnswer } = await import("../api/reads.js");
const { BOARD_READS, readBoards } = await import("./boards.js");

beforeAll(async () => { const c = openDb(":memory:"); setDb(c); await migrate(c); });

describe("events list when the owner's streams can't be read", () => {
  it("the pack build fails, naming the board", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = BOARD_READS.find((r) => r.toString().includes("eventListAnswer"))!;
    await expect(readBoards(2026, [events])).rejects.toThrow(/Season boards: reading \/api\/events\?season=2026 failed: recordings for 2026 were read without one of their sources/);
  });
  it("online, the list still answers and logs the streams failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const got = await eventListAnswer({ season: 2026, hideNoMatch: true, limit: 3000 });
    expect(got.events.map((e) => e.code)).toEqual(["USTXQ1"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("owner streams for 2026: streams table unreadable"));
  });
});
