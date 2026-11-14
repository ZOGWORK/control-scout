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
    expect(matchVideo(vid("Mockingbird Qualifier", { durationS: null }), TX, one)).toMatchObject({ kind: "review", why: /no length/ });
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

  it("FIRST Australia's seeded rule knows APOC by name (a word boundary, not a backspace)", async () => {
    const { OFFICIAL_CHANNELS } = await import("../data/officialChannels");
    const au = OFFICIAL_CHANNELS.find((c) => c.channelId === "UCal7624DPridi_9iKLrAbqw")!;
    expect(au.titlePattern).not.toMatch(/\x08/);
    const named = new RegExp(au.titlePattern!, "i");
    expect(["FTC APOC 2025, Qualification & Playoff matches", "FIRST Tech Challenge Asia Pacific Open Championship 2026 day 3", "FIRST Tech Challenge Australian National Championship Day 2"].map((t) => named.test(t))).toEqual([true, true, true]);
    expect(named.test("Tapocalypse scrimmage")).toBe(false);
    // The country's name alone isn't one of its own events: an "Australian Qualifier" goes to review, never added.
    expect(named.test("FIRST Tech Challenge Australian Qualifier")).toBe(false);
    const q = ev("AUSYQ1", "Sydney South Qualifier", { country: "Australia", state: "NSW", city: "Sydney", start: "2025-11-16", end: "2025-11-16", timezone: "Australia/Sydney" });
    expect(matchVideo(vid("Australian Qualifier", { start: "2025-11-15T22:00:00Z" }), au, [q]).kind).toBe("review");
    const apoc = ev("AUSYOS", "APOC", { country: "Australia", state: "NSW", city: "Sydney", type: "OffSeason", start: "2026-07-03", end: "2026-07-05", timezone: "Australia/Sydney" });
    const v = matchVideo(vid("FTC APOC 2026, Qualifications Day 1", { start: "2026-07-03T05:19:22Z" }), au, [apoc]);
    expect(v.kind === "add" && v.event.code).toBe("AUSYOS");
    // APOC by its full name: the event is named by the acronym the title spells out (FIRST Australia's 2026 titles).
    const spelled = matchVideo(vid("FIRST Tech Challenge Asia Pacific Open Championship 2026 day 1", { start: "2026-07-03T05:19:22Z" }), au, [apoc]);
    expect(spelled.kind === "add" && spelled.event.code).toBe("AUSYOS");
  });

  it("an event named by an acronym fits a title spelling it out, never by a common one (FTC)", () => {
    const apoc = ev("AUSYOS", "APOC", { country: "Australia", type: "OffSeason", start: "2026-07-03", end: "2026-07-05", timezone: "Australia/Sydney" });
    const AU = { region: "country=Australia" };
    expect(matchVideo(vid("Asia Pacific Open Championship - Day 1", { start: "2026-07-03T05:00:00Z" }), AU, [apoc]).kind).toBe("add");
    // The words have to be in a row, and spell the whole acronym.
    expect(matchVideo(vid("Asia Pacific robotics Open - Day 1", { start: "2026-07-03T05:00:00Z" }), AU, [apoc]).kind).toBe("review");
    // "FIRST Tech Challenge" spells FTC, which names no particular event.
    const ftc = ev("AUNSWQ", "AU-NSW FTC Qualifying Tournament", { country: "Australia", start: "2026-07-03", end: "2026-07-03", timezone: "Australia/Sydney" });
    expect(matchVideo(vid("FIRST Tech Challenge - Day 1", { start: "2026-07-03T05:00:00Z" }), AU, [ftc]).kind).toBe("review");
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

  // The watcher audit of 2026-11-13 (docs/official-videos.md, "The auto-watcher"): real titles of the live channels.
  it("a title naming the region and one event's own word fits that event, not every event of the region that day", () => {
    const IA = { region: "state=IA", words: "iowa", titlePattern: "iowa" };
    const day = { state: "IA", type: "LeagueMeet", start: "2026-11-07", end: "2026-11-07", timezone: "America/Chicago" } as const;
    const events = [ev("USIAIRISM3", "Iris Manson", { ...day, city: "Manson" }), ev("USIADAIM1", "Daisy Martensdale", { ...day, city: "Martensdale" }),
      ev("USIAWINBM4", "Wnterberry Waterloo", { ...day, city: "Waterloo" })];
    const at = { start: "2026-11-07T15:00:00Z" };
    const iris = matchVideo(vid("FTC Iowa Iris League Meet: 2026-11-07", at), IA, events);
    expect(iris.kind === "add" && iris.event.code).toBe("USIAIRISM3");
    const wb = matchVideo(vid("FTC Iowa Winterberry League Meet: Waterloo", at), IA, events);
    expect(wb.kind === "add" && wb.event.code).toBe("USIAWINBM4");
    // The region's name alone still can't choose between its events.
    expect(matchVideo(vid("FTC Iowa League Meet", at), IA, events)).toMatchObject({ kind: "review", why: /fits both/ });
  });

  it("a meet split in two keeps its letter: Meet #1 is not Meet #1a", () => {
    const day = { city: "Plano", type: "LeagueMeet", start: "2026-10-31", end: "2026-10-31" } as const;
    const events = [ev("USTXNONIM1", "NTX I-League Meet #1", day), ev("USTXNONIM2", "NTX I-League Meet #1a", day)];
    const NTX = { region: "state=TX", words: "texas ntx fit north" };
    const v = matchVideo(vid("NTX FTC I-League Meet #1 (26.10.31)", { start: "2026-10-31T14:00:00Z" }), NTX, events);
    expect(v.kind === "add" && v.event.code).toBe("USTXNONIM1");
    const a = matchVideo(vid("NTX FTC I-League Meet #1a", { start: "2026-10-31T14:00:00Z" }), NTX, events);
    expect(a.kind === "add" && a.event.code).toBe("USTXNONIM2");
    expect(designators("Meet 1 - 11-07-26")).toMatchObject({ meet: "1" });
  });

  it("tells two leagues of one meet day apart by the word the title says: Diamond is never Emerald", () => {
    const day = { city: "Austin", type: "LeagueMeet", start: "2026-11-14", end: "2026-11-14" } as const;
    const events = [ev("USTXCEGDM2", "CTX GEMS Diamond League Meet 2", day), ev("USTXCEGEM2", "CTX GEMS Emerald League Meet 2", day),
      ev("USTXCEXAM1", "CTX X-Stream A League Meet 1", day)];
    const WW = { region: "state=TX;name=\\bCTX\\b|FiT-Central|GEMS", words: "texas fit central ctx" };
    const at = { start: "2026-11-14T17:00:00Z" };
    const d = matchVideo(vid("CTX GEMS Diamond League Meet 2 | FTC® BIOBUZZ™", at), WW, events);
    expect(d.kind === "add" && d.event.code).toBe("USTXCEGDM2");
    const e = matchVideo(vid("CTX GEMS Emerald League Meet 2 | FTC® BIOBUZZ™", at), WW, events);
    expect(e.kind === "add" && e.event.code).toBe("USTXCEGEM2");
    // Naming neither league: still the owner's.
    expect(matchVideo(vid("CTX GEMS League Meet 2", at), WW, events)).toMatchObject({ kind: "review", why: /fits both/ });
    // A city too: Austin's semi-regional isn't San Antonio's.
    const sr = { type: "SuperQualifier", start: "2026-02-14", end: "2026-02-14" } as const;
    const semis = [ev("USTXAUSQ", "FiT-Central Austin Semi-Regional", { ...sr, city: "Austin" }), ev("USTXSASQ", "FiT-Central San Antonio Semi-Regional", { ...sr, city: "San Antonio" })];
    const a = matchVideo(vid("FiT-Central Austin Semi-Regional | FTC® DECODE™", { start: "2026-02-14T17:21:17Z" }), WW, semis);
    expect(a.kind === "add" && a.event.code).toBe("USTXAUSQ");
  });

  it("a title naming two events (a joint meet) stays the owner's, never a third event that shares one word", () => {
    const day = { city: "San Antonio", type: "LeagueMeet", start: "2024-12-14", end: "2024-12-14" } as const;
    const events = [ev("USTXCAM3", "FiT-Central Hill Country League Meet 2", day), ev("USTXCAM4", "FiT-Central North San Antonio League Meet 2", day),
      ev("USTXNINLT", "FiT-North I&N Tournament", { ...day, type: "LeagueTournament", city: "Richardson" })];
    const v = matchVideo(vid("FIRST Tech Challenge- Into the Deep: Hill Country & North SA League Meet 2", { start: "2024-12-14T16:00:00Z" }), { region: "state=TX", words: "texas fit" }, events);
    expect(v).toMatchObject({ kind: "review", why: /fits both USTXCAM3 and USTXCAM4/ });
    // Also when the channel's own words take the shared prefix away ("central") and "SA" leaves San Antonio half said.
    const two = matchVideo(vid("FIRST Tech Challenge- Into the Deep: Hill Country & North SA League Meet 2", { start: "2024-12-14T16:00:00Z" }),
      { region: "state=TX", words: "texas fit central ctx" }, events.slice(0, 2));
    expect(two).toMatchObject({ kind: "review", why: /fits both/ });
  });

  it("sets aside a short video that names no event: an upload, a call, a team's reel", () => {
    const one = [ev("USTXMOQ", "TX Mockingbird Qualifier")];
    expect(matchVideo(vid("Compact Differential Swerve Drive | 23334 Axiom | FTC BIOBUZZ Snapshot", { start: null, durationS: 79 }), TX, one)).toMatchObject({ kind: "ignore", why: /1-minute upload/ });
    expect(matchVideo(vid("FTC Program Call Nov 12, 2026 Recording", { durationS: 22 * 60 }), TX, one)).toMatchObject({ kind: "ignore", why: /22 minutes long, and its title fits no event/ });
    expect(matchVideo(vid("FTC Program Call", { durationS: 22 * 60 }), { region: "state=WI" }, one)).toMatchObject({ kind: "ignore", why: /no Scout event/ });
    // Short and about one event: the owner decides (a highlight, or a clip of the day).
    expect(matchVideo(vid("Mockingbird Qualifier", { durationS: 180 }), TX, one)).toMatchObject({ kind: "review", why: /clip or highlight/, event: { code: "USTXMOQ" } });
    // A full-length upload might be a re-uploaded day: the owner decides.
    expect(matchVideo(vid("Mockingbird Qualifier", { start: null }), TX, one)).toMatchObject({ kind: "review", why: /upload/ });
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
