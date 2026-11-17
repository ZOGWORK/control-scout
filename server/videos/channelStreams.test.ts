// FIRST's stream link as a YouTube channel's page: the channel's broadcasts that started on the event's dates are
// its recordings, one a day for a two-day meet; each match links to its second in its own day's video; a broadcast
// of another day, a failed read or a changed link are handled; the channel is read through the API with the key.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import type { MatchView } from "../../src/shared/api";
import { eventRecording, recordingStream, withClips } from "./recordings";
import { apiReader, channelDue, channelRef, onDates, ownBroadcasts, ownWords, pageReader, resolveChannelStreams, reweighBroadcasts, type Broadcast, type ChannelReader } from "./channelStreams";

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
    const consent = (async () => new Response("<html>Before you continue to YouTube</html>", { status: 200 })) as unknown as typeof fetch;
    expect(await pageReader(consent, ok, 0)(channelRef(CH)!, 0)).toBe("error");
    const empty = (async () => new Response('{"channelMetadataRenderer":{"title":"x"}}', { status: 200 })) as unknown as typeof fetch;
    expect(await pageReader(empty, ok, 0)(channelRef(CH)!, 0)).toEqual([]);
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

describe("ownBroadcasts", () => {
  const day = { start: "2026-11-14", end: "2026-11-14", timezone: "America/Detroit" };
  const m5 = { videoId: "6lcZz9UrOdE", start: "2026-11-14T13:26:44Z", title: "West Michigan FTC League Meet 5 - BIOBUZZ" };
  const m6 = { videoId: "_DrkMn2tDg4", start: "2026-11-14T17:37:13Z", title: "West Michigan FTC League Meet 6 - BIOBUZZ" };
  it("two meets in a day on one channel link: each keeps only the broadcast its title names", () => {
    expect(ownBroadcasts([m5, m6], { name: "West Michigan Meet 5" }, [{ name: "West Michigan Meet 6", ...day }])).toEqual([m5]);
    expect(ownBroadcasts([m5, m6], { name: "West Michigan Meet 6" }, [{ name: "West Michigan Meet 5", ...day }])).toEqual([m6]);
  });
  it("keeps a broadcast whose title names no sibling, has no title, or names a meet no sibling is, and changes nothing without siblings", () => {
    const plain = { videoId: "aaaaaaaaaaa", start: "2026-11-14T20:00:00Z", title: "West Michigan FTC League - BIOBUZZ" };
    const untitled = { videoId: "bbbbbbbbbbb", start: "2026-11-14T21:00:00Z" };
    const nine = { videoId: "ccccccccccc", start: "2026-11-14T22:00:00Z", title: "West Michigan FTC League Meet 9" };
    expect(ownBroadcasts([plain, untitled, nine], { name: "West Michigan Meet 5" }, [{ name: "West Michigan Meet 6", ...day }])).toEqual([plain, untitled, nine]);
    expect(ownBroadcasts([m5, m6], { name: "West Michigan Meet 5" }, [])).toEqual([m5, m6]);
    // A sibling on another day doesn't claim a broadcast of this one.
    expect(ownBroadcasts([m5, m6], { name: "West Michigan Meet 5" }, [{ name: "West Michigan Meet 6", start: "2026-11-21", end: "2026-11-21", timezone: "America/Detroit" }])).toEqual([m5, m6]);
  });
  it("on a day of two broadcasts, keeps those whose titles name the event's own words, sibling or not", () => {
    // FIRST Robotics BC streamed its Victoria and Lower Mainland qualifiers on 2023-01-28; only Victoria gave FIRST the link.
    const van = { videoId: "Y0yrKRUpcJo", start: "2023-01-28T18:56:32Z", title: "British Columbia FIRST Tech Challenge Vancouver Qualifier Jan. 28 2023" };
    const vic = { videoId: "TUFDPEuJSpM", start: "2023-01-28T19:03:42Z", title: "British Columbia FIRST Tech Challenge Victoria Qualifier Jan.  2022" };
    expect(ownBroadcasts([van, vic], { name: "BC Victoria Qualifier", timezone: "America/Vancouver" }, [])).toEqual([vic]);
    // Two siblings sharing FIRST Chesapeake's link: each keeps its own city's.
    const laurel = { videoId: "x9rLb-CbpV4", start: "2026-02-01T14:00:00Z", title: "FIRST Chesapeake 2026 FTC Laurel, MD Qualifier II" };
    const union = { videoId: "_a4kyRdwfFM", start: "2026-02-01T14:10:00Z", title: "FIRST Chesapeake 2026 FTC Union Bridge, MD Qualifier IV" };
    const feb1 = { start: "2026-02-01", end: "2026-02-01", timezone: "America/New_York" };
    expect(ownBroadcasts([laurel, union], { name: "Laurel, MD Qualifier 2", timezone: feb1.timezone }, [{ name: "Union Bridge, MD 4 Qualifier", ...feb1 }])).toEqual([laurel]);
    expect(ownBroadcasts([laurel, union], { name: "Union Bridge, MD 4 Qualifier", timezone: feb1.timezone }, [{ name: "Laurel, MD Qualifier 2", ...feb1 }])).toEqual([union]);
    // No title names it: all stay. One broadcast a day: it stays. A day's two each naming it (two parts): both stay.
    const live = { videoId: "SIrsN45NDkg", start: "2023-01-28T18:00:00Z", title: "FIRST Tech Challenge Live Stream" };
    expect(ownBroadcasts([van, live], { name: "BC Victoria Qualifier", timezone: "America/Vancouver" }, [])).toEqual([van, live]);
    expect(ownBroadcasts([van], { name: "BC Victoria Qualifier", timezone: "America/Vancouver" }, [])).toEqual([van]);
    const vic2 = { ...vic, videoId: "zzzzzzzzzzz", title: "BC Victoria Qualifier - Finals" };
    expect(ownBroadcasts([vic, vic2], { name: "BC Victoria Qualifier", timezone: "America/Vancouver" }, [])).toEqual([vic, vic2]);
    // Accents and common words: "Brașov" is "brasov"; "FTC", "Qualifier", "BC" name nothing.
    expect(ownWords("BC Brașov FTC Qualifier #2")).toEqual(["brasov"]);
  });
});

describe("channelDue", () => {
  const e = { start: "2026-06-27", end: "2026-06-28" };
  // An answered read at `at` (failed: a try at `at` after an answered read at `read`).
  const row = (video: string | null, at: number, read: number | null = at) => ({ url: CH, video_id: video, checked_at: new Date(at).toISOString(), read_at: read == null ? null : new Date(read).toISOString() });
  it("looks at once, every 15 min on its dates, every 2 h for two weeks with nothing, weekly after", () => {
    expect(channelDue({ url: null, video_id: null, checked_at: null, read_at: null }, CH, e, NOW)).toBe(true);
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
  it("a failed try never counts as a look: tried again after 2 hours (a day for an older event)", () => {
    const week = Date.parse("2026-07-05T12:00:00Z");
    // Saturday found during the event; the check after it failed: still looking for Sunday.
    expect(channelDue(row(SAT, week - 3 * 3600_000, Date.parse("2026-06-28T20:00:00Z")), CH, e, week)).toBe(true);
    expect(channelDue(row(null, NOW - 2 * 86_400_000, null), CH, e, NOW)).toBe(true);
    expect(channelDue(row(null, NOW - 3600_000, null), CH, e, NOW)).toBe(false);
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
        expect(u.searchParams.get("part")).toBe("snippet,contentDetails");
        return u.searchParams.get("pageToken")
          ? json({ items: [{ contentDetails: { videoId: SAT, videoPublishedAt: "2026-06-27T16:50:00Z" } }, { contentDetails: { videoId: OTHER, videoPublishedAt: "2026-04-01T00:00:00Z" } }], nextPageToken: "p3" })
          : json({ items: [{ snippet: { title: "MTI Sunday" }, contentDetails: { videoId: SUN, videoPublishedAt: "2026-06-28T12:30:00Z" } }], nextPageToken: "p2" });
      }
      return json({ items: [
        { id: SUN, liveStreamingDetails: { actualStartTime: "2026-06-28T12:30:00Z", actualEndTime: "2026-06-28T22:13:00Z" }, contentDetails: { duration: "PT9H43M10S" } },
        { id: SAT, liveStreamingDetails: { actualStartTime: "2026-06-27T16:50:00Z", actualEndTime: "2026-06-27T22:03:00Z" }, contentDetails: { duration: "PT5H12M55S" } },
        { id: OTHER, contentDetails: { duration: "PT3M" } },
      ] });
    }) as unknown as typeof fetch;
    const got = await apiReader("k", fake)(channelRef(CH)!, Date.parse("2026-05-13T00:00:00Z"));
    expect(got).toEqual([{ videoId: SUN, start: "2026-06-28T12:30:00.000Z", title: "MTI Sunday" }, { videoId: SAT, start: "2026-06-27T16:50:00.000Z" }]);
    // Stopped paging once the uploads reached back past the date.
    expect(asked).toEqual(["channels", "playlistItems", "playlistItems", "videos"]);
  });
  it("is an error when YouTube can't be read", async () => {
    const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await apiReader("k", down)(channelRef(CH)!, 0)).toBe("error");
    expect(await apiReader("k", down)(channelRef("https://www.youtube.com/c/FUNRobotics")!, 0)).toBe("error"); // a /c/ page that failed: not an empty channel
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
    // Still timed on Sunday's matches only: Saturday's (outside it) never judge Sunday's video.
    expect(rec.daily).toBe(true);
    const sunOnly = withClips([{ label: "Q60", time: "2026-06-28T13:00:00.123", startsAt: "2026-06-28T13:00:00Z", played: true }, { label: "Q1", time: "2026-06-27T17:12:07.123", startsAt: "2026-06-27T17:12:07Z", played: true }] as Pick<MatchView, "label" | "time" | "startsAt" | "played" | "clip">[], rec, NOW);
    expect(sunOnly[0].clip).toMatchObject({ videoId: SUN });
    expect(sunOnly[1].clip).toBeUndefined();
    await run("UPDATE video_meta SET status = 'ok' WHERE video_id = ?", [SAT]);
  });

  it("a read that finds only one day keeps the day found before; a failed read is noted, so other events get their turn", async () => {
    list = [{ videoId: SUN, start: "2026-06-28T12:30:00Z" }];
    await run("UPDATE event_stream_links SET checked_at = '2026-01-01T00:00:00Z', read_at = NULL WHERE code = 'MTI'"); // due again
    await resolve(NOW + 60_000);
    expect(await all("SELECT video_id FROM event_broadcasts ORDER BY start")).toEqual([{ video_id: SAT }, { video_id: SUN }]);
    expect(await all("SELECT read_at FROM event_stream_links WHERE code = 'MTI'")).toMatchObject([{ read_at: new Date(NOW + 60_000).toISOString() }]);
    list = "error";
    await run("UPDATE event_stream_links SET checked_at = '2026-01-02T00:00:00Z', read_at = '2026-01-01T00:00:00Z' WHERE code = 'MTI'"); // a try failed after the last answered read
    await resolve(NOW + 120_000);
    expect(await all("SELECT video_id, checked_at, read_at FROM event_stream_links WHERE code = 'MTI'")).toMatchObject([{ video_id: SAT, checked_at: new Date(NOW + 120_000).toISOString(), read_at: "2026-01-01T00:00:00Z" }]);
  });

  it("a saved day no longer on the event's (corrected) dates is dropped", async () => {
    await run("UPDATE events SET start = '2026-06-28' WHERE code = 'MTI'");
    list = [];
    await run("UPDATE event_stream_links SET checked_at = '2026-01-01T00:00:00Z', read_at = NULL WHERE code = 'MTI'");
    await resolve(NOW + 180_000);
    expect(await all("SELECT video_id FROM event_broadcasts WHERE code = 'MTI'")).toEqual([{ video_id: SUN }]);
    await run("UPDATE events SET start = '2026-06-26' WHERE code = 'MTI'");
    list = [{ videoId: SAT, start: "2026-06-27T16:50:00Z" }];
    await run("UPDATE event_stream_links SET checked_at = '2026-01-01T00:00:00Z', read_at = NULL WHERE code = 'MTI'");
    await resolve(NOW + 240_000);
  });

  it("a changed link whose first read fails is no look at the new link: it's tried again", async () => {
    await run("UPDATE events SET livestream = 'https://youtube.com/@moved' WHERE code = 'MTI'");
    list = "error";
    await resolve(NOW + 300_000);
    expect(await all("SELECT url, read_at FROM event_stream_links WHERE code = 'MTI'")).toMatchObject([{ url: "https://youtube.com/@moved", read_at: null }]);
    await run("UPDATE events SET livestream = ? WHERE code = 'MTI'", [CH]);
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

describe("resolveChannelStreams: two meets in a day on one channel link", () => {
  const WM = "https://www.youtube.com/@firstalumninetworkgrandvalley/streams";
  const M5 = "6lcZz9UrOdE", M6 = "_DrkMn2tDg4";
  const reader: ChannelReader = async () => [
    { videoId: M6, start: "2026-11-14T17:37:13Z", title: "West Michigan FTC League Meet 6 - BIOBUZZ" },
    { videoId: M5, start: "2026-11-14T13:26:44Z", title: "West Michigan FTC League Meet 5 - BIOBUZZ" },
  ];
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO seasons (season, name) VALUES (2026, 'Test')");
    for (const n of [5, 6]) await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (2026, ?, ?, 'LeagueMeet', '2026-11-14', '2026-11-14', 'America/Detroit', 0, 0, ?, 'test')", [`USMIWMM${n}`, `West Michigan Meet ${n}`, WM]);
    // What the earlier read saved: both broadcasts on both meets.
    for (const code of ["USMIWMM5", "USMIWMM6"]) for (const [id, start] of [[M5, "2026-11-14T13:26:44.000Z"], [M6, "2026-11-14T17:37:13.000Z"]]) await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (2026, ?, ?, ?, ?)", [code, id, WM, start]);
  });
  it("each meet keeps only its own broadcast, the ones saved before included", async () => {
    expect(await resolveChannelStreams(() => {}, { reader, withKey: true, now: () => Date.parse("2026-11-15T06:00:00Z") })).toBe(2);
    expect(await all("SELECT code, video_id FROM event_broadcasts ORDER BY code")).toEqual([{ code: "USMIWMM5", video_id: M5 }, { code: "USMIWMM6", video_id: M6 }]);
    clearAllCaches();
    expect((await eventRecording(2026, "USMIWMM6"))?.videoId).toBe(M6);
    expect((await eventRecording(2026, "USMIWMM6"))?.more).toBeUndefined();
  });
});

describe("reweighBroadcasts: broadcasts found before, by today's rules", () => {
  const BC = "https://www.youtube.com/@firstroboticsbc/streams";
  const VAN = "Y0yrKRUpcJo", VIC = "TUFDPEuJSpM";
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO seasons (season, name) VALUES (2022, 'Test')");
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (2022, 'CABCVIQ', 'BC Victoria Qualifier', 'Qualifier', '2023-01-28', '2023-01-28', 'America/Vancouver', 0, 0, ?, 'test')", [BC]);
    // Found when broadcasts were kept by their date alone: the Vancouver stream first, so it was the event's link.
    for (const [v, s] of [[VAN, "2023-01-28T18:56:32Z"], [VIC, "2023-01-28T19:03:42Z"]]) await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (2022, 'CABCVIQ', ?, ?, ?)", [v, BC, s]);
    await run("INSERT INTO event_stream_links (season, code, url, video_id, checked_at, read_at) VALUES (2022, 'CABCVIQ', ?, ?, '2026-11-09T07:47:52Z', '2026-11-09T07:47:52Z')", [BC, VAN]);
    const up = "INSERT INTO official_audit_videos (video_id, channel_id, title, published, first_seen, last_seen) VALUES (?, 'UCjqJ09AW-_NL0e1OKSSqVNA', ?, '2023-01-29T05:00:00Z', 'x', 'x')";
    await run(up, [VAN, "British Columbia FIRST Tech Challenge Vancouver Qualifier Jan. 28 2023"]);
    await run(up, [VIC, "British Columbia FIRST Tech Challenge Victoria Qualifier Jan.  2022"]);
  });
  it("takes another event's broadcast off, and the event's link moves to its own", async () => {
    expect(await reweighBroadcasts()).toBe(1);
    expect((await all<{ video_id: string }>("SELECT video_id FROM event_broadcasts WHERE code = 'CABCVIQ'")).map((r) => r.video_id)).toEqual([VIC]);
    expect((await all<{ video_id: string }>("SELECT video_id FROM event_stream_links WHERE code = 'CABCVIQ'")).map((r) => r.video_id)).toEqual([VIC]);
    expect(await reweighBroadcasts()).toBe(0);
  });
  it("weighs a broadcast whose stored title is a placeholder (\"Deleted video\") as untitled: it stays", async () => {
    await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (2022, 'CABCVIQ', 'deletedvide', ?, '2023-01-28T22:00:00Z')", [BC]);
    await run("INSERT INTO official_audit_videos (video_id, channel_id, title, published, first_seen, last_seen) VALUES ('deletedvide', 'UCjqJ09AW-_NL0e1OKSSqVNA', 'Deleted video', '2023-01-29T05:00:00Z', 'x', 'x')");
    expect(await reweighBroadcasts()).toBe(0);
    expect((await all<{ video_id: string }>("SELECT video_id FROM event_broadcasts WHERE code = 'CABCVIQ' ORDER BY start")).map((r) => r.video_id)).toEqual([VIC, "deletedvide"]);
  });
  it("takes off a broadcast that is another event's official recording, its only one that day included", async () => {
    // 2023 USAZTSQ (Tsalie) took FIRST Tech Challenge Arizona's "Red Rock Qualifier" broadcast: USAZCHQ's checked recording.
    const AZ = "https://www.youtube.com/@firsttechchallengearizona6515";
    await run("INSERT INTO seasons (season, name) VALUES (2023, 'Test') ON CONFLICT DO NOTHING");
    const ev = "INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (2023, ?, ?, 'Qualifier', '2024-01-20', '2024-01-20', ?, 0, 0, ?, 'test')";
    await run(ev, ["USAZTSQ", "AZ Dine' College - Tsalie Qualifier", "America/Denver", AZ]);
    await run(ev, ["USAZCHQ", "AZ Red Rock - Microchip Qualifier", "America/Phoenix", null]);
    await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (2023, 'USAZTSQ', 'hINDJv2q0Tg', ?, '2024-01-20T16:31:53Z')", [AZ]);
    await run("INSERT INTO event_stream_links (season, code, url, video_id, checked_at, read_at) VALUES (2023, 'USAZTSQ', ?, 'hINDJv2q0Tg', 'x', 'x')", [AZ]);
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES ('hINDJv2q0Tg', 2023, 'USAZCHQ', 'recording', '2024-01-20', NULL, 'UCx', 'Arizona FIRST Tech Challenge 2023-2024 Red Rock Qualifier', 'list', 'x', 'x', NULL)");
    expect(await reweighBroadcasts()).toBe(1);
    expect(await all("SELECT video_id FROM event_broadcasts WHERE code = 'USAZTSQ'")).toEqual([]);
    expect(await all("SELECT video_id FROM event_stream_links WHERE code = 'USAZTSQ'")).toEqual([{ video_id: null }]);
    // USAZCHQ's own recording is left as it is.
    expect(await all("SELECT code, removed_at FROM official_videos WHERE video_id = 'hINDJv2q0Tg'")).toEqual([{ code: "USAZCHQ", removed_at: null }]);
    // A division's recording on its own parent championship stays.
    const AZC = "https://www.youtube.com/@firsttechchallengearizona6515/streams";
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, division_code, source) VALUES (2023, 'USAZCMP', 'Arizona Championship', 'Championship', '2024-02-24', '2024-02-24', 'America/Phoenix', 0, 0, ?, NULL, 'test')", [AZC]);
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, division_code, source) VALUES (2023, 'USAZCMPGC', 'Arizona Championship - Grand Canyon Division', 'Championship', '2024-02-24', '2024-02-24', 'America/Phoenix', 0, 0, NULL, 'USAZCMP', 'test')");
    await run("INSERT INTO event_broadcasts (season, code, video_id, url, start) VALUES (2023, 'USAZCMP', 'grandcanyon', ?, '2024-02-24T16:00:00Z')", [AZC]);
    await run("INSERT INTO official_videos (video_id, season, code, kind, day, part, channel_id, title, source, why, added_at, added_by) VALUES ('grandcanyon', 2023, 'USAZCMPGC', 'recording', '2024-02-24', NULL, 'UCx', 'Arizona Championship - Grand Canyon Division', 'list', 'x', 'x', NULL)");
    expect(await reweighBroadcasts()).toBe(0);
    expect(await all("SELECT video_id FROM event_broadcasts WHERE code = 'USAZCMP'")).toEqual([{ video_id: "grandcanyon" }]);
  });
});
