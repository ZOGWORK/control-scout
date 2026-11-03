// @vitest-environment jsdom
// FTC One Search's dropdown groups (Requirement 17): a Compare in its own group above the teams (never one of them,
// never counted as one), teams with one OPR badge, events with their dates and places, labelled Pages, and the live
// "we understood" line, all in the /search page's order.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";

const t = (ref: string, name: string, extra: Partial<SearchHit> & Record<string, unknown> = {}): SearchHit => ({ kind: "team", ref, title: `${ref} | ${name}`, subtitle: "Oradell, NJ, USA", season: 2026, ...extra });
const ev = (code: string, title: string, start: string): SearchHit => ({ kind: "event", ref: `2026:${code}`, title, subtitle: `${code} · ${start} · Ramsey, NJ, USA`, season: 2026, event: { start, end: start, type: "LeagueMeet", venue: "Don Bosco Prep High School", status: "upcoming" } });
const answer = (q: string, a: Partial<SearchAnswer>): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, ...a });

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, SEARCH_DEBOUNCE_MS } = await import("./SearchBox");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); Element.prototype.scrollIntoView = () => {}; localStorage.clear(); });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); });

async function search(q: string, body: SearchAnswer) {
  const onPick = vi.fn();
  render(<SearchBox onPick={onPick} placeholder="Search" label="Search" />);
  const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: q } });
  await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
  const [p] = pending.splice(0, 1);
  await act(async () => { p.resolve(body); });
  return { input, onPick };
}
const groups = () => screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
const count = (name: string) => within(screen.getByRole("group", { name })).queryByText((_, el) => el?.hasAttribute("data-count") ?? false)?.textContent;

describe("a Compare", () => {
  const compareAsTeam = t("4215", "x", { title: "4215 Hypnotic Robotics vs 6980 Bad Wolf", subtitle: "Compare side by side: records, OPR and event history", href: "/compare?teams=4215,6980" });
  const vs = answer("4215 vs 6980", { understood: { kind: "compare", label: "Hypnotic Robotics (4215) vs Bad Wolf (6980) — Compare" }, hits: [compareAsTeam, t("4215", "Hypnotic Robotics"), t("6980", "Bad Wolf")] });

  it("is its own group above the teams, and the teams count only the teams", async () => {
    await search("4215 vs 6980", vs);
    expect(groups()).toEqual(["Comparisons", "Teams"]);
    expect(count("Teams")).toBe("2");
    const row = within(screen.getByRole("group", { name: "Comparisons" })).getByRole("option");
    expect(row.hasAttribute("data-compare")).toBe(true);
    expect(row.textContent).toContain("Hypnotic Robotics (4215)vsBad Wolf (6980)");
    expect(within(screen.getByRole("group", { name: "Teams" })).queryByText(/vs/)).toBeNull();
  });
  it("keeps the server's own line (it says when teams were left out)", async () => {
    const many = { ...compareAsTeam, subtitle: "Compare side by side (the first 4 of the 6 teams named)" };
    await search("a vs b vs c vs d vs e vs f", answer("a vs b vs c vs d vs e vs f", { hits: [many] }));
    expect(within(screen.getByRole("group", { name: "Comparisons" })).getByRole("option").textContent).toContain("the first 4 of the 6 teams named");
  });
  it("comes first for the keyboard too, and opens /compare", async () => {
    const { input, onPick } = await search("4215 vs 6980", vs);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(compareAsTeam);
  });
  it("its own kind from the server, with the sides it names (number, name, place)", async () => {
    const own = { kind: "compare", ref: "4215,20245", title: "4215 Hypnotic Robotics vs 20245 Ultraviolet", subtitle: "", season: 2026, href: "/compare?teams=4215,20245", compare: { teams: [{ number: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ" }, { number: 20245, name: "Ultraviolet", place: "Norton Shores, MI" }] } } as unknown as SearchHit;
    await search("ultraviolet vs hypnotic", answer("ultraviolet vs hypnotic", { hits: [own, t("20245", "Ultraviolet"), t("4215", "Hypnotic Robotics")] }));
    expect(groups()).toEqual(["Comparisons", "Teams"]);
    expect(within(screen.getByRole("group", { name: "Comparisons" })).getByRole("option").textContent).toContain("Hypnotic Robotics (4215)vsUltraviolet (20245)");
  });
});

describe("the we-understood line", () => {
  it("names what the query was read as, never a result", async () => {
    await search("meets in new jersey", answer("meets in new jersey", { understood: { kind: "events", label: "League meets in New Jersey", total: 26 }, hits: [ev("USNJNEM2", "P1-5 AM Northeast League Meet", "2026-11-07")] }));
    expect(screen.getByText("Understood: League meets in New Jersey")).toBeTruthy();
  });
  it("says a labelled fallback under it", async () => {
    await search("meets at x in nj", answer("meets at x in nj", { understood: { kind: "events", label: "League meets in New Jersey at X", fallback: "No league meets at X in New Jersey — showing all league meets in New Jersey instead" }, hits: [ev("USNJNEM2", "P1-5 AM Northeast League Meet", "2026-11-07")] }));
    expect(screen.getByText("Understood: League meets in New Jersey at X")).toBeTruthy();
    expect(screen.getByText(/showing all league meets in New Jersey instead/)).toBeTruthy();
  });
  it("a correction says it itself: no second line", async () => {
    await search("hypnotik", answer("hypnotik", { step: "did-you-mean", didYouMean: "hypnotic", understood: { kind: "names", label: "hypnotic" }, hits: [t("4215", "Hypnotic Robotics")] }));
    expect(screen.queryByText(/^Understood:/)).toBeNull();
    expect(document.querySelector("[data-did-you-mean]")).toBeTruthy();
  });
});

describe("events", () => {
  it("a row reads its dates and place (no event code or raw date); the count is of the whole set", async () => {
    await search("meets in new jersey", answer("meets in new jersey", { understood: { kind: "events", label: "League meets in New Jersey", total: 26 }, hits: [ev("USNJNEM2", "P1-5 AM Northeast League Meet", "2026-11-07"), ev("USNJNEM4", "P2-1 Northeast League Meet", "2026-11-14")] }));
    expect(count("Events")).toBe("2 of 26");
    const when = [...document.querySelectorAll("[data-event-when]")].map((e) => e.textContent);
    expect(when[0]).toMatch(/Nov 7/);
    expect(when[0]).toContain("Ramsey, NJ, USA");
    expect(when[0]).not.toMatch(/USNJNEM2|2026-11-07/);
  });
});

describe("teams", () => {
  it("one OPR badge each, only when the server sends one", async () => {
    await search("simply", answer("simply", { hits: [t("18061", "Simply Complex", { team: { season: 2025, opr: 119.73 } }), t("99", "Simply Nothing")] }));
    const badges = [...document.querySelectorAll("[data-opr]")].map((e) => e.textContent);
    expect(badges).toEqual(["OPR 119.7"]);
  });
  it("names only sharing a word with the query are apart from the exact match", async () => {
    await search("how good is simply complex", answer("how good is simply complex", { hits: [t("18061", "Simply Complex", { match: "exact" }), t("7100", "Good Enough", { match: "fuzzy", matched: ["good"] })] }));
    expect(groups()).toEqual(["Teams", "Other teams matching “good”"]);
    expect(count("Teams")).toBe("1");
  });
  it("a team row has the team badge icon, not the people icon", async () => {
    await search("4215", answer("4215", { hits: [t("4215", "Hypnotic Robotics")] }));
    expect(screen.getByRole("option", { name: /Hypnotic Robotics/ }).querySelector("svg")?.getAttribute("class")).toMatch(/lucide-shield/);
  });
});

describe("pages", () => {
  it("are their own labelled group, below the results", async () => {
    await search("4215 records", answer("4215 records", { hits: [t("4215", "Hypnotic Robotics")], pages: [{ title: "Records", href: "/records" }] }));
    expect(groups()).toEqual(["Teams", "Pages"]);
  });
});
