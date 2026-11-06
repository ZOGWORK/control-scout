// @vitest-environment jsdom
// Every answer card type against the search results guide's §11 checks (answerAudit.testkit.ts): lie factor, hue
// means team, no gold data marks, at most 3 hues, print once, no meta text, no glued headings, 4.5:1 text in every
// theme. A new card type gets a fixture here.
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchCard, SearchVideo, TeamProfile } from "../../../shared/api";
import type { StatAnswer, StatBlock, StatMatchRow } from "../../../shared/searchStat";
import { SEARCH_PALETTE } from "../../../lib/textTones";
import type { Appearance } from "./records";

// A team's page data, loaded (the card's team header, season tiles and events draw with it).
const profile = (team: number, season: number): TeamProfile => ({
  team: { number: team, name: "Hypnotic Robotics", fullName: null, school: "River Dell Regional High School", sponsors: [], city: "Oradell", state: "NJ", country: "USA", rookieYear: 2010, website: null, homeRegion: "NJ" } as TeamProfile["team"],
  season, seasons: [season], awardsAllTime: [],
  stats: { opr: { np: { value: 142.5, rank: 12, of: 8308 }, auto: { value: 40.1, rank: 30, of: 8308 }, teleop: { value: 82, rank: 9, of: 8308 }, endgame: { value: 20.4, rank: 50, of: 8308 }, pen: 3 },
    rating: { np: 140, auto: 40, teleop: 80, endgame: 20, pen: 3, sd: 6, matches: 39, rank: 15 }, record: { wins: 32, losses: 6, ties: 1, matches: 39, events: 2 }, avg: { np: 200, score: 210, pen: 5 } },
  events: [{ season, code: "USNJCMP", name: "NJ Championship", type: "Championship", start: "2026-03-07", end: "2026-03-08", city: "Hillsborough", state: "NJ", country: "USA", rank: 2, rp: 2.1, wins: 9, losses: 1, ties: 0, played: 10 } as TeamProfile["events"][number]],
});
vi.mock("../../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../../lib/api")>()), useApi: (path: string | null) => {
  const m = path && /^\/api\/teams\/(\d+)\?season=(\d+)/.exec(path);
  return { data: m ? profile(+m[1], +m[2]) : undefined, error: null, loading: false };
} }));
vi.mock("../../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../../lib/meta")>()), useCurrentSeason: () => 2025 }));
const { StatAnswerCard } = await import("./StatAnswer");
const { EventAwardsAnswer } = await import("./EventAwards");
const { CARD_MEANING, FactCard } = await import("./FactCard");
const { AppearancesAnswer, QualityBanner, StatBanner, Timeline } = await import("./Summary");
const { AnswerVideoProvider } = await import("./AnswerVideo");
const { auditAnswer } = await import("./answerAudit.testkit");

afterEach(cleanup);
const draw = (node: ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>).container.firstElementChild as HTMLElement;
const card = (s: StatAnswer) => draw(<StatAnswerCard stat={s} />);
const base = { scope: ["2025–26"], definition: "From the stored season numbers.", source: "From 8,308 teams' 2025–26 season numbers" };

const T = (n: number, name: string) => ({ label: `${n} ${name}`, href: `/teams/${n}` });
const match = (i: number, over: Partial<StatMatchRow> = {}): StatMatchRow => ({
  label: `Q${i + 10}`, href: `/events/2025/USNJCMP?match=qual:0:${i + 10}`, event: { label: "NJ Championship", href: "/events/2025/USNJCMP" }, season: "2025–26", date: "Mar 7, 2026",
  alliance: "red", own: 300 - i * 10, opp: 200, ownNp: 290 - i * 10, oppNp: 190, result: "W", partners: [T(4215, "Hypnotic Robotics"), T(207, "Critical Mass")], opponents: [T(6980, "Bad Wolf"), T(16461, "Infinite Turtles")],
  type: "Championship", phases: { auto: 60, teleop: 180, endgame: 50, pen: 10, teleopWithEndgame: true }, rank: i + 1, ...over,
});

const TRIPS = [2023, 2024].map((season): Appearance => ({ id: `rec-${season}`, season, seasonLabel: `${season}–${(season + 1) % 100}`, game: season === 2023 ? "CENTERSTAGE" : "INTO THE DEEP", seasonName: `${season}–${(season + 1) % 100}`,
  name: "FIRST Championship - Franklin Division", title: "Franklin Division", badges: ["FIRST Championship"], division: "Franklin", when: "Apr 17–20", place: "Houston, TX", rank: season === 2023 ? 20 : 8, record: "6-4-0", opr: 124.8 + season - 2023, more: ["Think Award"], href: `/events/${season}/FTCCMP1FRAN` }));

const CARDS: Record<string, () => HTMLElement> = {
  comparison: () => card({ ...base, family: "two-team", intent: "opr-vs", title: "OPR: 23268 vs 7149 in 2025–26", teams: [{ number: 23268, name: "Ultraviolet" }, { number: 7149, name: "ENFORCERS" }],
    headline: { value: "23268 leads 157.9 – 115.3", label: "+42.6", sub: "#144 of 8,308 · #446 of 8,308 · TeleOp decided it (+32.3)" },
    blocks: [{ kind: "compare", title: "OPR", scale: "the 2025–26 high, rounded up", teams: [{ label: "23268", href: "/teams/23268" }, { label: "7149", href: "/teams/7149" }], rows: [
      { label: "Total", values: ["157.9", "115.3"], nums: [157.9, 115.3], max: 250, best: 0, gap: "+42.6", diff: 42.6 },
      { label: "TeleOp", values: ["101.0", "68.7"], nums: [101, 68.7], max: 150, best: 0, gap: "+32.3", diff: 32.3 }] },
      { kind: "links", title: "Try it", items: [{ label: "Open in Predict", href: "/predict" }, { label: "Compare side by side", href: "/compare" }] }] }),
  "top matches (match boxes, combined table)": () => card({ ...base, family: "superlative", intent: "season-top-matches", title: "Highest-scoring matches, DECODE 2025–26",
    headline: { value: "290 points", label: "Q10 at NJ Championship", sub: "2025–26 · Mar 7, 2026", href: "/events/2025/USNJCMP?match=qual:0:10", type: "Championship", teams: [T(4215, "Hypnotic Robotics")], alliance: "red" },
    blocks: [{ kind: "matches", title: "Top 2 alliance scores", rows: [match(0), match(1, { alliance: "blue", ranked: "teleop" })] },
      { kind: "table", title: "Highest combined scores (both alliances)", columns: [{ key: "rank", label: "#", num: true }, { key: "combined", label: "Combined", num: true }, { key: "score", label: "Red–Blue" }, { key: "match", label: "Match" }],
        rows: [{ cells: { rank: 1, combined: 480, score: "290–190", match: "Q10" }, href: "/m", type: "Championship", teams: { red: [T(4215, "Hypnotic Robotics")], blue: [T(6980, "Bad Wolf")] }, winner: "red" },
          { cells: { rank: 2, combined: 420, score: "200–220", match: "Q11" }, href: "/m2", teams: { red: [T(207, "Critical Mass")], blue: [T(16461, "Infinite Turtles")] }, winner: "blue" }] }] }),
  "single match": () => card({ ...base, family: "stat", intent: "team-best-match", title: "4215's best match in 2025–26", team: { number: 4215, name: "Hypnotic Robotics" },
    headline: { value: "290 points", label: "Q10 at NJ Championship" }, blocks: [{ kind: "matches", title: "Best match", rows: [match(0, { rank: undefined })] }] }),
  leaderboard: () => card({ ...base, family: "superlative", intent: "top-opr", title: "Top OPR teams in 2025–26",
    blocks: [{ kind: "leaderboard", title: "Top OPR", stat: { id: "opr", label: "OPR" }, note: "2025–26 · 8,308 teams ranked by OPR", teleopWithEndgame: true, rows: [
      { rank: 1, team: T(23268, "Ultraviolet"), location: "Austin, TX", record: "40-2-0", opr: 157.9, value: 157.9, display: "157.9", parts: { auto: 36.5, teleop: 101, endgame: 20.4, pen: 2 } },
      { rank: 2, team: T(7149, "ENFORCERS"), location: "Cary, NC", record: "30-5-0", opr: 115.3, value: 115.3, display: "115.3", parts: { auto: 41.6, teleop: 68.7, endgame: 5 } }] }] }),
  "team record": () => card({ ...base, family: "stat", intent: "team-record", title: "4215's record in 2025–26", team: { number: 4215, name: "Hypnotic Robotics" },
    headline: { value: "32-6-1", label: "wins, losses, ties" }, blocks: [{ kind: "record", wins: 32, losses: 6, ties: 1, split: { quals: { wins: 25, losses: 5, ties: 1 }, playoffs: { wins: 7, losses: 1, ties: 0 } } }] }),
  "stat tiles, OPR by phase": () => card({ ...base, family: "stat", intent: "team-opr", title: "4215's OPR in 2025–26", team: { number: 4215, name: "Hypnotic Robotics" },
    headline: { value: "142.5", label: "OPR" }, blocks: [{ kind: "kpis", items: [{ label: "OPR", value: "142.5", phase: "np", rank: 12, of: 8308 }, { label: "Auto", value: "40.1", phase: "auto", rank: 30, of: 8308 }, { label: "TeleOp", value: "82.0", phase: "teleop", rank: 9, of: 8308 }, { label: "Endgame", value: "20.4", phase: "endgame", rank: 50, of: 8308 }] }] }),
  "event result (table)": () => card({ ...base, family: "event", intent: "team-events", title: "4215's events in 2025–26", team: { number: 4215, name: "Hypnotic Robotics" },
    blocks: [{ kind: "table", title: "Events", columns: [{ key: "event", label: "Event" }, { key: "rank", label: "Rank", num: true }, { key: "opr", label: "OPR", num: true }, { key: "season", label: "Season" }],
      rows: [{ cells: { event: "NJ Championship", rank: 2, opr: 140.2, season: "2025–26" }, href: "/events/2025/USNJCMP", type: "Championship", strong: true }, { cells: { event: "Bergen Qualifier", rank: 5, opr: 120.4, season: "2025–26" }, href: "/events/2025/USNJBQ", type: "Qualifier" }] }] }),
  "over time (series)": () => card({ ...base, family: "trend", intent: "team-opr-trend", title: "4215's OPR by event", team: { number: 4215, name: "Hypnotic Robotics" },
    blocks: [{ kind: "series", title: "OPR by event", points: [{ x: "Bergen", y: 120.4 }, { x: "NJ CMP", y: 140.2 }, { x: "Worlds", y: 151 }] }] }),
  "bars": () => card({ ...base, family: "stat", intent: "phase-split", title: "4215's points by phase", team: { number: 4215, name: "Hypnotic Robotics" },
    blocks: [{ kind: "bars", title: "Points by phase", groups: [{ label: "Average", items: [{ label: "Auto", value: 40 }, { label: "TeleOp", value: 82 }, { label: "Endgame", value: 20 }] }] }] }),
  "prediction at an event (#752)": () => card({ ...base, family: "stat", intent: "pipeline-team-predict-event", title: "4215 at NJ Championship: predicted and actual", team: { number: 4215, name: "Hypnotic Robotics" },
    headline: { value: "6.4 → 7 wins", label: "expected before, won after", sub: "2025–26 · Mar 7–8, 2026 · logged live before each match", href: "/predict" },
    blocks: [{ kind: "kpis", items: [{ label: "Before: expected wins", value: "6.4", sub: "of 9 matches played" }, { label: "After: record", value: "7-2-0", sub: "Ranked #2" }, { label: "After: event", value: "Won", tone: "good" }, { label: "Called right", value: "7 of 9", sub: "78%" }] },
      { kind: "table", title: "Before (win chance · predicted score) and after, match by match", columns: [{ key: "match", label: "Match" }, { key: "before", label: "Before" }, { key: "after", label: "After" }, { key: "called", label: "Right" }],
        rows: [{ cells: { match: "Q1", before: "71% · 210–180", after: "W 230–170", called: "Yes" }, href: "/m1" }, { cells: { match: "Q2", before: "40% · 190–200", after: "W 205–199", called: "No" }, href: "/m2" }] },
      { kind: "links", title: "Open", items: [{ label: "Open in Predict", href: "/predict" }, { label: "NJ Championship", sub: "Mar 7–8, 2026", href: "/events/2025/USNJCMP" }] }] }),
  "no season said, the one before shown (relax note)": () => card({ ...base, scope: ["No 2026–27 matches yet in New Jersey; showing 2025–26", "2025–26"], family: "superlative", intent: "season-top-matches", title: "Highest-scoring matches",
    definition: "No season was named, so the current one was read first, and it has none yet. Every other filter is as asked. From the stored season numbers.",
    headline: { value: "290 points", label: "Q10 at NJ Championship" }, blocks: [{ kind: "matches", title: "Top alliance scores", rows: [match(0)] }] }),
  "relaxed window chip (#749)": () => card({ ...base, scope: ["Relaxed: this week → 2025–26", "2025–26"], family: "superlative", intent: "season-top-matches", title: "Highest-scoring matches, DECODE 2025–26",
    headline: { value: "290 points", label: "Q10 at NJ Championship" }, blocks: [{ kind: "matches", title: "Top alliance scores", rows: [match(0)] }] }),
  "match video (AnswerVideo)": () => draw(<AnswerVideoProvider video={{ main: { videoId: "xnQFL9T27fY", t: 30, kind: "recording", match: "Q10" }, rows: { [match(1).href]: { videoId: "xnQFL9T27fY", t: 90, kind: "recording", match: "Q11" } } } satisfies SearchVideo}>
    <StatAnswerCard stat={{ ...base, family: "superlative", intent: "season-top-matches", title: "Highest-scoring matches", headline: { value: "290 points", label: "Q10 at NJ Championship", href: match(0).href }, blocks: [{ kind: "matches", title: "Top alliance scores", rows: [match(0), match(1)] }] }} /></AnswerVideoProvider>),
  "team highlights (labelled match boxes)": () => card({ ...base, family: "superlative", intent: "team-highlights", title: "Highlights, 2025–26", team: { number: 4215, name: "Hypnotic Robotics" },
    headline: { value: "290 points", label: "Best score: Q10 at NJ Championship", sub: "300 with penalties · Won 300–200", href: match(0).href },
    blocks: [{ kind: "matches", title: "2 standout matches", rows: [{ ...match(0, { rank: undefined }), note: "Best score" }, { ...match(1, { rank: undefined, label: "M4" }), note: "Latest playoff win" }] }] }),
  "scope highlights (labelled match boxes, no team)": () => card({ ...base, family: "superlative", intent: "scope-highlights", title: "Highlights at Worlds · Jackson Division, 2025–26",
    scope: ["No 2026–27 matches yet at Worlds · Jackson Division; showing 2025–26", "2025–26", "Apr 29 – May 2, 2026", "Houston, TX", "Official events"],
    headline: { value: "290 points", label: "Best score: Q10 at NJ Championship", sub: "300 with penalties · Red won 300–200", href: match(0).href, type: "Championship", teams: [T(4215, "Hypnotic Robotics")], alliance: "red" },
    blocks: [{ kind: "matches", title: "3 standout matches", rows: [{ ...match(0, { rank: undefined }), note: "Best score" }, { ...match(1, { rank: undefined, alliance: "blue" }), note: "Biggest margin" },
      { ...match(2, { rank: undefined, label: "F1" }), note: "Latest playoff match" }] }] }),
  "video page (every match, a stream, the filter)": () => draw(<AnswerVideoProvider video={{ rows: {
      "/events/2025/FTCCMP1JACK?match=qual:0:1": { videoId: "abcdefghijk", t: 0, kind: "match", match: "Q1" },
      "/events/2025/FTCCMP1JACK?match=playoff:1:1": { videoId: "xnQFL9T27fY", t: 900, kind: "recording", match: "M1" },
      "/events/2025/FTCCMP1JACK": { videoId: "xnQFL9T27fY", t: 0, kind: "stream" } } } satisfies SearchVideo}>
    <StatAnswerCard stat={{ ...base, family: "superlative", intent: "scope-highlights", title: "Match videos at Worlds · Jackson Division, 2025–26", scope: ["2025–26"],
      headline: { value: "290 points", label: "Latest playoff match: M1 at Worlds · Jackson Division", href: "/events/2025/FTCCMP1JACK?match=playoff:1:1" },
      blocks: [{ kind: "videos", title: "Every match", streams: [{ label: "Worlds · Jackson Division", href: "/events/2025/FTCCMP1JACK" }],
        tiles: [{ label: "Q1", href: "/events/2025/FTCCMP1JACK?match=qual:0:1", level: "qual", red: [4215, 6980], blue: [7149, 23268], redScore: 300, blueScore: 200, date: "2026-04-30" },
          { label: "M1", href: "/events/2025/FTCCMP1JACK?match=playoff:1:1", level: "playoff", red: [4215, 6980], blue: [7149, 23268], redScore: 250, blueScore: 260, date: "2026-05-01" }] }] }} /></AnswerVideoProvider>),
  "event awards": () => draw(<EventAwardsAnswer card={{ kind: "event-awards", title: "Inspire Award · NJ Championship · 2025–26", lines: [], award: "Inspire", event: { season: 2025, code: "USNJCMP", name: "NJ Championship" },
    awards: [{ type: "Inspire", placement: 1, team: 30439, teamName: "Cool Name", name: "Inspire Award" }, { type: "Inspire", placement: 2, team: 207, teamName: "Critical Mass", name: "Inspire Award 2nd Place" },
      { type: "Inspire", placement: 3, team: 13617, teamName: "Bectobots", name: "Inspire Award 3rd Place" }, { type: "Think", placement: 1, team: 6980, teamName: "Bad Wolf", name: "Think Award" }] } satisfies SearchCard} />),
  "team facts": () => draw(<FactCard card={{ kind: "info", title: "Where they're from", team: { number: 4215, name: "Hypnotic Robotics" }, lines: [], facts: [{ label: "Where they're from", values: ["Oradell, NJ, USA"] }, { label: "Rookie year", values: ["2009"] }] }} />),
  "Worlds trips": () => draw(<AppearancesAnswer team={{ number: 4215, name: "Hypnotic Robotics" }} title="4215's Worlds trips" headline="First went to Worlds in 2023–24 · CENTERSTAGE, Franklin Division" trip={{ which: "first", season: 2023 }} apps={TRIPS} />),
  "Worlds summary (stat banner, timeline)": () => draw(<div><StatBanner stats={[{ label: "Total appearances", value: "2" }, { label: "Best division rank", value: "#8", note: "2024–25" }, { label: "Worlds win rate", value: "60.0%" }]} /><Timeline apps={TRIPS} /></div>),
  "how good is a team (quality banner)": () => draw(<QualityBanner s={{ season: 2025, record: "32-6-1", opr: 142.5, rank: 12, of: 8308, pct: 99.9, tier: "Elite", winRate: 83.3 }} />),
};

/** The team names each card must print exactly once. A list of matches names a team once per match it played (each
 *  row is a different match), so those cards name none; neither does a card about no team. */
const NAMES: Record<keyof typeof CARDS, string[]> = {
  comparison: ["Ultraviolet", "ENFORCERS"],
  "top matches (match boxes, combined table)": [],
  "single match": ["Hypnotic Robotics", "Critical Mass", "Bad Wolf", "Infinite Turtles"],
  leaderboard: ["Ultraviolet", "ENFORCERS"],
  "team record": [], "stat tiles, OPR by phase": [], "event result (table)": [], "over time (series)": [], bars: [], "prediction at an event (#752)": [],
  "relaxed window chip (#749)": [], "match video (AnswerVideo)": [], "no season said, the one before shown (relax note)": [],
  "team highlights (labelled match boxes)": [], "scope highlights (labelled match boxes, no team)": [], "video page (every match, a stream, the filter)": [],
  "event awards": ["Cool Name", "Critical Mass", "Bectobots", "Bad Wolf"],
  "team facts": ["Hypnotic Robotics"],
  "Worlds trips": ["Hypnotic Robotics"],
  "Worlds summary (stat banner, timeline)": [], "how good is a team (quality banner)": [],
};

/** Cards about one team: drawn in its hue, team A (the owner: "What happened to color"), never ink alone. */
const ONE = new Set<keyof typeof CARDS>(["team record", "stat tiles, OPR by phase", "team highlights (labelled match boxes)", "team facts", "Worlds trips", "Worlds summary (stat banner, timeline)", "how good is a team (quality banner)"]);

describe("every answer card passes the guide's checks (§11)", () => {
  for (const [name, make] of Object.entries(CARDS)) {
    // Joined, so a failure lists every problem.
    it(name, () => expect(auditAnswer(make(), { names: NAMES[name], one: ONE.has(name) }).join("\n")).toBe(""));
  }
  for (const name of ONE) it(`${name}: in the team's hue`, () => expect(CARDS[name]().querySelector("[class*='team-a']")).not.toBeNull());
});

// Every card kind the API returns (SearchCard["kind"]) and every stat block kind (StatBlock["kind"]), drawn on its own:
// the Record types fail `npm run lint` when a kind is added without one, and the source check below fails the test
// run. Each must pass the audit, colour included: no grey card, no grey line icon or line text (the all-grey "578
// teams registered in Canada" count card, 3.6.5).
const TEAM = { number: 4215, name: "Hypnotic Robotics" };
const LINE = { text: "New Jersey Championship", detail: "Mar 7–8, 2026 · Hillsborough, NJ", href: "/events/2025/USNJCMP" };
const KIND_CARDS: Record<SearchCard["kind"], SearchCard> = {
  worlds: { kind: "worlds", title: "Worlds appearances", team: TEAM, lines: [], none: "No Worlds appearances found in recorded event history", closest: [{ ...LINE, results: ["Ranked #2 of 40", "9-1-0", "Inspire Award"] }] },
  states: { kind: "states", title: "State championships", team: TEAM, count: 3, lines: [{ ...LINE, results: ["Ranked #2 of 40", "9-1-0"] }] },
  wins: { kind: "wins", title: "Event wins", team: TEAM, lines: [{ text: "Winning Alliance Captain", detail: "New Jersey Championship · 2025–26" }] },
  awards: { kind: "awards", title: "Awards", team: TEAM, lines: [{ text: "Inspire Award", detail: "New Jersey Championship · 2025–26" }, { text: "Think Award", detail: "Bergen Qualifier · 2024–25" }] },
  "next-event": { kind: "next-event", title: "Next event", team: TEAM, lines: [LINE] },
  "next-match": { kind: "next-match", title: "Next match", team: TEAM, lines: [], none: "No upcoming match is scheduled yet", closest: [LINE] },
  "high-scores": { kind: "high-scores", title: "Highest scores in 2025–26", lines: [{ text: "290 points", detail: "Q10 at New Jersey Championship", href: "/events/2025/USNJCMP?match=qual:0:10" }] },
  rule: { kind: "rule", title: "Rules quick reference", lines: [{ text: "G301 Don't delay the match", detail: "A drive team may not delay the start of a match", href: "/rules" }] },
  leaderboard: { kind: "leaderboard", title: "Teams in California by OPR", lines: [{ text: "23268 Ultraviolet", detail: "OPR 157.9", href: "/teams/23268" }] },
  "event-awards": { kind: "event-awards", title: "Inspire Award · NJ Championship · 2025–26", lines: [], award: "Inspire", event: { season: 2025, code: "USNJCMP", name: "NJ Championship" },
    awards: [{ type: "Inspire", placement: 1, team: 30439, teamName: "Cool Name", name: "Inspire Award" }] },
  info: { kind: "info", title: "How many teams in Canada · 2026–27", lines: [{ text: "578 teams registered in Canada in 2026–27", detail: "Registrations for the season, played or not", href: "/teams?season=2026&view=listed&country=CA" }] },
};
const drawKind = (c: SearchCard) => draw(c.kind === "event-awards" ? <EventAwardsAnswer card={c} /> : <FactCard card={c} />);
const S = (blocks: StatAnswer["blocks"], over: Partial<StatAnswer> = {}) => card({ ...base, family: "stat", intent: "x", title: "4215 in 2025–26", team: TEAM, headline: { value: "142.5", label: "OPR" }, blocks, ...over });
const BLOCK_CARDS: Record<StatBlock["kind"], () => HTMLElement> = {
  kpis: CARDS["stat tiles, OPR by phase"], record: CARDS["team record"], matches: CARDS["single match"], videos: CARDS["video page (every match, a stream, the filter)"],
  table: CARDS["event result (table)"], series: CARDS["over time (series)"], bars: CARDS.bars, leaderboard: CARDS.leaderboard, compare: CARDS.comparison,
  links: () => S([{ kind: "links", title: "Open", items: [{ label: "NJ Championship", href: "/events/2025/USNJCMP" }] }]),
  related: () => S([{ kind: "related", title: "Did you mean", queries: ["4215 record"] }], { team: undefined, headline: { value: "0 teams", label: "named robot" }, family: "aggregate" }),
  chance: () => S([{ kind: "chance", label: "Win chance", p: 0.62, who: "4215 wins NJ Championship", action: { label: "Open in Predict", href: "/predict" } }]),
};

describe("every card kind and block kind has its colour", () => {
  // The kinds as the shared types spell them, so a kind added there with no fixture here fails even without tsc.
  const src = readFileSync("src/shared/api.ts", "utf8");
  const union = (re: RegExp, text: string) => [...(re.exec(text)?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]).sort();
  it("a fixture for every SearchCard kind", () => expect(Object.keys(KIND_CARDS).sort()).toEqual(union(/interface SearchCard \{\s*kind: ([^;]+);/, src)));
  it("a fixture for every StatBlock kind", () => {
    const stat = readFileSync("src/shared/searchStat.ts", "utf8");
    expect(Object.keys(BLOCK_CARDS).sort()).toEqual([...stat.matchAll(/\|\s*\{\s*kind: "([\w-]+)"/g)].map((m) => m[1]).sort());
  });
  it("every card kind has a colour of its own (FactCard CARD_MEANING)", () => expect(Object.keys(CARD_MEANING).sort()).toEqual(Object.keys(KIND_CARDS).sort()));
  for (const [kind, c] of Object.entries(KIND_CARDS)) {
    it(`card ${kind}`, () => expect(auditAnswer(drawKind(c), { one: !!c.team }).join("\n")).toBe(""));
  }
  for (const [kind, make] of Object.entries(BLOCK_CARDS)) {
    it(`block ${kind}`, () => expect(auditAnswer(make()).join("\n")).toBe(""));
  }
  it("a how-many card's number and sentence in Count's amber, its icon a filled chip, a thick bar", () => {
    const el = drawKind(KIND_CARDS.info);
    expect(el.querySelector("[data-kpi]")!.textContent).toBe("578");
    expect(el.querySelector("[data-line-text]")!.className).toContain(SEARCH_PALETTE.count.text);
    expect(el.querySelector("[data-line-icon]")!.className).toContain(SEARCH_PALETTE.count.fill);
    expect(el.querySelector("[data-lines] a")!.className).toContain("border-l-[6px]");
  });
  it("a definition reads in Reference's sky, a rule too", () => {
    const def = drawKind({ kind: "info", title: "OPR: what it is", lines: [{ text: "OPR estimates each robot's average contribution", href: "/methodology#opr" }] });
    expect(def.querySelector("[data-line-text]")!.className).toContain(SEARCH_PALETTE.reference.text);
    expect(drawKind(KIND_CARDS.rule).querySelector("[data-line-text]")!.className).toContain(SEARCH_PALETTE.reference.text);
  });
  it("the old grey count card fails the audit", () => {
    const d = document.createElement("article");
    d.innerHTML = `<ul data-lines><li><span data-line-icon class="bg-muted text-muted-foreground"></span><span data-line-text class="text-foreground">578 teams registered</span></li></ul>`;
    expect(auditAnswer(d, { contrast: false })).toEqual(['grey data visual: span ""', 'grey data visual: span "578 teams registered"', "grey card: no palette or team colour anywhere"]);
  });
});

describe("the audit catches what it's for", () => {
  const bad = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return auditAnswer(d, { whole: false }); };
  it("an unmarked bar, a bar not to scale, a bar not from zero", () => {
    expect(bad(`<div class="bg-foreground/50" style="width:40%"></div>`)).toEqual([expect.stringContaining("unmarked bar")]);
    expect(bad(`<div data-bar data-value="50" data-scale="100" class="bg-team-a" style="width:70%"></div>`)).toEqual([expect.stringContaining("lie factor 1.40")]);
    expect(bad(`<div data-bar data-value="50" data-scale="100" class="bg-team-a" style="width:50%;margin-left:20%"></div>`)).toEqual([expect.stringContaining("not from zero")]);
    expect(bad(`<div data-bar data-value="0" data-scale="100" class="bg-team-a" style="width:100%"></div>`)).toEqual(["bar for 0 drawn 100%"]);
    expect(bad(`<div data-bar data-value="" data-scale="100" class="bg-team-a" style="width:40%"></div>`)).toEqual([expect.stringContaining("bar without value/scale")]);
  });
  it("a hue off the palette, gold on data, two meanings in one hue, a grey data visual", () => {
    expect(bad(`<span class="text-purple-600">Auto</span>`)).toEqual(expect.arrayContaining([expect.stringContaining("hue on data: text-purple-600")]));
    expect(bad(`<b class="text-accent-text">1st</b>`)).toEqual(expect.arrayContaining([expect.stringContaining("gold on data")]));
    expect(bad(`<a data-primary-cta class="bg-accent text-accent-ink">Open in Predict</a>`)).toEqual([]);
    // Only the marked primary action and the video's own controls take those colours, not any button or link.
    expect(bad(`<button class="bg-accent text-accent-ink">Open</button>`)).toEqual(expect.arrayContaining([expect.stringContaining("gold on data: bg-accent")]));
    expect(bad(`<a href="/teams/1" class="text-video">1</a>`)).toEqual(expect.arrayContaining([expect.stringContaining("hue on data: text-video")]));
    // Search's palette is data's colour: an award, a phase, a status in its own family; the teams and alliances in theirs.
    expect(bad(`<i class="bg-team-a"></i><i class="bg-team-b"></i><i class="bg-team-c"></i><i class="bg-red-alliance"></i><b class="bg-fuchsia-700 text-white">Inspire</b>`)).toEqual([]);
    expect(bad(`<i class="bg-team-b"></i><b class="bg-orange-700 text-white">Winning Alliance</b>`)).toEqual(["two meanings in one hue: team-b and orange"]);
    expect(bad(`<div data-kpi><b class="text-foreground">142.5</b></div>`)).toEqual(['grey data visual: div "142.5"']);
    expect(bad(`<div data-kpi class="border-l-team-a"><b class="text-team-a">142.5</b></div>`)).toEqual([]);
    const one = document.createElement("div"); one.innerHTML = `<b class="text-team-a">142.5</b><i class="bg-team-b"></i>`;
    expect(auditAnswer(one, { one: true, whole: false })).toEqual(["one team's card in team-b"]);
  });
  it("a line said twice, meta text, a glued heading, low contrast", () => {
    expect(bad(`<h3>Top OPR</h3><figcaption>Top OPR</figcaption>`)).toEqual(['said twice: "Top OPR"']);
    expect(bad(`<p>read as "vs"</p>`)).toEqual(["meta text /read as/i"]);
    expect(bad(`<h3>157.9leads</h3>`)).toEqual(["glued heading: 157.9leads"]);
    expect(bad(`<h3>2nd place</h3>`)).toEqual([]);
    expect(bad(`<p data-scope><span>No 2026–27 matches yet in NJ; showing 2025–26</span></p><p>No 2026–27 matches yet in NJ: no season was named.</p>`)).toEqual(['scope note said again: "No 2026–27 matches yet in NJ"']);
    expect(bad(`<p class="text-foreground/30">faint</p>`)).toEqual([expect.stringContaining("contrast")]);
    // Seen though aria-hidden, and on every tint at once: rose 500 on a 10% red over an 8% red is under 4.5:1 on Dark.
    expect(bad(`<p aria-hidden="true" class="text-foreground/30">faint</p>`)).toEqual([expect.stringContaining("contrast")]);
    expect(bad(`<div class="bg-red-alliance/[0.08]"><span class="bg-red-alliance/10"><b class="text-red-alliance-text">4215</b></span></div>`)).toEqual([expect.stringMatching(/^contrast dark: .*bg-red-alliance\/\[0\.08\] > bg-red-alliance\/10/)]);
  });
});
