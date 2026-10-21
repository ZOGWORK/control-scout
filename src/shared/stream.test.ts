import { describe, expect, it } from "vitest";
import { parseStreamUrl } from "./stream";

const ID = "dQw4w9WgXcQ";
const ok = (url: string) => {
  const p = parseStreamUrl(url);
  expect(p, url).toEqual({ ok: true, videoId: ID, embedUrl: `https://www.youtube-nocookie.com/embed/${ID}` });
};
const no = (url: string) => {
  const p = parseStreamUrl(url);
  expect(p.ok, url).toBe(false);
  return p.ok ? "" : p.error;
};

describe("parseStreamUrl", () => {
  it("watch, youtu.be, /live/ and /embed/ links all become the nocookie embed", () => {
    ok(`https://www.youtube.com/watch?v=${ID}`);
    ok(`https://youtube.com/watch?v=${ID}&t=42s&feature=share`);
    ok(`https://m.youtube.com/watch?v=${ID}`);
    ok(`https://youtu.be/${ID}?si=abc`);
    ok(`https://www.youtube.com/live/${ID}?si=xyz`);
    ok(`https://www.youtube-nocookie.com/embed/${ID}`);
    ok(`youtube.com/watch?v=${ID}`); // no scheme
  });

  it("a channel's live page is refused with what to paste instead", () => {
    expect(no("https://www.youtube.com/@FIRSTinMichigan/live")).toMatch(/channel's live page can't be shown/);
    expect(no("https://www.youtube.com/channel/UC1234567890/live")).toMatch(/channel's live page/);
  });

  it("anything that isn't YouTube is refused, and says YouTube only", () => {
    expect(no("https://www.twitch.tv/firstinspires")).toMatch(/Only YouTube streams/);
    expect(no("https://evil.example/youtube.com/watch?v=" + ID)).toMatch(/Only YouTube/);
    expect(no("javascript:alert(1)")).toMatch(/isn't/);
    expect(no("")).toMatch(/Paste a YouTube link/);
  });

  it("a YouTube link without a video id is refused", () => {
    expect(no("https://www.youtube.com/")).toMatch(/doesn't name a video/);
    expect(no("https://www.youtube.com/watch?v=short")).toMatch(/doesn't name a video/);
  });
});
