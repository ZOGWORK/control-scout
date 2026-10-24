import { describe, expect, it } from "vitest";
import { apiFacts, fetchFromApi, fetchWatchPage, isoDuration, parseWatchPage } from "./youtube";

// The bits of a real watch page the reader looks at, in the order YouTube sends them.
const page = (playability: string, extra = "") => `<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"${playability}","playableInEmbed":true},"videoDetails":{"videoId":"x","lengthSeconds":"16541"},"microformat":{"playerMicroformatRenderer":{${extra}}}};</script></html>`;
const BROADCAST = `"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-05-02T12:58:13+00:00","endTimestamp":"2026-05-02T17:33:56+00:00"}`;

describe("reading a watch page", () => {
  it("a recorded broadcast: its start, end and length", () => {
    expect(parseWatchPage(page("OK", BROADCAST))).toEqual({ status: "ok", start: "2026-05-02T12:58:13.000Z", end: "2026-05-02T17:33:56.000Z", length: 16541, live: false });
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
      .toEqual({ status: "ok", start: "2026-05-02T12:58:13.000Z", end: "2026-05-02T17:33:56.000Z", length: 16541, live: false });
    expect(apiFacts({ contentDetails: { duration: "P0D" }, liveStreamingDetails: { actualStartTime: "2026-05-02T12:58:13Z" } })).toMatchObject({ live: true, length: null });
    expect(apiFacts({ liveStreamingDetails: { scheduledStartTime: "2026-05-03T12:00:00Z" } })).toMatchObject({ live: true, start: null });
    expect(apiFacts({ contentDetails: { duration: "PT3M33S" } })).toEqual({ status: "ok", start: null, end: null, length: 213, live: false });
  });
  it("asks for up to 50 at once; one missing from the answer is unavailable; a failed request leaves all to try again", async () => {
    let asked = "";
    const ok = (async (url: string) => { asked = url; return Response.json({ items: [{ id: "aaaaaaaaaaa", contentDetails: { duration: "PT1M" } }] }); }) as unknown as typeof fetch;
    const got = await fetchFromApi(["aaaaaaaaaaa", "bbbbbbbbbbb"], "KEY", ok);
    expect(new URL(asked).searchParams.get("id")).toBe("aaaaaaaaaaa,bbbbbbbbbbb");
    expect(new URL(asked).searchParams.get("part")).toBe("liveStreamingDetails,contentDetails");
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
