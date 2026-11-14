// "<team> best auto highlights": a one-match question asked as something to watch ("highlights", "video") is the same
// question (server/api/query/intents.ts WATCH), and its answer's video is that one match's own clip, whole: FIRST's
// video of it, or its second in the event's recording (server/api/answers/video.ts). The page then shows "View clip"
// under People also ask (src/components/search/page/AnswerVideo.tsx AnswerClip). Never a cut of one phase, never
// another match. A fixture of two real 2025–26 events: Massachusetts (one recording of the day) and Edison Division
// (FIRST's own video of each playoff match), plus a qualifier with no video at all.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { forgetRecordings } from "../../videos/recordings";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { answerVideo } from "./video";

type Side = [np: number, auto: number, teleop: number, endgame: number];
const NOW = Date.parse("2026-11-05T00:00:00Z");

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[11148, "Barker Greybacks"], [4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [207, "Critical Mass"], [9999, "Top Hat Robotics"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Hornsby', 'NSW', 'Australia', 2016)", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const events = [
    ["USMACMP", "Massachusetts Championship", "Championship", "Boston", "MA", "2026-03-15", "2026-03-15", "America/New_York", "https://www.youtube.com/watch?v=xnQFL9T27fY"],
    ["FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "FIRSTChampionship", "Houston", "TX", "2026-04-29", "2026-05-02", "America/Chicago", "https://www.youtube.com/watch?v=WQUBVjbh-hM"],
    ["USNJQ1", "New Jersey Qualifier", "Qualifier", "Edison", "NJ", "2026-01-10", "2026-01-10", "America/New_York", null],
  ];
  for (const [code, name, type, city, state, start, end, tz, live] of events) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, livestream, source) VALUES (2025, ?, ?, ?, ?, ?, 'USA', ?, ?, ?, ?, 't')", [code, name, type, city, state, start, end, tz, live]);
  }
  await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at, chapters) VALUES ('xnQFL9T27fY', 'ok', '2026-03-15T13:34:16.000Z', '2026-03-15T23:24:29.000Z', 35335, 0, '2026-11-04T07:01:00.000Z', '[]')");
  await run("INSERT INTO video_meta (video_id, status, start, end, duration, live, checked_at, chapters) VALUES ('WQUBVjbh-hM', 'ok', '2026-05-02T12:58:13.000Z', '2026-05-02T17:33:56.000Z', 16541, 0, '2026-11-04T07:01:00.000Z', '[]')");
  const match = (code: string, level: string, n: number, time: string, video: string | null, red: Side, blue: Side, redTeams: number[], blueTeams: number[]) => Promise.all([
    run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
           blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, video, breakdown, source) VALUES (2025, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, 1, 't')`,
      [code, level, level === "qual" ? 0 : n, level === "qual" ? n : 1, `${level === "qual" ? "Q" : "M"}${n}`, time, red[0], ...red, blue[0], ...blue, video]),
    ...redTeams.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, ?, ?, ?, ?, 'red')", [code, level, level === "qual" ? 0 : n, level === "qual" ? n : 1, t])),
    ...blueTeams.map((t) => run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, ?, ?, ?, ?, ?, 'blue')", [code, level, level === "qual" ? 0 : n, level === "qual" ? n : 1, t])),
  ]);
  // 11148: its best Auto (97) is Edison M2, which has FIRST's own video; its best score (404) is Massachusetts M10, in
  // the recording; its closest match is Massachusetts Q12 (97–83), in the recording too.
  await match("USMACMP", "qual", 12, "2026-03-15T12:21:07.313", null, [97, 20, 57, 20], [83, 30, 33, 20], [11148, 207], [6980, 9999]);
  await match("USMACMP", "playoff", 10, "2026-03-15T18:47:08.165", null, [404, 60, 300, 44], [302, 50, 220, 32], [11148, 207], [6980, 9999]);
  await match("FTCCMP1EDIS", "playoff", 2, "2026-05-02T09:42:47.528", "https://www.youtube.com/watch?v=4elyC6MxtEY", [316, 97, 189, 30], [253, 40, 183, 30], [11148, 207], [6980, 9999]);
  // 4215: its best Auto (88) is at a qualifier with no video at all.
  await match("USNJQ1", "qual", 1, "2026-01-10T10:00:00Z", null, [150, 88, 42, 20], [60, 10, 30, 20], [4215, 207], [6980, 9999]);
  await match("USMACMP", "qual", 30, "2026-03-15T15:04:12.812", null, [88, 20, 48, 20], [178, 40, 118, 20], [4215, 6980], [207, 9999]);
  await rebuildSearch();
  forgetRecordings();
});

/** The answer and its video, as the search route sends them. */
async function ask(q: string) {
  const a = await searchAnswer(q, { learn: false, limit: 25 });
  return { a, video: await answerVideo(a, NOW) };
}
const edisonM2 = "/events/2025/FTCCMP1EDIS?match=playoff:2:1";
const maM10 = "/events/2025/USMACMP?match=playoff:10:1";
const maQ12 = "/events/2025/USMACMP?match=qual:0:12";

describe("asking to watch one match: the same answer, and that match's clip", () => {
  it("\"best auto highlights\" is the highest Auto question, whatever the watch word or the team's name", async () => {
    for (const q of ["barker greybacks best auto highlights in decode", "barker greybacks best auto highlights", "11148 best auto highlights",
      "11148 highest auto score highlights", "11148 best auto video", "barker greybacks best auto match in decode", "11148 highest auto score in decode"]) {
      const { a } = await ask(q);
      expect(a.stat?.intent, q).toBe("highest-auto");
      expect(a.stat?.headline?.href, q).toBe(edisonM2);
      expect(a.sorry, q).toBeUndefined();
    }
  });

  it("its video is that match's own clip, whole: FIRST's video of Edison M2 from its start, never a phase cut", async () => {
    const { a, video } = await ask("barker greybacks best auto highlights in decode");
    expect(video?.main).toEqual({ videoId: "4elyC6MxtEY", t: 0, kind: "match", match: "M2" });
    // The page's "View clip" is for the headline's own match.
    expect(video?.mainRow).toBe(a.stat?.headline?.href);
  });

  it("each one-match question with a watch word: its match, and that match's clip in the event's recording", async () => {
    // Massachusetts' recording began 13:34:16Z; M10 at 18:47:08 EDT (22:47:08Z) is 33,172 s in, less the 20 s lead-in.
    const cases: [string, string, string, { videoId: string; t: number; end: number; kind: string; match: string }][] = [
      ["11148 highest score highlights", "highest-score", maM10, { videoId: "xnQFL9T27fY", t: 33152, end: 33392, kind: "recording", match: "M10" }],
      ["11148 biggest win highlights", "biggest-win", maM10, { videoId: "xnQFL9T27fY", t: 33152, end: 33392, kind: "recording", match: "M10" }],
      ["11148 closest match highlights", "closest-match", maQ12, { videoId: "xnQFL9T27fY", t: 9991, end: 10231, kind: "recording", match: "Q12" }],
      ["11148 best teleop highlights", "highest-teleop", maM10, { videoId: "xnQFL9T27fY", t: 33152, end: 33392, kind: "recording", match: "M10" }],
    ];
    for (const [q, intent, headline, main] of cases) {
      const { a, video } = await ask(q);
      expect(a.stat?.intent, q).toBe(intent);
      expect(a.stat?.headline?.href, q).toBe(headline);
      expect(video?.main, q).toEqual(main);
      expect(video?.mainRow, q).toBe(headline);
    }
  });

  it("most penalties with a watch word: that match's answer, not an unexplained word", async () => {
    for (const q of ["11148 most penalties highlights", "11148 most penalties video"]) {
      const { a } = await ask(q);
      expect(a.stat?.intent, q).toBe("most-penalties");
      expect(a.sorry, q).toBeUndefined();
    }
  });

  it("a best match with no clip anywhere: no video for it, so no View clip (never another match's)", async () => {
    const { a, video } = await ask("4215 best auto highlights");
    expect(a.stat?.intent).toBe("highest-auto");
    expect(a.stat?.headline?.href).toBe("/events/2025/USNJQ1?match=qual:0:1");
    expect(video?.main).toBeUndefined();
  });

  it("highlights alone stay highlights: a team's, its best matches, a scope's", async () => {
    for (const q of ["11148 highlights", "11148 best matches", "11148 best highlights", "barker greybacks highlights"]) expect((await ask(q)).a.stat?.intent, q).toBe("team-highlights");
  });
});

// "With video" as a filter (search video brief, point 5): only matches with a clip to play, FIRST's own video or a
// second in the event's recording; a match with none is never listed.
describe("with video, ever", () => {
  it("\"lowest score ever with video\" reads every season's matches with video, never the lowest without", async () => {
    const { a } = await ask("lowest score ever with video");
    expect(a.stat?.scope).toEqual(expect.arrayContaining(["All seasons", "With video"]));
    // The qualifier's match has no video: never the answer.
    expect(a.stat?.headline?.href ?? "").not.toContain("USNJQ1");
  });
});

describe("with video, as a filter", () => {
  const listed = (a: Awaited<ReturnType<typeof ask>>["a"]) => [a.stat?.headline?.href, ...(a.stat?.blocks ?? []).flatMap((b) => (b.kind === "table" ? b.rows.map((r) => r.href) : []))].filter(Boolean);

  it("a team's matches with video leave out the ones with none", async () => {
    const { a } = await ask("4215 matches with video 2025-26");
    expect(a.stat?.scope).toContain("With video");
    expect(listed(a)).toEqual(["/events/2025/USMACMP?match=qual:0:30"]);
  });

  it("a team's match by its score with video, no season said: the latest season holding one with video", async () => {
    const { a } = await ask("4215 88 point match with video");
    expect(listed(a)).toEqual(["/events/2025/USMACMP?match=qual:0:30"]);
  });

  it("a scope's best match with video skips a better one with none, and every listed one plays", async () => {
    const { a, video } = await ask("lowest score with video 2025-26");
    expect(listed(a)).not.toContain("/events/2025/USNJQ1?match=qual:0:1");
    // The headline's match is the card's own video; each row after it has its own.
    expect(video?.main?.kind).not.toBe("stream");
    for (const h of listed(a).slice(1)) expect(!!video?.rows?.[h!], h).toBe(true);
  });

  it("an event's matches with video play the first one's own clip, never the recording from its start", async () => {
    const { a, video } = await ask("matches with video at massachusetts championship 2025-26");
    expect(listed(a).length).toBeGreaterThan(1);
    expect(video?.main).toMatchObject({ kind: "recording" });
    expect(video?.main?.t).toBeGreaterThan(0);
  });
});

describe("highlights with video", () => {
  it("is the team's highlights card", async () => {
    const { a, video } = await ask("11148 highlights with video 2025-26");
    expect(a.stat?.blocks.some((b) => b.kind === "videos" || (b.kind === "matches" && b.rows.every((r) => r.note)))).toBe(true);
    expect(video?.main).toBeDefined();
  });
});
