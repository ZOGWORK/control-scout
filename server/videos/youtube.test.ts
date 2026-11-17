import { describe, expect, it } from "vitest";
import { apiFacts, fetchFromApi, fetchWatchPage, isoDuration, parseChapters, parseWatchPage } from "./youtube";

// The bits of a real watch page the reader looks at, in the order YouTube sends them.
const page = (playability: string, extra = "") => `<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"${playability}","playableInEmbed":true},"videoDetails":{"videoId":"x","lengthSeconds":"16541"},"microformat":{"playerMicroformatRenderer":{${extra}}}};</script></html>`;
const BROADCAST = `"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-05-02T12:58:13+00:00","endTimestamp":"2026-05-02T17:33:56+00:00"}`;

describe("reading a watch page", () => {
  it("a recorded broadcast: its start, end and length", () => {
    expect(parseWatchPage(page("OK", BROADCAST))).toEqual({ status: "ok", start: "2026-05-02T12:58:13.000Z", end: "2026-05-02T17:33:56.000Z", length: 16541, live: false, chapters: [], embeddable: true });
  });
  it("a broadcast still live", () => {
    const f = parseWatchPage(page("OK", `"liveBroadcastDetails":{"isLiveNow":true,"startTimestamp":"2026-05-02T12:58:13+00:00"}`));
    expect(f).toMatchObject({ status: "ok", live: true, end: null });
  });
  it("a scheduled broadcast not started yet: live with no start (its scheduled time is never used), so it's read again", () => {
    const f = parseWatchPage(page("LIVE_STREAM_OFFLINE", `"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-05-02T13:00:00+00:00"}`));
    expect(f).toMatchObject({ status: "ok", live: true, start: null });
  });
  it("an upload: plays, but no broadcast start to line matches up with", () => {
    expect(parseWatchPage(page("OK"))).toMatchObject({ status: "ok", start: null, length: 16541 });
  });
  it("a removed or private video is unavailable", () => {
    expect(parseWatchPage(page("ERROR")).status).toBe("unavailable");
    expect(parseWatchPage(page("UNPLAYABLE")).status).toBe("unavailable");
    expect(parseWatchPage(`"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"This video is private"}`).status).toBe("unavailable");
  });
  it("YouTube's sign-in wall for servers, or a status not seen before, is an error to try again, never a removed video", () => {
    expect(parseWatchPage(`"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you\u2019re not a bot"}`).status).toBe("error");
    expect(parseWatchPage(page("LOGIN_REQUIRED")).status).toBe("error");
    expect(parseWatchPage(page("CONTENT_CHECK_REQUIRED")).status).toBe("error");
  });
  it("the sign-in wall still gives the video's chapters (the server's only way to them), and nothing else", () => {
    const wall = `${page("LOGIN_REQUIRED")}<script>{"chapterRenderer":{"title":{"simpleText":"Match 1"},"timeRangeStartMillis":600000},"chapterRenderer":{"title":{"simpleText":"Match 2"},"timeRangeStartMillis":840000}}</script>`;
    expect(parseWatchPage(wall)).toEqual({ status: "error", start: null, end: null, length: null, live: false, chapters: [[600, "Match 1"], [840, "Match 2"]] });
    // A wall with none: the plain error, no empty list (an empty list would say "read, and it has none").
    expect(parseWatchPage(page("LOGIN_REQUIRED"))).not.toHaveProperty("chapters");
    // A private video's wall is still unavailable, chapters or not.
    expect(parseWatchPage(`"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"This video is private"}{"chapterRenderer":{"title":{"simpleText":"Match 1"},"timeRangeStartMillis":0}}`).status).toBe("unavailable");
  });
  it("a sign-in wall that does carry the length and broadcast times is read like a visitor's page", () => {
    const wall = `${page("LOGIN_REQUIRED", BROADCAST)}<script>{"chapterRenderer":{"title":{"simpleText":"Match 1"},"timeRangeStartMillis":600000}}</script>`;
    expect(parseWatchPage(wall)).toEqual({ status: "ok", start: "2026-05-02T12:58:13.000Z", end: "2026-05-02T17:33:56.000Z", length: 16541, live: false, chapters: [[600, "Match 1"]] });
    // The length alone (no broadcast times) is no clock to place matches by: still the error.
    expect(parseWatchPage(page("LOGIN_REQUIRED")).status).toBe("error");
    // So is an empty or start-less broadcast block: an error, read again later, never an "ok" with no clock.
    expect(parseWatchPage(page("LOGIN_REQUIRED", `"liveBroadcastDetails":{}`)).status).toBe("error");
    expect(parseWatchPage(page("LOGIN_REQUIRED", `"liveBroadcastDetails":{"isLiveNow":false,"endTimestamp":"2026-05-02T17:33:56+00:00"}`)).status).toBe("error");
  });
  it("a page without a player response (a consent wall) is an error, never a guess", () => {
    expect(parseWatchPage("<html>Before you continue to YouTube</html>").status).toBe("error");
  });
  it("network trouble and server errors are errors (tried again later); a 404 is unavailable", async () => {
    expect((await fetchWatchPage("x", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).status).toBe("error");
    expect((await fetchWatchPage("x", (async () => new Response("", { status: 503 })) as typeof fetch)).status).toBe("error");
    expect((await fetchWatchPage("x", (async () => new Response("", { status: 404 })) as typeof fetch)).status).toBe("unavailable");
    expect((await fetchWatchPage("x", (async () => new Response(page("OK", BROADCAST))) as typeof fetch)).start).toBe("2026-05-02T12:58:13.000Z");
  });
});

describe("the YouTube Data API", () => {
  it("reads ISO durations", () => {
    expect(isoDuration("PT4H35M41S")).toBe(16541);
    expect(isoDuration("PT59S")).toBe(59);
    expect(isoDuration("P1DT2H")).toBe(93600);
    expect(isoDuration("P0D")).toBeNull();
    expect(isoDuration(undefined)).toBeNull();
  });
  it("a recorded broadcast, one live now, one scheduled, an upload", () => {
    expect(apiFacts({ contentDetails: { duration: "PT4H35M41S" }, liveStreamingDetails: { actualStartTime: "2026-05-02T12:58:13Z", actualEndTime: "2026-05-02T17:33:56Z" } }))
      .toEqual({ status: "ok", start: "2026-05-02T12:58:13.000Z", end: "2026-05-02T17:33:56.000Z", length: 16541, live: false, embeddable: true });
    expect(apiFacts({ contentDetails: { duration: "P0D" }, liveStreamingDetails: { actualStartTime: "2026-05-02T12:58:13Z" } })).toMatchObject({ live: true, length: null });
    expect(apiFacts({ liveStreamingDetails: { scheduledStartTime: "2026-05-03T12:00:00Z" } })).toMatchObject({ live: true, start: null });
    expect(apiFacts({ contentDetails: { duration: "PT3M33S" } })).toEqual({ status: "ok", start: null, end: null, length: 213, live: false, embeddable: true });
  });
  it("a region block stops a video when it covers every country or its event's own: one that plays there keeps its clips", () => {
    // Live: FTC Ontario's Central Toronto Qualifier stream, blocked in all 249 (the watch page: UNPLAYABLE, "Video unavailable").
    const every = Array.from({ length: 249 }, (_, i) => `C${i}`);
    const at = (rule: object, homes?: string[]) => apiFacts({ contentDetails: { duration: "PT4H", regionRestriction: rule } }, homes);
    expect(apiFacts({ contentDetails: { duration: "PT8H22M15S", regionRestriction: { blocked: every } }, liveStreamingDetails: { actualStartTime: "2026-02-07T16:02:48Z" } }, ["CA"]))
      .toEqual({ status: "unavailable", start: null, end: null, length: null, live: false });
    expect(at({ blocked: every.slice(0, 240) })).toMatchObject({ status: "unavailable" });
    // Blocked in 60 countries but not the event's: it plays for the people who watch, so it keeps its clips.
    const sixty = [...every.slice(0, 59), "DE"];
    expect(at({ blocked: sixty }, ["US"])).toMatchObject({ status: "ok", length: 14400 });
    expect(at({ blocked: sixty })).toMatchObject({ status: "ok" });
    // Blocked in the event's own country (a US event blocked in the US; a German event blocked in Germany): it doesn't.
    expect(at({ blocked: ["US", "CA"] }, ["US"])).toMatchObject({ status: "unavailable" });
    expect(at({ blocked: sixty }, ["DE"])).toMatchObject({ status: "unavailable" });
    expect(at({ blocked: ["BY", "RU"] }, ["US"])).toMatchObject({ status: "ok" });
    // Allowed only elsewhere, or nowhere.
    expect(at({ allowed: ["BR"] }, ["US"])).toMatchObject({ status: "unavailable" });
    expect(at({ allowed: ["US", "CA"] }, ["US"])).toMatchObject({ status: "ok" });
    expect(at({ allowed: [] })).toMatchObject({ status: "unavailable" });
  });
  it("reads whether a video may be embedded: false plays on youtube.com only; a watch page's true only when it plays", () => {
    expect(apiFacts({ contentDetails: { duration: "PT4H" }, status: { embeddable: false } })).toMatchObject({ status: "ok", embeddable: false });
    expect(apiFacts({ contentDetails: { duration: "PT4H" }, status: { embeddable: true } })).toMatchObject({ embeddable: true });
    expect(apiFacts({ contentDetails: { duration: "PT4H" } })).toMatchObject({ embeddable: true });
    const page = (embed: string) => `"playabilityStatus":{"status":"OK","playableInEmbed":${embed}},"lengthSeconds":"600"`;
    expect(parseWatchPage(page("false"))).toMatchObject({ status: "ok", embeddable: false });
    // Embedding turned back on: a page that plays says so, so the stored false is replaced without the API key.
    expect(parseWatchPage(page("true"))).toMatchObject({ status: "ok", embeddable: true });
    // A sign-in wall read like a visitor's page (it carries the length and broadcast start) doesn't vouch for it.
    const wall = `"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you're not a bot","playableInEmbed":true},"lengthSeconds":"600","liveBroadcastDetails":{"startTimestamp":"2026-01-01T10:00:00+00:00"}`;
    expect(parseWatchPage(wall)).not.toHaveProperty("embeddable");
    expect(parseWatchPage(`"playabilityStatus":{"status":"OK"},"lengthSeconds":"600"`)).not.toHaveProperty("embeddable");
  });
  it("asks for up to 50 at once; one missing from the answer is unavailable; a failed request leaves all to try again", async () => {
    let asked = "";
    const ok = (async (url: string) => { asked = url; return Response.json({ items: [{ id: "aaaaaaaaaaa", contentDetails: { duration: "PT1M" } }] }); }) as unknown as typeof fetch;
    const got = await fetchFromApi(["aaaaaaaaaaa", "bbbbbbbbbbb"], "KEY", ok);
    expect(new URL(asked).searchParams.get("id")).toBe("aaaaaaaaaaa,bbbbbbbbbbb");
    expect(new URL(asked).searchParams.get("part")).toBe("liveStreamingDetails,contentDetails,status");
    expect(got.get("aaaaaaaaaaa")).toMatchObject({ status: "ok", length: 60 });
    expect(got.get("bbbbbbbbbbb")!.status).toBe("unavailable");
    const quota = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    expect([...(await fetchFromApi(["aaaaaaaaaaa"], "KEY", quota)).values()].map((f) => f.status)).toEqual(["error"]);
    // A 200 that isn't the expected shape says nothing about any video.
    for (const body of ["{}", '{"items":null}', '{"items":"x"}', "not json"]) {
      const odd = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
      expect([...(await fetchFromApi(["aaaaaaaaaaa"], "KEY", odd)).values()].map((f) => f.status)).toEqual(["error"]);
    }
  });
});

describe("a watch page's chapters", () => {
  it("each start once, in order, with its title (escapes read)", () => {
    const ch = (title: string, ms: number) => `"chapterRenderer":{"title":{"simpleText":"${title}"},"timeRangeStartMillis":${ms}}`;
    const html = [ch("Match two", 1431919), ch("Opening remarks", 0), ch("Match one", 866560), ch("Match one", 866560), ch("Kids \\u0026 robots", 2000000)].join(",");
    expect(parseChapters(html)).toEqual([[0, "Opening remarks"], [867, "Match one"], [1432, "Match two"], [2000, "Kids & robots"]]);
    expect(parseChapters("<html></html>")).toEqual([]);
  });
});
