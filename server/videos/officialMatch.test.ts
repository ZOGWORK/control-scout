// The watcher's matcher (docs/official-videos.md): a video is added only when it's a full-length live broadcast that
// fits exactly one event of the channel's region on its broadcast date, its title agrees on the division, the
// designators, the date, the weekday and the day number, and it can be played here. Anything short of that is
// for the owner to review, and what isn't a competition stream is set aside.
import { describe, expect, it } from "vitest";
import { designators, matchVideo, parseRule, partOf, type WatchEvent, type WatchVideo } from "./officialMatch";

const ev = (code: string, name: string, extra: Partial<WatchEvent> = {}): WatchEvent => ({
  season: 2025, code, name, type: "Qualifier", city: "Austin", state: "TX", country: "USA", start: "2026-01-17", end: "2026-01-18",
  timezone: "America/Chicago", divisionCode: null, parent: false, ...extra,
});
const vid = (title: string, extra: Partial<WatchVideo> = {}): WatchVideo => ({
  videoId: "abcdefghijk", title, start: "2026-01-17T15:00:00Z", durationS: 6 * 3600, privacy: "public", embeddable: true, blockedIn: 0, ...extra,
});
const TX = { region: "state=TX", words: "texas fit" };

describe("the watcher's matcher", () => {
  it("adds a broadcast that fits exactly one event, with its day and part", () => {
    const events = [ev("USTXMOQ", "TX Mockingbird Qualifier"), ev("USTXHOQ", "TX Houston Qualifier", { city: "Houston" })];
    const v = matchVideo(vid("FiT Mockingbird Qualifier - Day 1"), TX, events);
    expect(v.kind).toBe("add");
    if (v.kind === "add") { expect(v.event.code).toBe("USTXMOQ"); expect(v.day).toBe("2026-01-17"); expect(v.part).toBeNull(); }
    const aw = matchVideo(vid("FiT Mockingbird Qualifier Day 2 - Awards", { start: "2026-01-18T22:00:00Z" }), TX, events);
    expect(aw.kind === "add" && aw.part).toBe("Awards");
  });

  it("sends anything short of certain to review", () => {
    const events = [ev("USTXMOQ", "TX Mockingbird Qualifier"), ev("USTXMOQ2", "TX Mockingbird Qualifier", { city: "Austin" })];
    expect(matchVideo(vid("Mockingbird Qualifier"), TX, events)).toMatchObject({ kind: "review", why: /fits both/ });
    const one = [ev("USTXMOQ", "TX Mockingbird Qualifier")];
    expect(matchVideo(vid("Mockingbird Qualifier", { start: null }), TX, one)).toMatchObject({ kind: "review", why: /upload/ });
    expect(matchVideo(vid("Mockingbird Qualifier", { durationS: 180 }), TX, one)).toMatchObject({ kind: "review", why: /clip or highlight/ });
    expect(matchVideo(vid("Mockingbird Qualifier Day 2"), TX, one)).toMatchObject({ kind: "review", why: /day 2/ });
    expect(matchVideo(vid("Mockingbird Qualifier - Sunday"), TX, one)).toMatchObject({ kind: "review", why: /says sunday/ });
    expect(matchVideo(vid("Mockingbird Qualifier 1/18/2026"), TX, one)).toMatchObject({ kind: "review", why: /date/ });
    // The year counts too.
    expect(matchVideo(vid("Mockingbird Qualifier 1/17/2027"), TX, one)).toMatchObject({ kind: "review", why: /2027-01-17/ });
    expect(matchVideo(vid("Mockingbird Qualifier 1/17/2026"), TX, one).kind).toBe("add");
    expect(matchVideo(vid("Mockingbird Qualifier 17.01.26"), TX, one).kind).toBe("add");
    expect(matchVideo(vid("Mockingbird Qualifier 17.01.27"), TX, one).kind).toBe("review");
    // Any weekday the title names must be the broadcast's (2026-01-17 was a Saturday).
    expect(matchVideo(vid("Mockingbird Qualifier - Monday"), TX, one)).toMatchObject({ kind: "review", why: /says monday/ });
    expect(matchVideo(vid("Mockingbird Qualifier - Saturday"), TX, one).kind).toBe("add");
    // Two events that both fit go to review, even when one scores higher.
    const two = [ev("USTXMOQ", "TX Mockingbird Qualifier"), ev("USTXMOM3", "TX Mockingbird League Meet 3")];
    expect(matchVideo(vid("Mockingbird League Meet 3"), TX, two)).toMatchObject({ kind: "review", why: /fits both/ });
    expect(matchVideo(vid("Mockingbird Qualifier", { blockedIn: 249 }), TX, one)).toMatchObject({ kind: "review", why: /blocked in 249/ });
    expect(matchVideo(vid("Mockingbird Qualifier", { embeddable: false }), TX, one)).toMatchObject({ kind: "review", why: /not embeddable/ });
    expect(matchVideo(vid("Mockingbird Qualifier", { privacy: "unlisted" }), TX, one)).toMatchObject({ kind: "review", why: /unlisted/ });
    // A state name and a type alone aren't evidence.
    expect(matchVideo(vid("Texas Qualifier"), TX, one)).toMatchObject({ kind: "review", why: /no event on that date fits/ });
    // No event of the channel's region that day.
    expect(matchVideo(vid("Mockingbird Qualifier"), { region: "state=IA" }, one)).toMatchObject({ kind: "review", why: /no Scout event/ });
    expect(matchVideo(vid("Mockingbird Qualifier", { start: "2026-02-20T15:00:00Z" }), TX, one)).toMatchObject({ kind: "review" });
  });

  it("keeps divisions apart, and a parent event never gets a division's video", () => {
    const events = [
      ev("ROCMP", "Romania Championship", { country: "Romania", state: "B", city: "Bucharest", type: "Championship", parent: true, timezone: "Europe/Bucharest" }),
      ev("ROCMPCND", "Romania Championship - COANDA Division", { country: "Romania", state: "B", city: "Bucharest", type: "Championship", divisionCode: "ROCMP", timezone: "Europe/Bucharest" }),
      ev("ROCMPVLC", "Romania Championship - VLAICU Division", { country: "Romania", state: "B", city: "Bucharest", type: "Championship", divisionCode: "ROCMP", timezone: "Europe/Bucharest" }),
    ];
    const RO = { region: "country=Romania", words: "romania", titlePattern: "romania|national" };
    const v = matchVideo(vid("Campionatul National FTC Romania - Divizia COANDĂ - Day 1"), RO, events);
    expect(v.kind === "add" && v.event.code).toBe("ROCMPCND");
    // The parent only for a video that names no division.
    const fin = matchVideo(vid("Campionatul National FTC Romania - Finala & Ceremonia de premiere"), RO, events);
    expect(fin.kind === "add" && fin.event.code).toBe("ROCMP");
  });

  it("adds FIRST HQ's Championship broadcasts by the seeded rule", async () => {
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const hq = OFFICIAL_CHANNELS.find((c) => c.channelId === "UCkWMXdRQr5yoZRz7gFYyRcw")!;
    const cmp = { country: "USA", state: "TX", city: "Houston", type: "FIRSTChampionship", start: "2026-04-29", end: "2026-05-02" } as const;
    const events = [ev("FTCCMP1", "FIRST Championship", { ...cmp, parent: true }), ev("FTCCMP1FRAN", "FIRST Championship - Franklin Division", { ...cmp, divisionCode: "FTCCMP1" })];
    const day = { start: "2026-05-02T20:00:00Z" };
    const parent = matchVideo(vid("FIRST Championship Houston - Einstein Finals", day), hq, events);
    expect(parent.kind === "add" && parent.event.code).toBe("FTCCMP1");
    const div = matchVideo(vid("2026 FIRST Championship - Franklin Division", { start: "2026-04-30T14:00:00Z" }), hq, events);
    expect(div.kind === "add" && div.event.code).toBe("FTCCMP1FRAN");
  });

  it("makes designators agree: league letters, meet numbers, UIL classes", () => {
    const events = [ev("USTXNTAM1", "NTX A-League Meet 1"), ev("USTXNTBM1", "NTX B-League Meet 1")];
    const v = matchVideo(vid("NTX B-League Meet 1"), { region: "state=TX", words: "texas ntx" }, events);
    expect(v.kind === "add" && v.event.code).toBe("USTXNTBM1");
    expect(designators("FiT UIL State Championship 5A")).toMatchObject({ uil: "5A" });
    expect(designators("Qualifier #3")).toMatchObject({ n: 3 });
  });

  it("sets aside what isn't a competition stream", () => {
    expect(matchVideo(vid("Kickoff 2026: DECODE reveal"), TX, [])).toMatchObject({ kind: "ignore" });
    expect(matchVideo(vid("FRC District Event - Austin"), TX, [])).toMatchObject({ kind: "ignore" });
    expect(matchVideo(vid("Coach webinar"), TX, [])).toMatchObject({ kind: "ignore" });
  });

  it("reads region rules, and refuses one it can't", () => {
    const e = ev("X", "Michiana Premier Event", { state: "IN", type: "Premier" });
    expect(parseRule("state=IN;name=michiana|gears")!(e)).toBe(true);
    expect(parseRule("country=USA;type=Premier,OffSeason")!(e)).toBe(true);
    expect(parseRule("state=IL")!(e)).toBe(false);
    expect(parseRule("planet=Mars")).toBeNull();
    expect(parseRule("name=(")).toBeNull();
    expect(parseRule("")).toBeNull();
    expect(partOf("Day 2 Matches 6-14")).toBe("Matches 6–14");
  });
});
