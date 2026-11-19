// @vitest-environment jsdom
// The /search page in v8 (docs/design/v8-revamp-brief.md §7 item 2): the page title at v8's size in Inter, a quiet
// eyebrow, one entrance stagger on the results column, neutral section heads (the live dot in live red, no coloured
// fills), calm palette classes after the v8-off ones. v8 off keeps every class it had.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../shared/api";
import { SEARCH_PALETTE } from "../lib/textTones";
import { TONE, V8_PODIUM, V8_STAGGER } from "../components/search/page/v8tone";

const state = vi.hoisted(() => ({ answer: undefined as SearchAnswer | undefined }));
vi.mock("../components/search/SearchBox", async (orig) => ({
  ...(await orig<typeof import("../components/search/SearchBox")>()),
  useSearchHits: () => ({ hits: state.answer?.hits ?? [], answer: state.answer, busy: false, error: null, retry: () => {}, searchNow: () => {}, logPick: () => {}, stale: false, prefer: "" }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2025, useMediaQuery: () => false }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: undefined, error: null, loading: false }) }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
vi.mock("../lib/personal", async (orig) => ({ ...(await orig<typeof import("../lib/personal")>()), usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }), useTeamFlags: () => ({ bookmarked: false, toggleBookmark: () => {} }) }));

const { default: SearchPage } = await import("./SearchPage");
const { RankPill, TEAM_BAR, swatchOf } = await import("../components/search/page/answerCells");
const { TeamTable } = await import("../components/search/TeamTable");
const { FollowChips } = await import("../components/search/page/V8Results");

const team = (n: number, name: string): SearchHit => ({ kind: "team", ref: String(n), title: `${n} ${name}`, subtitle: "Oradell, NJ, USA", season: 2025 });
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ev = (code: string, name: string, start: string): SearchHit => ({ kind: "event", ref: `2025:${code}`, title: name, subtitle: `${code} · ${start} · Oradell, NJ, USA`, season: 2025 });
const answer = (hits: SearchHit[]): SearchAnswer => ({ q: "x", hits, pages: [], step: "deterministic", weak: false });
const show = (url: string) => render(<MemoryRouter initialEntries={[url]}><SearchPage /></MemoryRouter>);

afterEach(() => { cleanup(); state.answer = undefined; });

describe("search page, v8 on", () => {
  beforeEach(() => document.documentElement.setAttribute("data-v8", ""));
  afterEach(() => document.documentElement.removeAttribute("data-v8"));

  it("draws the page title at v8's size in Inter, no eyebrow, then one line of how the query was read", () => {
    state.answer = { ...answer([team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")]), understood: { kind: "names", label: "Teams named robotics" } };
    const { container } = show("/search?q=robotics");
    const h1 = container.querySelector("h1")!;
    expect(h1.className).toContain("v8:font-sans");
    expect(h1.className).toContain("v8:text-[1.375rem]");
    expect(container.querySelector("[data-eyebrow]")!.className).toContain("v8:hidden");
    const line = container.querySelector("[data-understood]")!;
    expect(line.textContent).toBe("“robotics” read as names: Teams named robotics");
    // The understood line replaces the reading badge; there is no side column.
    expect(container.querySelector("[data-context-badge]")).toBeNull();
    expect(container.querySelector("[data-side]")).toBeNull();
  });

  it("answers a team asked for by itself with its compact summary, not a team card among the results", () => {
    state.answer = { ...answer([team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")]), understood: { kind: "team", label: "Hypnotic Robotics (4215)" } };
    const { container } = show("/search?q=4215");
    const card = container.querySelector('[data-v8-answer="team"]')!;
    expect(card.querySelector("[data-team-number]")!.textContent).toBe("4215");
    expect(card.textContent).toContain("Hypnotic Robotics");
    expect(within(card as HTMLElement).getByRole("link", { name: /Team page/ }).getAttribute("href")).toMatch(/^\/teams\/4215/);
    // The team isn't listed again below; the other team is a plain row.
    const rows = [...container.querySelectorAll('[data-row="team"]')].map((r) => r.textContent);
    expect(rows).toEqual([expect.stringContaining("6980 Bad Wolf")]);
  });

  it("lists related results as plain rows, grouped, five shown and the rest behind Show N more", () => {
    state.answer = answer(Array.from({ length: 7 }, (_, i) => team(1000 + i, `Team ${i}`)));
    const { container } = show("/search?q=team");
    const group = container.querySelector('[data-v8-group="team"]')!;
    expect(group.querySelectorAll('[data-row="team"]')).toHaveLength(5);
    expect(container.querySelector('[data-result="team"]')).toBeNull(); // no stacked cards
    const more = within(group as HTMLElement).getByRole("button", { name: "Show 2 more" });
    fireEvent.click(more);
    expect(group.querySelectorAll('[data-row="team"]')).toHaveLength(7);
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens the next search's groups capped again (the page stays mounted between searches)", () => {
    state.answer = answer(Array.from({ length: 7 }, (_, i) => team(1000 + i, `Team ${i}`)));
    const { container, rerender } = show("/search?q=team");
    fireEvent.click(within(container.querySelector('[data-v8-group="team"]') as HTMLElement).getByRole("button", { name: "Show 2 more" }));
    state.answer = answer(Array.from({ length: 8 }, (_, i) => team(2000 + i, `Other ${i}`)));
    rerender(<MemoryRouter initialEntries={["/search?q=team"]}><SearchPage /></MemoryRouter>);
    const group = container.querySelector('[data-v8-group="team"]') as HTMLElement;
    expect(group.querySelectorAll('[data-row="team"]')).toHaveLength(5);
    expect(within(group).getByRole("button", { name: "Show 3 more" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the next ranking at its top 5 again after Show all on the last one", () => {
    const lb = (base: number) => ({
      family: "leaderboard", intent: "top-opr", title: "Top 10 teams by OPR", scope: [], source: "From the season", definition: "",
      blocks: [{ kind: "leaderboard", title: "Top 10 by OPR", stat: { id: "opr", label: "OPR" }, note: "",
        rows: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, team: { label: `${base + i} T${i}`, href: `/teams/${base + i}` }, location: null, record: "1-0-0", opr: 100 - i, value: 100 - i, display: String(100 - i) })) }],
    }) as unknown as SearchAnswer["stat"];
    state.answer = { ...answer([]), stat: lb(100) };
    const { container, rerender } = show("/search?q=top%20teams");
    fireEvent.click(within(container.querySelector('[data-block="leaderboard"]') as HTMLElement).getByRole("button", { name: "Show all 10" }));
    expect(container.querySelectorAll("[data-team-row]")).toHaveLength(10);
    state.answer = { ...answer([]), stat: lb(500) };
    rerender(<MemoryRouter initialEntries={["/search?q=top%20teams"]}><SearchPage /></MemoryRouter>);
    expect([...container.querySelectorAll("[data-team-row]")].map((r) => r.getAttribute("data-team-row"))).toEqual(["500", "501", "502", "503", "504"]);
  });

  it("gives the results column its one entrance stagger, CSS only, none under reduced motion", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")]);
    const { container } = show("/search?q=robotics");
    const col = container.querySelectorAll("[data-stagger]");
    expect(col).toHaveLength(1);
    for (const c of V8_STAGGER.split(" ")) expect(col[0].className).toContain(c);
    expect(V8_STAGGER).toContain("motion-reduce:v8:[&>*]:animate-none");
    // Uneven steps, each 30–60ms apart.
    const delays = [0, ...[...V8_STAGGER.matchAll(/delay-\[(\d+)ms\]/g)].map((m) => Number(m[1]))];
    for (let i = 1; i < delays.length; i++) { const d = delays[i] - delays[i - 1]; expect(d).toBeGreaterThanOrEqual(30); expect(d).toBeLessThanOrEqual(60); }
    expect(new Set(delays.slice(1).map((d, i) => d - delays[i])).size).toBeGreaterThan(1);
  });

  it("lists events as plain rows, the live one first with its dot in live red, no status bands", () => {
    state.answer = answer([ev("USNJQ2", "NJ Qualifier Two", iso(new Date(today.getTime() + 20 * 864e5))), { ...ev("USNJQ1", "NJ Qualifier", iso(today)), event: { start: iso(today), end: iso(new Date(today.getTime() + 864e5)) } } as SearchHit]);
    const { container } = show("/search?q=nj%20qualifier");
    expect(container.querySelector("[data-section-tone]")).toBeNull();
    const rows = [...container.querySelectorAll('[data-row="event"]')];
    expect(rows.map((r) => r.querySelector("span > span")!.textContent)).toEqual(["NJ Qualifier", "NJ Qualifier Two"]);
    expect(rows[0].querySelector("[data-live] > span")!.className).toContain("bg-live");
    // No event code or raw date on a row.
    expect(rows[1].textContent).not.toContain("USNJQ2");
  });

  it("makes every palette meaning calm: neutral fill and words, the v8-off classes still first", () => {
    for (const m of Object.keys(SEARCH_PALETTE) as (keyof typeof SEARCH_PALETTE)[]) {
      expect(TONE[m].fill.startsWith(SEARCH_PALETTE[m].fill)).toBe(true);
      expect(TONE[m].fill).toContain("v8:bg-white/[0.08]");
      expect(TONE[m].text).toContain("v8:text-foreground");
      expect(TONE[m].tint).toContain("v8:bg-transparent");
    }
    // RP's yellow chip of words loses its chip.
    expect(TONE.rp.text).toContain("v8:bg-transparent");
    // Mint is the one highlight series: team A's bar; awards go neutral.
    expect(TEAM_BAR).toContain("v8:bg-accent");
    expect(swatchOf("Inspire Award").fill).toContain("v8:bg-white/[0.08]");
  });

  it("marks the #1 rank in mint words on a hairline, never a fill", () => {
    const { container } = render(<RankPill text="#1 of 10" />);
    const pill = container.querySelector("[data-rank-pill]")!;
    for (const c of V8_PODIUM[1].split(" ")) expect(pill.className).toContain(c);
    expect(V8_PODIUM[1]).toContain("v8:bg-transparent");
  });
});

describe("v8 answer pieces", () => {
  it("follow-ups: the 2–4 most useful as chips, People also ask first, each once", () => {
    const f = (q: string) => ({ q, family: "team" as const, preview: q, value: "", rest: "", tone: { count: true as const } });
    render(<MemoryRouter><FollowChips ask={[f("What is 4215's OPR?"), f("What is 4215's record?"), f("What is 4215's rating?")]} related={[f("what is 4215's opr?"), f("4215 win rate"), f("4215 awards")]} seeAll="4215" /></MemoryRouter>);
    expect(screen.getAllByRole("link").filter((a) => a.hasAttribute("data-follow-chip")).map((a) => a.textContent)).toEqual(["What is 4215's OPR?", "What is 4215's record?", "What is 4215's rating?", "4215 win rate"]);
    expect(screen.getByRole("link", { name: /More related searches/ }).getAttribute("href")).toBe("/related-searches?q=4215");
  });

  it("a ranking is sized to the question: the table draws only the first rows it's limited to, after sorting", () => {
    const row = (rank: number, opr: number) => ({ rank, team: 100 + rank, name: `T${rank}`, location: null, href: `/teams/${100 + rank}`, opr, auto: null, dc: null, endgame: null, pen: null, wins: 1, losses: 0, ties: 0 });
    const table = { by: "opr" as const, rows: Array.from({ length: 10 }, (_, i) => row(i + 1, 100 - i)) };
    const { container } = render(<MemoryRouter><TeamTable table={table} label="Top" limit={5} /></MemoryRouter>);
    expect([...container.querySelectorAll("[data-team-row]")].map((r) => r.getAttribute("data-team-row"))).toEqual(["101", "102", "103", "104", "105"]);
  });
});

describe("search page, v8 off", () => {
  it("keeps today's title and eyebrow classes", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")]);
    const { container } = show("/search?q=robotics");
    expect(document.documentElement.hasAttribute("data-v8")).toBe(false);
    const h1 = container.querySelector("h1")!;
    for (const c of ["font-display", "text-xl", "md:text-2xl", "lg:text-3xl"]) expect(h1.classList.contains(c)).toBe(true);
    expect(container.querySelector("[data-eyebrow]")!.classList.contains("font-semibold")).toBe(true);
    // None of v8's layout: no understood line, no compact team answer, no row groups.
    expect(container.querySelector("[data-understood]")).toBeNull();
    expect(container.querySelector("[data-v8-results]")).toBeNull();
    expect(container.querySelector("[data-v8-group]")).toBeNull();
    expect(container.querySelectorAll('[data-result="team"]').length).toBe(2);
  });

  it("keeps the palette's colours as the classes v8 off reads", () => {
    expect(TONE.auto.fill.split(" ").filter((c) => !c.startsWith("v8:")).join(" ")).toBe(SEARCH_PALETTE.auto.fill);
    expect(TONE.live.text.split(" ").filter((c) => !c.startsWith("v8:")).join(" ")).toBe(SEARCH_PALETTE.live.text);
    expect(TEAM_BAR.split(" ").filter((c) => !c.startsWith("v8:"))).toEqual(["bg-team-a"]);
  });
});
