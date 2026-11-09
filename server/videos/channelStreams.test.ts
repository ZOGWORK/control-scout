// FIRST's stream link as a YouTube channel's page: the channel's broadcasts that started on the event's dates are
// its recordings, one a day for a two-day meet; each match links to its second in its own day's video; a broadcast
// of another day, a failed read or a changed link are handled; the channel is read through the API with the key.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import type { MatchView } from "../../src/shared/api";
import { eventRecording, recordingStream, withClips } from "./recordings";
import { apiReader, channelDue, channelRef, onDates, pageReader, resolveChannelStreams, type Broadcast, type ChannelReader } from "./channelStreams";

const S = 2025;
const CH = "https://youtube.com/@funroboticsnetwork/streams";
const SAT = "alYRwgvaQUE", SUN = "G4HPbJNLeLE", OTHER = "sDwerHJt-Xg";
const NOW = Date.parse("2026-11-08T17:00:00Z");

describe("channelRef", () => {
  it("reads a channel's page in its every form, and nothing else", () => {
    expect(channelRef(CH)).toEqual({ kind: "handle", value: "@funroboticsnetwork" });
    expect(channelRef("https://www.youtube.com/@FTCWA")).toEqual({ kind: "handle", value: "@FTCWA" });
    expect(channelRef("youtube.com/@FTCWA/live")).toEqual({ kind: "handle", value: "@FTCWA" });
    expect(channelRef("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos")).toEqual({ kind: "id", value: "UCabcdefghijklmnopqrstuv" });
    expect(channelRef("https://m.youtube.com/user/firstinspires")).toEqual({ kind: "user", value: "firstinspires" });
    expect(channelRef("https://www.youtube.com/c/FUNRobotics/streams")).toEqual({ kind: "custom", value: "FUNRobotics" });
    for (const no of [`https://youtu.be/${SAT}`, `https://www.youtube.com/watch?v=${SAT}`, `https://www.youtube.com/live/${SAT}`, "https://twitch.tv/ftcwa",
      "https://www.youtube.com/@FTCWA/playlists", "https://www.youtube.com/", "https://www.youtube.com/results?search_query=ftc", "not a link", "https://evil.example/@x/streams",
      "https://www.youtube.com/@bad%E0%A4%A/streams"]) {
      expect(channelRef(no), no).toBeNull();
    }
  });
});

describe("pageReader", () => {
  const page = (ids: string[]) => ids.map((id) => `"videoId":"${id}"`).join(",");
  it("reads a /c/ channel at YouTube's /c/ address, and a partial read is an error, never the channel's whole list", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => { asked.push(url); return new Response(page([SAT, SUN]), { status: 200 }); }) as unknown as typeof fetch;
    const ok = async (id: string) => ({ status: "ok" as const, start: id === SAT ? "2026-06-27T16:30:06Z" : "2026-06-28T11:55:24Z", end: null, length: 100, live: false });
    expect(await pageReader(fake, ok, 0)(channelRef("https://www.youtube.com/c/FUNRobotics")!, 0)).toHaveLength(2);
    expect(asked).toEqual(["https://www.youtube.com/c/FUNRobotics/streams"]);
    const half = async (id: string) => id === SUN ? { status: "error" as const, start: null, end: null, length: null, live: false } : ok(id);
    expect(await pageReader(fake, half, 0)(channelRef(CH)!, 0)).toBe("error");
  });
});

describe("onDates", () => {
  it("keeps the broadcasts that started on the event's dates at the venue, earliest first", () => {
    const list: Broadcast[] = [
      { videoId: SUN, start: "2026-06-28T12:30:00Z" },
      { videoId: OTHER, start: "2026-06-29T02:00:00Z" }, // Sunday 10 pm in Maryland: still the event's
      { videoId: SAT, start: "2026-06-27T16:50:00Z" },
      { videoId: "aaaaaaaaaaa", start: "2026-06-25T16:00:00Z" }, // the day before
      { videoId: "bbbbbbbbbbb", start: "2026-06-29T14:00:00Z" }, // the day after
    ];
    expect(onDates(list, { start: "2026-06-26", end: "2026-06-28", timezone: "America/New_York" }).map((b) => b.videoId)).toEqual([SAT, SUN, OTHER]);
  });
});

describe("channelDue", () => {
  const e = { start: "2026-06-27", end: "2026-06-28" };
  const row = (video: string | null, at: number) => ({ url: CH, video_id: video, checked_at: new Date(at).toISOString() });
  it("looks at once, every 15 min on its dates, every 2 h for two weeks with nothing, weekly after", () => {
    expect(channelDue({ url: null, video_id: null, checked_at: null }, CH, e, NOW)).toBe(true);
    expect(channelDue({ ...row(SAT, NOW), url: "https://youtube.com/@other" }, CH, e, NOW)).toBe(true);
    const sat = Date.parse("2026-06-27T18:00:00Z");
    expect(channelDue(row(SAT, sat - 10 * 60_000), CH, e, sat)).toBe(false);
    expect(channelDue(row(SAT, sat - 20 * 60_000), CH, e, sat)).toBe(true);
    const week = Date.parse("2026-07-05T12:00:00Z");
    expect(channelDue(row(null, week - 3 * 3600_000), CH, e, week)).toBe(true);
    expect(channelDue(row(null, week - 3600_000), CH, e, week)).toBe(false);
    // Found, and looked at again once its dates were 2 days past: done.
    expect(channelDue(row(SAT, week - 3 * 3600_000), CH, e, week)).toBe(false);
    expect(channelDue(row(null, NOW - 3 * 86_400_000), CH, e, NOW)).toBe(false);
    expect(channelDue(row(null, NOW - 8 * 86_400_000), CH, e, NOW)).toBe(true);
  });
});

describe("apiReader", () => {
  it("finds the channel by its handle, reads its uploads back to the date, and each one's broadcast start", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      const u = new URL(url);
      asked.push(u.pathname.split("/").at(-1)!);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (u.pathname.endsWith("/channels")) return json({ items: [{ id: "UCabcdefghijklmnopqrstuv" }] });
      if (u.pathname.endsWith("/playlistItems")) {
        expect(u.searchParams.get("playlistId")).toBe("UUabcdefghijklmnopqrstuv");
        return u.searchParams.get("pageToken")
          ? json({ items: [{ contentDetails: { videoId: SAT, videoPublishedAt: "2026-06-27T16:50:00Z" } }, { contentDetails: { videoId: OTHER, videoPublishedAt: "2026-04-01T00:00:00Z" } }], nextPageToken: "p3" })
          : json({ items: [{ contentDetails: { videoId: SUN, videoPublishedAt: "2026-06-28T12:30:00Z" } }], nextPageToken: "p2" });
      }
      return json({ items: [
        { id: SUN, liveStreamingDetails: { actualStartTime: "2026-06-28T12:30:00Z", actualEndTime: "2026-06-28T22:13:00Z" }, contentDetails: { duration: "PT9H43M10S" } },
        { id: SAT, liveStreamingDetails: { actualStartTime: "2026-06-27T16:50:00Z", actualEndTime: "2026-06-27T22:03:00Z" }, contentDetails: { duration: "PT5H12M55S" } },
        { id: OTHER, contentDetails: { duration: "PT3M" } },
      ] });
    }) as unknown as typeof fetch;
    const got = await apiReader("k", fake)(channelRef(CH)!, Date.parse("2026-05-13T00:00:00Z"));
    expect(got).toEqual([{ videoId: SUN, start: "2026-06-28T12:30:00.000Z" }, { videoId: SAT, start: "2026-06-27T16:50:00.000Z" }]);
    // Stopped paging once the uploads reached back past the date.
    expect(asked).toEqual(["channels", "playlistItems", "playlistItems", "videos"]);
  });
  it("is an error when YouTube can't be read", async () => {
    const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await apiReader("k", down)(channelRef(CH)!, 0)).toBe("error");
  });
});

describe("resolveChannelStreams and the event's recording", () => {
  let list: Broadcast[] | "error" = [];
  const reads: string[] = [];
  const reader: ChannelReader = async (c) => { reads.push(c.value); return list; };
  const resolve = (now = NOW) => resolveChannelStreams(() => {}, { reader, withKey: true, now: () => now });

  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'MTI', 'MTI', 'OffSeason', '2026-06-26', '2026-06-28', 'America/New_York', 0, 0, ?, 'test')", [S, CH]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, 'VIDEO', 'V', 'OffSeason', '2026-06-26', '2026-06-28', 'America/New_York', 0, 0, ?, 'test')", [S, `https://youtu.be/${OTHER}`]);
    for (const [id, start, end, len] of [[SAT, "2026-06-27T16:50:00Z", "2026-06-27T22:03:00Z", 18775], [SUN, "2026-06-28T12:30:00Z", "2026-06-28T22:13:00Z", 34990]] as const) {
      await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at) VALUES (?, 'ok', ?, ?, ?, 0, ?)", [id, start, end, len, new Date(NOW).toISOString()]);
    }
  });

  it("keeps the channel's broadcasts on the event's dates; the first is the page's video, each day named", async () => {
    list = [{ videoId: SUN, start: "2026-06-28T12:30:00Z" }, { videoId: SAT, start: "2026-06-27T16:50:00Z" }, { videoId: OTHER, start: "2026-07-04T15:00:00Z" }];
    expect(await resolve()).toBe(1);
    expect(reads).toEqual(["@funroboticsnetwork"]); // a video's own link isn't a channel
    expect(await all("SELECT video_id FROM event_broadcasts ORDER BY start")).toEqual([{ video_id: SAT }, { video_id: SUN }]);
    clearAllCaches();
    const rec = (await eventRecording(S, "MTI"))!;
    expect(rec.videoId).toBe(SAT);
    expect(rec.more?.map((m) => m.videoId)).toEqual([SUN]);
    expect(recordingStream(rec, "America/New_York").days).toEqual([{ videoId: SAT, label: "Saturday" }, { videoId: SUN, label: "Sunday" }]);
  });

  it("puts each match on its second in its own day's video", async () => {
    clearAllCaches();
    const rec = (await eventRecording(S, "MTI"))!;
    const m = (label: string, startsAt: string): Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip"> => ({ label, time: startsAt.replace("Z", ".123"), startsAt, played: true });
    const [q1, q60, f1, gap] = withClips([m("Q1", "2026-06-27T17:12:07Z"), m("Q60", "2026-06-28T13:00:00Z"), m("F1", "2026-06-28T20:00:00Z"), m("Q40", "2026-06-28T02:00:00Z")], rec, NOW);
    expect(q1.clip).toMatchObject({ videoId: SAT, t: 22 * 60 + 7 - 20 });
    expect(q60.clip).toMatchObject({ videoId: SUN, t: 30 * 60 - 20 });
    expect(f1.clip).toMatchObject({ videoId: SUN, t: 7.5 * 3600 - 20 });
    expect(gap.clip).toBeUndefined(); // overnight, in neither
  });

  it("a day made private leaves the other: the next day becomes the event's video", async () => {
    await run("UPDATE video_meta SET status = 'unavailable' WHERE video_id = ?", [SAT]);
    clearAllCaches();
    const rec = (await eventRecording(S, "MTI"))!;
    expect(rec.videoId).toBe(SUN);
    expect(rec.more).toBeUndefined();
    await run("UPDATE video_meta SET status = 'ok' WHERE video_id = ?", [SAT]);
  });

  it("a read that finds only one day keeps the day found before; a failed read is noted, so other events get their turn", async () => {
    list = [{ videoId: SUN, start: "2026-06-28T12:30:00Z" }];
    await run("UPDATE event_stream_links SET checked_at = '2026-01-01T00:00:00Z' WHERE code = 'MTI'"); // due again
    await resolve(NOW + 60_000);
    expect(await all("SELECT video_id FROM event_broadcasts ORDER BY start")).toEqual([{ video_id: SAT }, { video_id: SUN }]);
    list = "error";
    await run("UPDATE event_stream_links SET checked_at = '2026-01-01T00:00:00Z' WHERE code = 'MTI'");
    await resolve(NOW + 120_000);
    expect(await all("SELECT video_id, checked_at FROM event_stream_links WHERE code = 'MTI'")).toEqual([{ video_id: SAT, checked_at: new Date(NOW + 120_000).toISOString() }]);
  });

  it("keeps what was found when a later read fails or finds nothing, and drops it when the link changes", async () => {
    list = "error";
    await resolve(NOW + 8 * 86_400_000);
    list = [];
    await resolve(NOW + 16 * 86_400_000);
    clearAllCaches();
    expect((await eventRecording(S, "MTI"))?.videoId).toBe(SAT);
    await run("UPDATE events SET livestream = 'https://youtube.com/@another' WHERE code = 'MTI'");
    clearAllCaches();
    expect(await eventRecording(S, "MTI")).toBeNull();
    await resolve(NOW + 17 * 86_400_000);
    expect(await all("SELECT video_id FROM event_broadcasts")).toEqual([]);
  });
});
