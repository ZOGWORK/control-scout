// @vitest-environment jsdom
// The /search page in v8 (docs/design/v8-revamp-brief.md §7 item 2): the page title at v8's size in Inter, a quiet
// eyebrow, one entrance stagger on the results column, neutral section heads (the live dot in live red, no coloured
// fills), calm palette classes after the v8-off ones. v8 off keeps every class it had.
import { cleanup, render } from "@testing-library/react";
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

  it("draws the page title at v8's size in Inter, the eyebrow quiet", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")]);
    const { container } = show("/search?q=robotics");
    const h1 = container.querySelector("h1")!;
    expect(h1.className).toContain("v8:font-sans");
    expect(h1.className).toContain("v8:text-[1.375rem]");
    expect(container.querySelector("[data-eyebrow]")!.className).toContain("v8:text-text-faint");
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

  it("heads event sections with no fill, the live dot in live red", () => {
    state.answer = answer([ev("USNJQ1", "NJ Qualifier", iso(today)), ev("USNJQ2", "NJ Qualifier Two", iso(new Date(today.getTime() + 20 * 864e5)))]);
    const { container } = show("/search?q=nj%20qualifier");
    const heads = [...container.querySelectorAll("[data-section-tone]")];
    expect(heads.length).toBeGreaterThan(0);
    for (const h of heads) expect(h.className).toContain("v8:bg-transparent");
    const dot = container.querySelector("[data-live-dot]");
    if (dot) expect(dot.className).toContain("v8:bg-live");
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

describe("search page, v8 off", () => {
  it("keeps today's title and eyebrow classes", () => {
    state.answer = answer([team(4215, "Hypnotic Robotics"), team(6980, "Bad Wolf")]);
    const { container } = show("/search?q=robotics");
    expect(document.documentElement.hasAttribute("data-v8")).toBe(false);
    const h1 = container.querySelector("h1")!;
    for (const c of ["font-display", "text-xl", "md:text-2xl", "lg:text-3xl"]) expect(h1.classList.contains(c)).toBe(true);
    expect(container.querySelector("[data-eyebrow]")!.classList.contains("font-semibold")).toBe(true);
  });

  it("keeps the palette's colours as the classes v8 off reads", () => {
    expect(TONE.auto.fill.split(" ").filter((c) => !c.startsWith("v8:")).join(" ")).toBe(SEARCH_PALETTE.auto.fill);
    expect(TONE.live.text.split(" ").filter((c) => !c.startsWith("v8:")).join(" ")).toBe(SEARCH_PALETTE.live.text);
    expect(TEAM_BAR.split(" ").filter((c) => !c.startsWith("v8:"))).toEqual(["bg-team-a"]);
  });
});
