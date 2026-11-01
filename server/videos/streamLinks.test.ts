// Short stream links (ftcwa.live/bardeen → a YouTube broadcast): followed only on the event's own dates, kept per
// event, played on the event page; a link that leads nowhere, a channel page, Twitch or a private address gives
// nothing, a failed request keeps what was found, and back-to-back meets on one link each keep their own video.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { eventRecording } from "./recordings";
import { followable, linkDue, publicAddress, resolveShortLink, resolveStreamLinks, type Hop } from "./streamLinks";

const S = 2026;
const NOW = Date.parse("2026-10-31T19:00:00Z"); // noon on Oct 31 in Seattle
const DAY_MS = 86_400_000;
const VIDEO = "1h77FVxAbQQ", NEXT = "WQUBVjbh-hM", THIRD = "dQw4w9WgXcQ";

// Each link's redirect (null: a page, "error": the request failed).
let hops: Record<string, string | null | "error"> = {};
const asked: string[] = [];
const hop: Hop = async (u) => { asked.push(u.href); return hops[u.href] ?? null; };
const LINK = "https://ftcwa.live/bardeen";
const to = (id: string) => `https://www.youtube.com/live/${id}`;

async function event(code: string, start: string, livestream: string | null) {
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'LeagueMeet', ?, ?, 'America/Los_Angeles', 0, 0, ?, 'test')", [S, code, `Event ${code}`, start, start, livestream]);
}
const resolve = (now: number) => resolveStreamLinks(() => {}, { hop, now: () => now });
const kept = async (code: string) => { clearAllCaches(); return (await eventRecording(S, code))?.videoId ?? null; };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
});

describe("resolveShortLink", () => {
  it("follows redirects to the YouTube video they end at, never asking YouTube", async () => {
    hops = { [LINK]: "https://bit.ly/x", "https://bit.ly/x": to(VIDEO) };
    asked.length = 0;
    expect(await resolveShortLink(LINK, hop)).toBe(VIDEO);
    expect(asked).toEqual([LINK, "https://bit.ly/x"]);
  });
  it("passes through a host that only has 'youtu' in its name, and stops at YouTube's own", async () => {
    hops = { "https://region.example/youtube": "https://youtube-links.example/go", "https://youtube-links.example/go": to(VIDEO) };
    expect(await resolveShortLink("https://region.example/youtube", hop)).toBe(VIDEO);
  });
  it("gives nothing for a page, a channel's live page, a non-YouTube end or a redirect loop; error for a failed request", async () => {
    hops = { "https://a.example/ch": "https://www.youtube.com/@FTCWA/live", "https://a.example/tw": "https://twitch.tv/ftcwa", "https://a.example/loop": "https://a.example/loop", "https://a.example/down": "error" };
    expect(await resolveShortLink("https://a.example/page", hop)).toBeNull();
    expect(await resolveShortLink("https://a.example/ch", hop)).toBeNull();
    expect(await resolveShortLink("https://a.example/tw", hop)).toBeNull();
    expect(await resolveShortLink("https://a.example/loop", hop)).toBeNull();
    expect(await resolveShortLink("not a link", hop)).toBeNull();
    expect(await resolveShortLink("https://a.example/down", hop)).toBe("error");
  });
  it("never asks for an address literal, localhost or an internal name, even one a redirect points at", async () => {
    for (const bad of ["http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "https://router.local/x", "https://a.example:8080/x", "ftp://a.example/x", "http://intranet/x"]) {
      expect(followable(new URL(bad)), bad).toBe(false);
    }
    expect(followable(new URL(LINK))).toBe(true);
    hops = { "https://a.example/in": "http://169.254.169.254/latest" };
    asked.length = 0;
    expect(await resolveShortLink("https://a.example/in", hop)).toBeNull();
    expect(asked).toEqual(["https://a.example/in"]);
  });
  it("connects only to public addresses (what a name resolves to is checked at connect time)", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(publicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(publicAddress(ip), ip).toBe(true);
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
  it("follows the short links of events on today, keeps the video per event, and the page plays it", async () => {
    await event("TODAY", "2026-10-31", LINK);
    await event("OLD", "2026-10-03", LINK);       // last month's meet: the link points elsewhere now
    await event("TWITCH", "2026-10-31", "https://twitch.tv/ftcwa");
    await event("DIRECT", "2026-10-31", `https://youtu.be/${THIRD}`); // already YouTube: recordings reads it directly
    hops = { [LINK]: to(VIDEO) };
    asked.length = 0;
    expect(await resolve(NOW)).toBe(1);
    expect(asked).toEqual([LINK]);
    expect(await all("SELECT code, video_id FROM event_stream_links")).toEqual([{ code: "TODAY", video_id: VIDEO }]);
    expect(await kept("TODAY")).toBe(VIDEO);
    expect(await kept("OLD")).toBeNull();
    expect(await kept("DIRECT")).toBe(THIRD);

    // Not due again within 15 minutes.
    asked.length = 0;
    expect(await resolve(NOW + 60_000)).toBe(0);
    expect(asked).toEqual([]);
  });

  it("keeps the found video when a later request fails or the link stops leading anywhere", async () => {
    hops = { [LINK]: "error" };
    await resolve(NOW + 20 * 60_000);
    expect(await kept("TODAY")).toBe(VIDEO);
    hops = { [LINK]: null };
    await resolve(NOW + 40 * 60_000);
    expect(await kept("TODAY")).toBe(VIDEO);
  });

  it("back-to-back meets on one link: the next day's meet never takes or overwrites the first's broadcast", async () => {
    await event("SUNDAY", "2026-11-01", LINK);
    // Sunday morning, the link still on Saturday's broadcast: not Sunday's video.
    hops = { [LINK]: to(VIDEO) };
    await resolve(NOW + DAY_MS - 4 * 3600_000);
    expect(await kept("SUNDAY")).toBeNull();
    // Then it moves to Sunday's: Sunday gets it, Saturday (its dates over) keeps its own.
    hops = { [LINK]: to(NEXT) };
    await resolve(NOW + DAY_MS);
    expect(await kept("SUNDAY")).toBe(NEXT);
    expect(await kept("TODAY")).toBe(VIDEO);
  });

  it("drops the kept video once FIRST gives the event another link", async () => {
    await run("UPDATE events SET livestream = 'https://twitch.tv/other' WHERE code = 'TODAY'");
    expect(await kept("TODAY")).toBeNull();
  });
});
