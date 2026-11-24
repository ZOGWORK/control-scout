// @vitest-environment jsdom
// Bruno AI's overview on /search never gets lost (owner, 2026-11-02): before FTC One Search every question
// (isBrunoQuestion) got his answer on top of the results, whatever else the page showed. Each kind of question the
// page answers is listed here and must still show his card, on a desktop (right column or above the results) and on
// a phone (his card, analysis folded). The deterministic summaries sit alongside him; they never replace him. One
// exception (owner, 2026-11-04: never his card and an answer box saying the same thing twice): where search answers
// the question directly (a card or a stat answer, not a weak guess), its answer card stands alone and he isn't asked.
// A new kind of answer (a card, a stat answer) adds its question to QUESTIONS.
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchCard, SearchHit, TeamSummary } from "../shared/api";

const state = vi.hoisted(() => ({ answer: undefined as SearchAnswer | undefined, error: null as string | null, busy: false }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: state.answer?.hits ?? [], answer: state.answer, busy: state.busy, error: state.error, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: false, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025 }));
const summaries: TeamSummary[] = [
  { team: 18061, name: "Simply Complex", place: "Tampa, FL", opr: 119.7, oprRank: 388, of: 8308, rating: null, ratingSd: null, record: "20-4-0", lastEvent: null, nextEvent: null },
];
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: (p: string | null) => ({ data: p ? { teams: summaries } : undefined, error: null, loading: false }) }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: (n: string) => n === "brunoAnswers" }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), useTeamFlags: () => ({ bookmarked: false, toggleBookmark: () => {} }),
  // The phone's search bar is a real SearchBox, which ranks the visitor's own teams first: none here.
  usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
const asked = vi.hoisted(() => [] as string[]);
// What he writes back (null: nothing to add).
const says = vi.hoisted(() => ({ text: "Bruno's overview of the records." as string | null, fail: false }));
vi.mock("../lib/brunoStream", () => ({
  streamBrunoAnswer: (url: string) => { asked.push(url); return says.fail ? Promise.reject(new Error("down")) : Promise.resolve(says.text ? { text: says.text, points: [] } : null); },
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
  ["a free question answered by name matches", "where are the nj workshops", () => answer("where are the nj workshops", [ev("NJW1", "FTC NJ Multi-Track Workshops (North)"), ev("NJW2", "FTC NJ Multi-Track Workshops (South)")], { understood: { kind: "names", label: 'Teams, events and matches matching "nj workshops"' } } as Partial<SearchAnswer>)],
  ["who won an event (winning alliance and Inspire)", "who won nj states", () => answer("who won nj states", [{ ...ev("USNJCMP", "New Jersey Championship"), section: "playoffs" }], { card: card("event-awards", "Who won · New Jersey Championship · 2025–26", undefined, [{ text: "23268 Ultraviolet", results: ["Turnpike Division Winning Alliance - Captain"], href: "/teams/23268" }, { text: "30439 Cool Name Pending...", results: ["Inspire Award"], href: "/teams/30439" }]), understood: { kind: "question", label: "Who won New Jersey Championship (2025–26): the winning alliance and the Inspire Award", season: 2025 } } as Partial<SearchAnswer>)],
  ["a comparison (head-to-head panel)", "is 4215 better than 6980?", () => answer("is 4215 better than 6980?", [{ ...team(4215, "Hypnotic Robotics vs 6980 Bad Wolf"), href: "/compare?teams=4215,6980" }, team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")])],
  ["a rules question", "can robots descore in autonomous?", () => answer("can robots descore in autonomous?", [], { card: card("rule", "Rules: descoring", undefined, [{ text: "G402 Descoring", detail: "Robots may not descore", href: "/rules#G402" }]) })],
  ["a season's high scores", "what was the highest scoring match this season?", () => answer("what was the highest scoring match this season?", [], { card: card("high-scores", "Highest scores in 2025–26", undefined, [{ text: "714 points: Q49 at Carolinas", href: "/events/2025/FPECAR?match=qual:0:49" }]) })],
  ["a leaderboard", "who has the highest opr in new jersey", () => answer("who has the highest opr in new jersey", [team(4215, "Hypnotic Robotics")], { card: card("leaderboard", "Highest OPR in New Jersey", undefined, [{ text: "4215 Hypnotic Robotics", results: ["OPR 101.4"] }]) })],
  ["an event's awards", "who won inspire at nj states", () => answer("who won inspire at nj states", [ev("USNJCMP", "New Jersey Championship")], { card: card("event-awards", "Awards at New Jersey Championship", undefined, [{ text: "Inspire Award: 23268 Ultraviolet" }]) })],
  ["a stat answer (a team's number, with its matches)", "what was 4215 highest score in worlds", () => answer("what was 4215 highest score in worlds", [team(4215, "Hypnotic Robotics")], { understood: { kind: "question", label: "Hypnotic Robotics (4215) · Highest score at Worlds" }, stat: { family: "superlative", intent: "highest-score", title: "Highest score at Worlds", team: { number: 4215, name: "Hypnotic Robotics" }, scope: ["FIRST Championship (Worlds)", "All seasons"], headline: { value: "296 points", label: "Q136 at Worlds · Edison Division" }, blocks: [{ kind: "kpis", items: [{ label: "With penalties", value: "301" }] }], definition: "Highest score: the alliance's points without penalties.", source: "From 12 match records at 3 events" } })],
];

const show = (q: string) => render(<MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(q)}`]}><SearchPage /></MemoryRouter>);
const settle = () => act(async () => { vi.advanceTimersByTime(BRUNO_SETTLE_MS + 5); });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); asked.length = 0; });
afterEach(() => { cleanup(); state.answer = undefined; state.error = null; state.busy = false; says.fail = false; says.text = "Bruno's overview of the records."; vi.useRealTimers(); });

// v8 (owner, 2026-11-23): a question search has no direct answer to leads with his answer, under the search box; a
// shared name's reading is a plain line heading its list, never the page's biggest words.
describe("Bruno leading the v8 page", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  afterEach(() => document.documentElement.removeAttribute("data-v8"));
  const NAMES = "is absolute zero a real team";
  const names = () => answer(NAMES, [team(12096, "Absolute Zero"), team(13048, "Absolute Zero")], {
    understood: { kind: "names", label: 'Which "absolute zero"? 5 teams have that name; 2 of them still play: 12096 (Sterling, VA), 13048 (Englewood, NJ)' },
    suggest: ["is 12096 a real team", "is 13048 a real team"],
  } as Partial<SearchAnswer>);

  it("puts his answer first, a yes as the headline, the names as a plain line and one Related searches row", async () => {
    says.text = "Yes, Absolute Zero is several real teams.";
    state.answer = names();
    const { container } = show(NAMES);
    const lead = container.querySelector("[data-bruno-lead]")!;
    // Held from the first frame, before he answers.
    expect(lead.querySelector("[data-bruno-pending]")).not.toBeNull();
    await settle();
    expect(lead.querySelector("[data-bruno-verdict]")!.getAttribute("data-bruno-verdict")).toBe("Yes");
    const h1 = container.querySelector("h1")!;
    expect(lead.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h1.textContent).toBe("5 teams are named Absolute Zero; 2 still play");
    expect(h1.getAttribute("data-heading-size")).toBe("label");
    // The reading isn't said twice, and his card shows once.
    expect(container.querySelector("[data-understood]")).toBeNull();
    expect(container.querySelectorAll("[data-bruno-answer]")).toHaveLength(1);
    expect(container.textContent).not.toContain("Search can answer these");
    const related = container.querySelector("[data-related-lead]")!;
    expect(related.querySelector("h2")!.textContent).toBe("Related searches");
    expect([...related.querySelectorAll("[data-follow-chip]")].slice(0, 2).map((c) => c.textContent)).toEqual(["is 12096 a real team", "is 13048 a real team"]);
  });
  // Logged #2214/#2210: a question pointing back at an earlier answer ("… the matches u said here").
  const FOLLOW = "was that the same auto points in all the matches u said here";
  const follow = () => answer(FOLLOW, [], { chat: "follow-up", card: card("info", "A question about an earlier answer", undefined, [{ text: "Search reads each search on its own, so it can't see what it answered before", detail: "Ask again with the team or event in it" }]), understood: { kind: "question", label: "A question about an earlier answer" } });
  it("a follow-up asks him with the tab's last search, said under the heading", async () => {
    sessionStorage.setItem("cs-last-search", "4215 auto points");
    says.text = "Yes, 4215 scored the same auto points in each match.";
    state.answer = follow();
    const { container } = show(FOLLOW);
    await settle();
    expect(asked.at(-1)).toContain(`&after=${encodeURIComponent("4215 auto points")}`);
    expect(container.querySelector("[data-bruno-lead] [data-bruno-verdict]")).not.toBeNull();
    expect(container.querySelector("[data-follow-from]")!.textContent).toBe("Your last search: 4215 auto points");
    sessionStorage.clear();
  });
  it("a follow-up with no last search is the card alone, saying it needs the team or event", async () => {
    sessionStorage.clear();
    state.answer = follow();
    const { container } = show(FOLLOW);
    await settle();
    expect(asked).toHaveLength(0);
    expect(container.querySelector("[data-follow-from]")).toBeNull();
    expect(container.textContent).toContain("Ask again with the team or event in it");
  });
  it("lets his slot go and gives the heading its size back when he has nothing to add", async () => {
    says.text = null;
    state.answer = answer("where are the nj workshops", [ev("NJW1", "FTC NJ Multi-Track Workshops (North)")], { understood: { kind: "names", label: 'Teams, events and matches matching "nj workshops"' } } as Partial<SearchAnswer>);
    const { container } = show("where are the nj workshops");
    expect(container.querySelector("h1")!.getAttribute("data-heading-size")).toBe("label");
    await settle();
    expect(container.querySelector("[data-bruno-pending], [data-bruno-answer]")).toBeNull();
    // The slot's frame goes too: no empty gap above the heading.
    expect(container.querySelector("[data-bruno-lead]")).toBeNull();
    expect(container.querySelector("h1")!.getAttribute("data-heading-size")).toBeNull();
  });
  it.each([["as typed", "where are the nj workshops"], ["with spaces around it", "  where are the nj workshops  "]])("lets the slot go for a question %s", async (_, q) => {
    says.text = null;
    state.answer = answer(q.trim(), [ev("NJW1", "FTC NJ Multi-Track Workshops (North)")], { understood: { kind: "names", label: 'Teams, events and matches matching "nj workshops"' } } as Partial<SearchAnswer>);
    const { container } = show(q);
    expect(container.querySelector("[data-bruno-lead]")).not.toBeNull();
    await settle();
    expect(container.querySelector("[data-bruno-lead]")).toBeNull();
    expect(container.querySelector("h1")!.getAttribute("data-heading-size")).toBeNull();
  });
  it("asks again when the search runs again after he couldn't be reached", async () => {
    says.fail = true;
    state.answer = names();
    const page = () => <MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(NAMES)}`]}><SearchPage /></MemoryRouter>;
    const { container, rerender } = render(page());
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector("[data-bruno-lead]")).toBeNull();
    says.fail = false;
    state.busy = true;
    rerender(page());
    state.busy = false;
    rerender(page());
    expect(container.querySelector("[data-bruno-lead] [data-bruno-pending]")).not.toBeNull();
    await settle();
    expect(container.querySelector("[data-bruno-lead] [data-bruno-answer]")).not.toBeNull();
  });
  it("says a comparison of two shared names as a plain line too", () => {
    const q = "is ultraviolet better than mirror";
    state.answer = answer(q, [team(20245, "Ultraviolet"), team(23268, "Ultraviolet"), team(1111, "Mirror"), team(2222, "Mirror")], {
      understood: { kind: "compare", label: 'Which "ultraviolet"? 3 teams have that name; 2 of them still play: 20245 (Norton Shores, MI), 23268 (Hackettstown, NJ) · Which "mirror"? 2 teams have that name: 1111 (A, B), 2222 (C, D)' },
    } as Partial<SearchAnswer>);
    const { container } = show(q);
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("3 teams are named Ultraviolet; 2 still play · 2 teams are named Mirror");
    expect(h1.getAttribute("data-heading-size")).toBe("label");
  });
  it("keeps a failed search's heading at its size, with no card above it", () => {
    state.answer = names();
    state.error = "Search failed. Check your connection.";
    const { container } = show(NAMES);
    expect(container.querySelector("[data-bruno-lead]")).toBeNull();
    expect(container.querySelector("h1")!.getAttribute("data-heading-size")).toBeNull();
    // Nor its words: no names list shows under it.
    expect(container.querySelector("h1")!.textContent).not.toContain("teams are named");
  });
  it("never leads a standing question, whose summary comes with the team's numbers", async () => {
    state.answer = answer("how good is simply complex", [team(18061, "Simply Complex")]);
    const { container } = show("how good is simply complex");
    await settle();
    expect(container.querySelector("[data-bruno-lead]")).toBeNull();
    expect(container.querySelectorAll("[data-bruno-answer]")).toHaveLength(1);
  });
});

describe.each([
  ["desktop", false],
  ["phone", true],
])("Bruno AI's overview on /search (%s)", (_, phone) => {
  const real = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = real; });

  const direct = (a: SearchAnswer) => !a.weak && !!(a.card || a.stat);
  it.each(QUESTIONS.filter(([, , make]) => direct(make())))("%s: \"%s\" is search's answer card alone", async (_kind, q, make) => {
    state.answer = make();
    const { container } = show(q);
    await settle();
    expect(asked).toEqual([]);
    expect(container.querySelector("[data-bruno-answer]")).toBeNull();
  });

  it("a weak card still asks him (search's answer is a guess)", async () => {
    const [, q, make] = QUESTIONS.find(([k]) => k === "a team's awards")!;
    state.answer = { ...make(), weak: true };
    const { container } = show(q);
    await settle();
    expect(asked).toEqual([`/api/search/bruno?q=${encodeURIComponent(q)}&stream=1`]);
    expect(container.querySelectorAll("[data-bruno-answer]")).toHaveLength(1);
  });

  it.each(QUESTIONS.filter(([, , make]) => !direct(make())))("%s: \"%s\" shows his card", async (_kind, q, make) => {
    state.answer = make();
    const { container } = show(q);
    await settle();
    expect(asked).toEqual([`/api/search/bruno?q=${encodeURIComponent(q)}&stream=1`]);
    const cards = container.querySelectorAll("[data-bruno-answer]");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Bruno AI");
    expect(cards[0].textContent).toContain("Bruno's overview of the records.");
    // On a phone his writing is folded under "Show AI Analysis" (never dropped) when a summary comes first in his
    // card; with none, his answer is the page's answer and shows open.
    if (phone && cards[0].querySelector("[data-search-summary]")) expect(cards[0].querySelector("[data-ai-analysis]")!.textContent).toContain("Bruno's overview of the records.");
    else expect(cards[0].querySelector("[data-ai-analysis]")).toBeNull();
  });
});
