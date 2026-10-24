import { describe, expect, it } from "vitest";
import { fetchWatchPage, parseWatchPage } from "./youtube";

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
    expect(parseWatchPage(page("LOGIN_REQUIRED")).status).toBe("unavailable");
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
