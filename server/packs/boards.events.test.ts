// The events list board never ships without its LIVE dots and videos: when the recordings can't be read, the pack
// build fails naming the board (readBoards), while the online route lists the events without them and logs why.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../videos/recordings.js", async (orig) => ({
  ...(await orig<typeof import("../videos/recordings.js")>()),
  seasonRecordings: vi.fn(async () => { throw new Error("recordings store unreachable"); }),
  seasonVideoKinds: vi.fn(async () => new Map()),
}));
vi.mock("../api/events.js", async (orig) => ({
  ...(await orig<typeof import("../api/events.js")>()),
  listEvents: vi.fn(async () => [{ season: 2026, code: "USTXQ1", name: "Texas Qualifier", venue: null, divisionCode: null, region: "USTX", remote: false }]),
}));

const { eventListAnswer } = await import("../api/reads.js");
const { BOARD_READS, readBoards } = await import("./boards.js");

afterEach(() => { vi.restoreAllMocks(); });

describe("events list when the recordings can't be read", () => {
  it("the pack build fails, naming the board", async () => {
    const events = BOARD_READS.find((r) => r.toString().includes("eventListAnswer"))!;
    await expect(readBoards(2026, [events])).rejects.toThrow(/Season boards: reading \/api\/events\?season=2026 failed: recordings store unreachable/);
  });
  it("online, the list still answers (no LIVE dots) and logs why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const got = await eventListAnswer({ season: 2026, hideNoMatch: true, limit: 3000 });
    expect(got.events.map((e) => e.code)).toEqual(["USTXQ1"]);
    expect(got.events[0]).not.toHaveProperty("stream");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("recordings for 2026 failed"));
  });
});
