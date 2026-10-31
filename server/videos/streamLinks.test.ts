// Short stream links (ftcwa.live/bardeen → a YouTube broadcast): followed only while the event is on, kept per
// event, played on the event page; a link that leads nowhere, a channel page, Twitch or a private address gives nothing.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { eventRecording } from "./recordings";
import { followable, linkDue, resolveShortLink, resolveStreamLinks } from "./streamLinks";

const S = 2026;
const NOW = Date.parse("2026-10-31T19:00:00Z");
const VIDEO = "1h77FVxAbQQ", NEXT = "WQUBVjbh-hM";

// Each link's redirect, or a page (no redirect).
let hops: Record<string, string | null> = {};
const fetched: string[] = [];
const fakeFetch = (async (url: string) => {
  fetched.push(url);
  const to = hops[url];
  return to ? new Response(null, { status: 303, headers: { location: to } }) : new Response("page", { status: 200 });
}) as unknown as typeof fetch;

async function event(code: string, start: string, livestream: string | null) {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'LeagueMeet', ?, ?, 'UTC', 0, 0, ?, 'test')", [S, code, `Event ${code}`, start, start, livestream]);
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
});

describe("resolveShortLink", () => {
  it("follows redirects to the YouTube video they end at, never fetching YouTube", async () => {
    hops = { "https://ftcwa.live/bardeen": "https://bit.ly/x", "https://bit.ly/x": `https://www.youtube.com/live/${VIDEO}` };
    fetched.length = 0;
    expect(await resolveShortLink("https://ftcwa.live/bardeen", fakeFetch)).toBe(VIDEO);
    expect(fetched).toEqual(["https://ftcwa.live/bardeen", "https://bit.ly/x"]);
  });
  it("gives nothing for a page, a channel's live page, a non-YouTube end or a redirect loop", async () => {
    hops = { "https://a.example/ch": "https://www.youtube.com/@FTCWA/live", "https://a.example/tw": "https://twitch.tv/ftcwa", "https://a.example/loop": "https://a.example/loop" };
    expect(await resolveShortLink("https://a.example/page", fakeFetch)).toBeNull();
    expect(await resolveShortLink("https://a.example/ch", fakeFetch)).toBeNull();
    expect(await resolveShortLink("https://a.example/tw", fakeFetch)).toBeNull();
    expect(await resolveShortLink("https://a.example/loop", fakeFetch)).toBeNull();
    expect(await resolveShortLink("not a link", fakeFetch)).toBeNull();
  });
  it("never fetches a private or odd address, even one a redirect points at", async () => {
    for (const bad of ["http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "https://router.local/x", "https://a.example:8080/x", "ftp://a.example/x", "http://intranet/x"]) {
      expect(followable(new URL(bad)), bad).toBe(false);
    }
    expect(followable(new URL("https://ftcwa.live/bardeen"))).toBe(true);
    hops = { "https://a.example/in": "http://169.254.169.254/latest" };
    fetched.length = 0;
    expect(await resolveShortLink("https://a.example/in", fakeFetch)).toBeNull();
    expect(fetched).toEqual(["https://a.example/in"]);
  });
});

describe("linkDue", () => {
  const at = (ms: number) => new Date(NOW - ms).toISOString();
  it("follows a new or changed link at once, a found video again after 15 minutes, nothing found after 2 hours", () => {
    expect(linkDue({ url: null, video_id: null, checked_at: null }, "https://x.example/a", NOW)).toBe(true);
    expect(linkDue({ url: "https://x.example/b", video_id: VIDEO, checked_at: at(0) }, "https://x.example/a", NOW)).toBe(true);
    expect(linkDue({ url: "https://x.example/a", video_id: VIDEO, checked_at: at(10 * 60_000) }, "https://x.example/a", NOW)).toBe(false);
    expect(linkDue({ url: "https://x.example/a", video_id: VIDEO, checked_at: at(20 * 60_000) }, "https://x.example/a", NOW)).toBe(true);
    expect(linkDue({ url: "https://x.example/a", video_id: null, checked_at: at(60 * 60_000) }, "https://x.example/a", NOW)).toBe(false);
    expect(linkDue({ url: "https://x.example/a", video_id: null, checked_at: at(3 * 3600_000) }, "https://x.example/a", NOW)).toBe(true);
  });
});

describe("resolveStreamLinks", () => {
  it("follows the short links of events on now, keeps the video per event, and the page plays it", async () => {
    await event("TODAY", "2026-10-31", "https://ftcwa.live/bardeen");
    await event("OLD", "2026-10-03", "https://ftcwa.live/bardeen");   // last month's meet: the link points elsewhere now
    await event("TWITCH", "2026-10-31", "https://twitch.tv/ftcwa");
    await event("DIRECT", "2026-10-31", `https://youtu.be/${NEXT}`);   // already YouTube: recordings reads it directly
    hops = { "https://ftcwa.live/bardeen": `https://www.youtube.com/live/${VIDEO}` };
    fetched.length = 0;
    expect(await resolveStreamLinks(() => {}, { fetchImpl: fakeFetch, now: () => NOW })).toBe(1);
    expect(fetched).toEqual(["https://ftcwa.live/bardeen"]);
    expect(await all("SELECT code, video_id FROM event_stream_links")).toEqual([{ code: "TODAY", video_id: VIDEO }]);
    clearAllCaches();
    expect((await eventRecording(S, "TODAY"))?.videoId).toBe(VIDEO);
    expect(await eventRecording(S, "OLD")).toBeNull();

    // Not due again within 15 minutes; after the event the video stays though the link moves on.
    fetched.length = 0;
    expect(await resolveStreamLinks(() => {}, { fetchImpl: fakeFetch, now: () => NOW + 60_000 })).toBe(0);
    expect(fetched).toEqual([]);
    hops = { "https://ftcwa.live/bardeen": `https://www.youtube.com/live/${NEXT}` };
    await resolveStreamLinks(() => {}, { fetchImpl: fakeFetch, now: () => NOW + 3 * 86_400_000 });
    clearAllCaches();
    expect((await eventRecording(S, "TODAY"))?.videoId).toBe(VIDEO);
  });

  it("drops the kept video once FIRST gives the event another link", async () => {
    await run("UPDATE events SET livestream = 'https://twitch.tv/other' WHERE code = 'TODAY'");
    clearAllCaches();
    expect(await eventRecording(S, "TODAY")).toBeNull();
  });
});
