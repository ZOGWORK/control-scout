// An answer's video (server/api/answers/video.ts), on three real 2025–26 events as synced (events, video_meta, matches):
//   Chesapeake Championship  a recording of the Saturday only: its Sunday finals get no second in it, the event its stream
//   Massachusetts Championship  one recording of the day, no FIRST videos: each match from its second in it
//   Edison Division (Worlds)  FIRST's own video of every playoff match
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { forgetRecordings } from "../../videos/recordings";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { answerVideo, mainRef, refOfHref } from "./video";
import type { SearchAnswer } from "../../../src/shared/api";
import type { StatAnswer, StatMatchRow } from "../../../src/shared/searchStat";

let client: ReturnType<typeof openDb>;
beforeAll(async () => {
  client = openDb(":memory:");
  setDb(client);
  await migrate(client);
  const events = [
    ["USCHSCMP", "Chesapeake Championship", "Championship", "Doswell", "VA", "2026-02-06", "2026-02-08", "America/New_York", "https://www.youtube.com/watch?v=Z2ArRHRiwh0"],
    ["USMACMP", "Massachusetts Championship", "Championship", "Boston", "MA", "2026-03-15", "2026-03-15", "America/New_York", "https://www.youtube.com/watch?v=xnQFL9T27fY"],
    ["FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", "Houston", "TX", "2026-04-29", "2026-05-02", "America/Chicago", "https://www.youtube.com/watch?v=WQUBVjbh-hM"],
    // No stream link: nothing to show.
    ["USNJCMP", "New Jersey Championship", "Championship", "Edison", "NJ", "2026-03-14", "2026-03-15", "America/New_York", null],
  ];
  for (const [code, name, type, city, state, start, end, tz, live] of events) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, livestream, source) VALUES (2025, ?, ?, ?, ?, ?, 'USA', ?, ?, ?, ?, 't')", [code, name, type, city, state, start, end, tz, live]);
  }
  const meta = [
    ["Z2ArRHRiwh0", "2026-02-07T17:49:21.000Z", "2026-02-07T23:30:28.000Z", 20221, '[[2658,"Match 1"],[2774,"Match 2"]]'],
    ["xnQFL9T27fY", "2026-03-15T13:34:16.000Z", "2026-03-15T23:24:29.000Z", 35335, "[]"],
    ["WQUBVjbh-hM", "2026-05-02T12:58:13.000Z", "2026-05-02T17:33:56.000Z", 16541, '[[5614,"Playoff match one"],[6184,"Playoff match two"]]'],
  ] as const;
  for (const [id, start, end, length, chapters] of meta) {
    await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at, chapters) VALUES (?, 'ok', ?, ?, ?, 0, '2026-11-04T07:01:00.000Z', ?)", [id, start, end, length, chapters]);
  }
  const matches = [
    ["USCHSCMP", "playoff", 0, 1, "F1", "2026-02-08T16:12:58.8", null, 216, 218],
    ["USCHSCMP", "playoff", 0, 2, "F2", "2026-02-08T16:29:30.829", null, 165, 240],
    ["USMACMP", "qual", 0, 1, "Q1", "2026-03-15T11:19:01.692", null, 170, 221],
    ["USMACMP", "qual", 0, 12, "Q12", "2026-03-15T12:21:07.313", null, 97, 83],
    ["USMACMP", "qual", 0, 30, "Q30", "2026-03-15T15:04:12.812", null, 88, 178],
    ["USMACMP", "playoff", 10, 1, "M10", "2026-03-15T18:47:08.165", null, 404, 302],
    ["FTCCMP1EDIS", "playoff", 1, 1, "M1", "2026-05-02T09:36:03.738", "https://www.youtube.com/watch?v=ruupjlPEQns", 533, 336],
    ["FTCCMP1EDIS", "playoff", 2, 1, "M2", "2026-05-02T09:42:47.528", "https://www.youtube.com/watch?v=4elyC6MxtEY", 316, 453],
  ] as const;
  for (const [code, level, series, number, label, time, video, red, blue] of matches) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, video, source) VALUES (2025, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 't')",
      [code, level, series, number, label, time, red, red, blue, blue, video]);
  }
  forgetRecordings();
});

const href = (code: string, key?: string) => `/events/2025/${code}${key ? `?match=${key}` : ""}`;
const row = (code: string, key: string, label: string): StatMatchRow => ({
  label, href: href(code, key), event: { label: code, href: href(code) }, season: "2025–26", date: null, alliance: "red", own: 1, opp: 0, result: "W",
});
const stat = (s: Partial<StatAnswer>): SearchAnswer => ({
  q: "q", hits: [], pages: [], step: "deterministic", weak: false,
  stat: { family: "superlative", intent: "x", title: "x", scope: [], blocks: [], definition: "", source: "", ...s },
});
const NOW = Date.parse("2026-11-05T00:00:00Z");

describe("answerVideo: the one match or event an answer is about", () => {
  it("a match with FIRST's own video plays that video (Edison Division M1)", async () => {
    const v = await answerVideo(stat({ headline: { value: "533 points", label: "M1", href: href("FTCCMP1EDIS", "playoff:1:1") } }), NOW);
    expect(v?.main).toEqual({ videoId: "ruupjlPEQns", t: 0, kind: "match", match: "M1" });
  });

  it("a match with only the event's recording starts it at the match's second (Massachusetts Q12)", async () => {
    // 12:21:07 EDT is 16:21:07Z, 2 h 46 min 51 s into the broadcast, less the 20 s lead-in.
    const v = await answerVideo(stat({ headline: { value: "97–83", label: "Q12", href: href("USMACMP", "qual:0:12") } }), NOW);
    expect(v?.main).toEqual({ videoId: "xnQFL9T27fY", t: 9991, kind: "recording", match: "Q12" });
  });

  it("a match the recording doesn't hold gets the event's stream from its start (Chesapeake F1, the next day)", async () => {
    const v = await answerVideo(stat({ headline: { value: "216–218", label: "F1", href: href("USCHSCMP", "playoff:0:1") } }), NOW);
    expect(v?.main).toEqual({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream" });
  });

  it("an event answer plays the event's stream: a headline's event, a card's event, matches all at one event", async () => {
    const stream = { videoId: "xnQFL9T27fY", t: 0, kind: "stream" };
    expect((await answerVideo(stat({ headline: { value: "#3", label: "x", href: "/events/2025/USMACMP?team=4215" } }), NOW))?.main).toEqual(stream);
    const card: SearchAnswer = { q: "q", hits: [], pages: [], step: "deterministic", weak: false, card: { kind: "event-awards", title: "Awards", lines: [], event: { season: 2025, code: "USCHSCMP", name: "Chesapeake Championship" } } };
    expect((await answerVideo(card, NOW))?.main).toEqual({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream" });
    const there = stat({ blocks: [{ kind: "matches", title: "Matches there", rows: [row("USMACMP", "qual:0:1", "Q1"), row("USMACMP", "qual:0:30", "Q30")] }] });
    expect((await answerVideo(there, NOW))?.main).toEqual(stream);
  });

  it("names: a match hit, or an event the words name exactly; never a set of events", async () => {
    const names = (hits: SearchAnswer["hits"], kind: "names" | "events" = "names"): SearchAnswer => ({ q: "q", hits, pages: [], step: "deterministic", weak: false, understood: { kind, label: "x" } });
    const ev = { kind: "event" as const, ref: "2025:FTCCMP1EDIS", title: "Edison", subtitle: "", season: 2025, match: "exact" as const };
    expect((await answerVideo(names([{ kind: "match", ref: "2025:USMACMP:qual:0:12", title: "Q12", subtitle: "", season: 2025 }]), NOW))?.main?.t).toBe(9991);
    expect((await answerVideo(names([ev]), NOW))?.main).toEqual({ videoId: "WQUBVjbh-hM", t: 0, kind: "stream" });
    expect(await answerVideo(names([ev], "events"), NOW)).toBeUndefined();
    expect(await answerVideo(names([{ ...ev, match: "fuzzy" }]), NOW)).toBeUndefined();
  });

  it("no video: nothing at all (an event with no stream, a team's season)", async () => {
    expect(await answerVideo(stat({ headline: { value: "x", label: "x", href: "/events/2025/USNJCMP" } }), NOW)).toBeUndefined();
    expect(await answerVideo(stat({ headline: { value: "x", label: "x", href: "/teams/4215?season=2025" } }), NOW)).toBeUndefined();
  });
});

describe("answerVideo: a list's play buttons", () => {
  const top = () => stat({
    headline: { value: "533 points", label: "M1", href: href("FTCCMP1EDIS", "playoff:1:1") },
    blocks: [
      { kind: "matches", title: "Top", rows: [row("FTCCMP1EDIS", "playoff:1:1", "M1"), row("FTCCMP1EDIS", "playoff:2:1", "M2"), row("USMACMP", "playoff:10:1", "M10"), row("USCHSCMP", "playoff:0:1", "F1")] },
      { kind: "table", title: "Combined", columns: [], rows: [{ cells: {}, href: href("USMACMP", "qual:0:1") }, { cells: {}, href: "/teams/4215" }] },
    ],
  });

  it("each listed match with a clip, keyed by its row's link; none for one without, none twice for the card's own", async () => {
    const v = await answerVideo(top(), NOW);
    expect(v?.main?.videoId).toBe("ruupjlPEQns");
    expect(v?.rows).toEqual({
      [href("FTCCMP1EDIS", "playoff:2:1")]: { videoId: "4elyC6MxtEY", t: 0, kind: "match", match: "M2" },
      [href("USMACMP", "playoff:10:1")]: { videoId: "xnQFL9T27fY", t: 33152, kind: "recording", match: "M10" },
      [href("USMACMP", "qual:0:1")]: { videoId: "xnQFL9T27fY", t: 6265, kind: "recording", match: "Q1" },
    });
  });

  it("reads the database once for the whole answer, however many rows (the season maps are kept)", async () => {
    await answerVideo(top(), NOW);
    const spy = vi.spyOn(client, "execute");
    try {
      await answerVideo(top(), NOW);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
});

describe("answerVideo: an answer about a team plays one of its own matches", () => {
  const theirs = (rows: StatMatchRow[]) => stat({ intent: "team-highlights", team: { number: 4215, name: null },
    headline: { value: "x", label: "x", href: rows[0].href }, blocks: [{ kind: "matches", title: "Highlights", rows: rows.map((r, i) => ({ ...r, note: `Reason ${i}` })) }] });

  it("its best match with no clip: its next listed match with one, never the event's recording from its start", async () => {
    // Chesapeake's Sunday finals have no second in its Saturday recording.
    const v = await answerVideo(theirs([row("USCHSCMP", "playoff:0:1", "F1"), row("USCHSCMP", "playoff:0:2", "F2"), row("FTCCMP1EDIS", "playoff:1:1", "M1")]), NOW);
    expect(v?.main).toEqual({ videoId: "ruupjlPEQns", t: 0, kind: "match", match: "M1" });
    expect(v?.mainRow).toBe(href("FTCCMP1EDIS", "playoff:1:1"));
    expect(v?.rows?.[href("FTCCMP1EDIS", "playoff:1:1")]).toBeUndefined();
  });

  it("none of its matches has a clip: the event's recording, the fallback", async () => {
    const v = await answerVideo(theirs([row("USCHSCMP", "playoff:0:1", "F1"), row("USCHSCMP", "playoff:0:2", "F2")]), NOW);
    expect(v?.main).toEqual({ videoId: "Z2ArRHRiwh0", t: 0, kind: "stream" });
    expect(v?.mainRow).toBeUndefined();
  });

  it("about the team at an event, no match listed (\"<team> opr at worlds\"): its best-scoring match there with a clip", async () => {
    // Q1 (red, 170) has a second in the recording; its Q30 (blue, 178) too, and scores more.
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USMACMP', 'qual', 0, 1, 7149, 'red', 1), (2025, 'USMACMP', 'qual', 0, 30, 7149, 'blue', 1)");
    const opr = stat({ intent: "opr-worlds", team: { number: 7149, name: null }, headline: { value: "55.8", label: "x", href: "/events/2025/USMACMP?team=7149" } });
    expect((await answerVideo(opr, NOW))?.main).toMatchObject({ kind: "recording", match: "Q30" });
    // A team with no match there: the recording, the fallback.
    expect((await answerVideo(stat({ team: { number: 6980, name: null }, headline: { value: "x", label: "x", href: "/events/2025/USMACMP?team=6980" } }), NOW))?.main).toEqual({ videoId: "xnQFL9T27fY", t: 0, kind: "stream" });
  });

  it("an event with no recording and no match video: no video at all", async () => {
    expect(await answerVideo(theirs([row("USNJCMP", "qual:0:1", "Q1")]), NOW)).toBeUndefined();
  });
});

describe("refOfHref and mainRef", () => {
  it("reads only an answer's own event and match links", () => {
    expect(refOfHref("/events/2025/USMACMP?match=qual:0:12")).toEqual({ season: 2025, code: "USMACMP", key: "qual:0:12" });
    expect(refOfHref("/events/2025/USMACMP?team=4215")).toEqual({ season: 2025, code: "USMACMP" });
    expect(refOfHref("/events?season=2025")).toBeNull();
    expect(refOfHref("/teams/4215")).toBeNull();
    expect(refOfHref("https://example.org/events/2025/X")).toBeNull();
  });

  it("matches at several events name none", () => {
    expect(mainRef(stat({ blocks: [{ kind: "matches", title: "x", rows: [row("USMACMP", "qual:0:1", "Q1"), row("USCHSCMP", "playoff:0:1", "F1")] }] }))).toBeNull();
  });
});

describe("search's answer, end to end", () => {
  it("a match typed by its event's code and number plays from its second", async () => {
    await rebuildSearch();
    const a = await searchAnswer("USMACMP Q12", { learn: false, limit: 25 });
    expect(a.hits[0]).toMatchObject({ kind: "match", ref: "2025:USMACMP:qual:0:12" });
    expect((await answerVideo(a, NOW))?.main).toEqual({ videoId: "xnQFL9T27fY", t: 9991, kind: "recording", match: "Q12" });
  });
});
