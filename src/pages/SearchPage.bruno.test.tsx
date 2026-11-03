// @vitest-environment jsdom
// Bruno AI's overview on /search never gets lost (owner, 2026-11-02): before FTC One Search every question
// (isBrunoQuestion) got his answer on top of the results, whatever else the page showed. Each kind of question the
// page answers is listed here and must still show his card, on a desktop (right column or above the results) and on
// a phone (his card, analysis folded). The deterministic cards and summaries sit alongside him; they never replace
// him. A new kind of answer (a card, a stat answer) adds its question to QUESTIONS.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchCard, SearchHit, TeamSummary } from "../shared/api";

const state = vi.hoisted(() => ({ answer: undefined as SearchAnswer | undefined }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: state.answer?.hits ?? [], answer: state.answer, busy: false, error: null, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: false, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025 }));
const summaries: TeamSummary[] = [
  { team: 18061, name: "Simply Complex", place: "Tampa, FL", opr: 119.7, oprRank: 388, of: 8308, rating: null, ratingSd: null, record: "20-4-0", lastEvent: null, nextEvent: null },
];
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: (p: string | null) => ({ data: p ? { teams: summaries } : undefined, error: null, loading: false }) }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: (n: string) => n === "brunoAnswers" }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), useTeamFlags: () => ({ bookmarked: false, toggleBookmark: () => {} }) }));
const asked = vi.hoisted(() => [] as string[]);
vi.mock("../lib/brunoStream", () => ({
  streamBrunoAnswer: (url: string) => { asked.push(url); return Promise.resolve({ text: "Bruno's overview of the records.", points: [] }); },
}));

const { default: SearchPage } = await import("./SearchPage");
const { BRUNO_SETTLE_MS } = await import("../components/search/BrunoAnswer");

const team = (n: number, name: string): SearchHit => ({ kind: "team", ref: String(n), title: `${n} | ${name}`, subtitle: "", season: 2025 });
const ev = (code: string, name: string): SearchHit => ({ kind: "event", ref: `2025:${code}`, title: name, subtitle: `${code} · 2026-03-01 · Edison, NJ, USA`, season: 2025 });
const card = (kind: SearchCard["kind"], title: string, number?: number, lines: SearchCard["lines"] = [{ text: "A record", detail: "2024–25 · Apr 15, 2025 · Houston, TX", results: ["Ranked #3"] }]): SearchCard =>
  ({ kind, title, ...(number ? { team: { number, name: "Team" } } : {}), lines, ...(kind === "worlds" || kind === "states" ? { count: lines.length } : {}) });
const answer = (q: string, hits: SearchHit[], extra: Partial<SearchAnswer> = {}): SearchAnswer => ({ q, hits, pages: [], step: "deterministic", weak: false, ...extra });
const champ = (season: string) => ({ text: "FIRST Championship - Ochoa Division", detail: `${season} · Apr 18–22, 2023 · Houston, TX`, results: ["Ranked #3", "9-2-0 in quals", "OPR 114.8"] });

/** Every kind of question the page answers, with the answer the server sends for it. */
const QUESTIONS: [string, string, () => SearchAnswer][] = [
  ["a championship history (summary panel)", "when did 7149 go to worlds", () => answer("when did 7149 go to worlds", [team(7149, "ENFORCERS")], { card: card("worlds", "Worlds appearances", 7149, [champ("2022–23"), champ("2023–24")]) })],
  ["a states history", "how many times did 23268 go to states", () => answer("how many times did 23268 go to states", [team(23268, "Ultraviolet")], { card: card("states", "State championships", 23268, [champ("2024–25")]) })],
  ["how good is a team (standing summary)", "how good is simply complex", () => answer("how good is simply complex", [team(18061, "Simply Complex")])],
  ["a team's awards", "has bad wolf won anything", () => answer("has bad wolf won anything", [team(6980, "Bad Wolf")], { card: card("awards", "Awards won", 6980) })],
  ["a team's event wins", "what events did hypnotic win", () => answer("what events did hypnotic win", [team(4215, "Hypnotic Robotics")], { card: card("wins", "Event wins", 4215) })],
  ["a team's next event", "when is hypnotic's next event", () => answer("when is hypnotic's next event", [team(4215, "Hypnotic Robotics")], { card: card("next-event", "Next event", 4215) })],
  ["a team's next match", "when is 4215's next match", () => answer("when is 4215's next match", [team(4215, "Hypnotic Robotics")], { card: card("next-match", "Next match", 4215) })],
  ["a free question answered by name matches", "who won nj states", () => answer("who won nj states", [ev("NJW1", "FTC NJ Multi-Track Workshops (North)"), ev("NJW2", "FTC NJ Multi-Track Workshops (South)")], { understood: { kind: "names", label: 'Teams, events and matches matching "won nj states"' } } as Partial<SearchAnswer>)],
  ["a comparison (head-to-head panel)", "is 4215 better than 6980?", () => answer("is 4215 better than 6980?", [{ ...team(4215, "Hypnotic Robotics vs 6980 Bad Wolf"), href: "/compare?teams=4215,6980" }, team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")])],
  ["a rules question", "can robots descore in autonomous?", () => answer("can robots descore in autonomous?", [], { card: card("rule", "Rules: descoring", undefined, [{ text: "G402 Descoring", detail: "Robots may not descore", href: "/rules#G402" }]) })],
  ["a season's high scores", "what was the highest scoring match this season?", () => answer("what was the highest scoring match this season?", [], { card: card("high-scores", "Highest scores in 2025–26", undefined, [{ text: "714 points: Q49 at Carolinas", href: "/events/2025/FPECAR?match=qual:0:49" }]) })],
  ["a leaderboard", "who has the highest opr in new jersey", () => answer("who has the highest opr in new jersey", [team(4215, "Hypnotic Robotics")], { card: card("leaderboard", "Highest OPR in New Jersey", undefined, [{ text: "4215 Hypnotic Robotics", results: ["OPR 101.4"] }]) })],
  ["an event's awards", "who won inspire at nj states", () => answer("who won inspire at nj states", [ev("USNJCMP", "New Jersey Championship")], { card: card("event-awards", "Awards at New Jersey Championship", undefined, [{ text: "Inspire Award: 23268 Ultraviolet" }]) })],
];

const show = (q: string) => render(<MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(q)}`]}><SearchPage /></MemoryRouter>);
const settle = () => act(async () => { vi.advanceTimersByTime(BRUNO_SETTLE_MS + 5); });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); asked.length = 0; });
afterEach(() => { cleanup(); state.answer = undefined; vi.useRealTimers(); });

describe.each([
  ["desktop", false],
  ["phone", true],
])("Bruno AI's overview on /search (%s)", (_, phone) => {
  const real = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = real; });

  it.each(QUESTIONS)("%s: \"%s\" shows his card", async (_kind, q, make) => {
    state.answer = make();
    const { container } = show(q);
    await settle();
    expect(asked).toEqual([`/api/search/bruno?q=${encodeURIComponent(q)}&stream=1`]);
    const cards = container.querySelectorAll("[data-bruno-answer]");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Bruno AI");
    expect(cards[0].textContent).toContain("Bruno's overview of the records.");
    // On a phone his writing is folded under "Show AI Analysis", never dropped.
    if (phone) expect(cards[0].querySelector("[data-ai-analysis]")!.textContent).toContain("Bruno's overview of the records.");
  });
});
