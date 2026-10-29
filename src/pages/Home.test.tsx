// @vitest-environment jsdom
// The home page as a visitor meets it: search and both main actions are there
// before any data (or the map) arrives; the atlas's selector changes the real
// total and links to that country's teams; usage that isn't published says so
// rather than showing zero; your team shows only when you've picked one, with
// its confidence tier; and a signed-in scout lands on their dashboard once,
// while coming back to / later stays on home.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { HomeOverview, PublicUsage } from "../shared/home";
import type { MatchView } from "../shared/api";
import { LIVE_THRESHOLD, pickHeadline } from "../shared/ledger";

const OVERVIEW: HomeOverview = {
  season: 2026, generatedAt: "2026-10-17T12:00:00Z", dataAsOf: "2026-10-17T10:00:00Z", statsAt: null,
  coverage: { teamListings: 23, events: 4, matchScores: 9 },
  readiness: { state: "ready", resultsAt: "2026-10-17T10:00:00Z", statsAt: "2026-10-17T10:05:00Z" },
  countries: [
    { code: "US", numeric: "840", name: "United States", listings: 15, withResults: 4 },
    { code: "CA", numeric: "124", name: "Canada", listings: 5, withResults: 0 },
  ],
  unmapped: [{ label: "Independent", listings: 3 }],
};
const USAGE_OFF: PublicUsage = { status: "unavailable", reason: "not-published", from: "2026-09-18", to: "2026-10-17", measuredFrom: null, generatedAt: "2026-10-17T12:00:00Z", measuredThrough: null, coverage: "opt-in", totals: null, daily: [] };
const NEXT = {
  season: 2026, code: "USNJQ1", label: "Q12", played: false, startsAt: new Date(Date.now() + 3600_000).toISOString(), time: null,
  red: { teams: [{ number: 4215 }, { number: 1 }] }, blue: { teams: [{ number: 2 }, { number: 3 }] },
  prediction: { pRed: 0.64, tier: "moderate" },
} as unknown as MatchView;

let data: Record<string, unknown> = {};
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  useApi: (path: string | null) => {
    const key = path ? Object.keys(data).find((k) => path.startsWith(k)) : undefined;
    return { data: key ? data[key] : undefined, error: undefined, loading: !key, reload: () => {} };
  },
}));
let phone = false;
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useCurrentSeason: () => 2026, useTitle: () => {}, useMediaQuery: () => phone, useMeta: () => null }));
const st = (myTeam: number | null) => ({ myTeam, tracked: { teams: [], events: [] }, bookmarks: [] });
let personal: { user: unknown; state: ReturnType<typeof st> } = { user: null, state: st(null) };
vi.mock("../lib/personal", () => ({ usePersonal: () => personal }));
// The drawing itself is d3 on real boundaries: stood in for here (the selector and list are what's tested).
vi.mock("../components/home/AtlasMap", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({ spinning, onLoaded }: { spinning?: boolean; onLoaded: (d: ReadonlySet<string>) => void }) => {
      useEffect(() => onLoaded(new Set(["840", "124"])), []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="map" data-spinning={String(!!spinning)} />;
    },
    loadWorld: () => Promise.resolve([]),
  };
});

let reduced = false;
vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotion: () => reduced }));

let path = "";
function Where() { path = useLocation().pathname; return null; }
const { default: Home } = await import("./Home");
const mount = () => render(<MemoryRouter initialEntries={["/"]}><Home /><Where /></MemoryRouter>);

beforeEach(() => { phone = false; reduced = false; data = {}; personal = { user: null, state: st(null) }; sessionStorage.clear(); });
afterEach(cleanup);

describe("Home", () => {
  it("has the headline, search and both actions before any data arrives", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The whole field. In your corner.");
    expect(screen.getByLabelText("Search teams, events and matches")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Predict a match/ }).getAttribute("href")).toBe("/predict");
    expect(screen.getByRole("link", { name: /Find an event/ }).getAttribute("href")).toBe("/events");
    // No made-up numbers while loading.
    expect(screen.queryByText("23")).toBeNull();
  });

  it("shows the season's real totals, and the atlas's selector changes the country's total and its link", async () => {
    data = { "/api/home/overview": OVERVIEW };
    mount();
    expect(screen.getByText("23")).toBeTruthy();
    const readout = () => screen.getByText("Selected country").parentElement!.textContent;
    expect(readout()).toBe("Selected countryUnited States15team listings · 2026–27");
    // Two ways into a country: every listed team, and the teams with results.
    expect(screen.getByRole("link", { name: /All 15 listed teams/ }).getAttribute("href")).toBe("/teams?view=listed&country=US");
    expect(screen.getByRole("link", { name: /4 teams with results/ }).getAttribute("href")).toBe("/teams?view=season&country=US");
    // The app's own dropdown (Radix Select): open it, then choose.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => {};
    fireEvent.pointerDown(screen.getByRole("combobox", { name: /Explore/ }), { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: /Canada/ }));
    expect(readout()).toBe("Selected countryCanada5team listings · 2026–27");
    // Statistics ready and nobody played: the true zero, and the country still has its directory.
    expect(screen.getByText("No Canada team has played a match yet this season.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /All 5 listed teams/ }).getAttribute("href")).toBe("/teams?view=listed&country=CA");
    // Healthy: a one-line status, no explanation panel and no retry.
    expect(screen.getByText("Statistics up to date")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Check again/ })).toBeNull();
    // The list reconciles every listing, including those without a country.
    expect(screen.getByText("Reported as “Independent”")).toBeTruthy();
    expect(screen.getByText(/= 23 team listings/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("map")).toBeTruthy());
  });

  it("never states a factual zero while the season's statistics are still being prepared (DATA-F01)", async () => {
    // Results have been played but no records are built: every withResults reads 0.
    data = { "/api/home/overview": {
      ...OVERVIEW,
      readiness: { state: "preparing", resultsAt: "2026-10-17T10:00:00Z", statsAt: null },
      countries: OVERVIEW.countries.map((c) => ({ ...c, withResults: 0 })),
    } };
    mount();
    expect(screen.queryByText(/has played a match yet/)).toBeNull();
    expect(screen.getByText("Results are still being prepared")).toBeTruthy();
    // Discovery keeps working: every listed team is one tap away.
    expect(screen.getByRole("link", { name: /All 15 listed teams/ })).toBeTruthy();
    // The status says what's happening and offers a retry.
    expect(screen.getByText("Statistics being prepared")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Check again/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("map")).toBeTruthy());
  });

  it("turns the globe by itself, with a button that stops and restarts it", async () => {
    data = { "/api/home/overview": OVERVIEW };
    mount();
    const map = await screen.findByTestId("map");
    expect(map.dataset.spinning).toBe("true");
    fireEvent.click(await screen.findByRole("button", { name: "Stop the globe turning" }));
    expect(screen.getByTestId("map").dataset.spinning).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Turn the globe" }));
    expect(screen.getByTestId("map").dataset.spinning).toBe("true");
    // The flat atlas doesn't turn, and offers no pause button.
    fireEvent.click(screen.getByRole("radio", { name: "Flat atlas" }));
    expect(screen.queryByRole("button", { name: /globe turning|Turn the globe/ })).toBeNull();
  });

  it("keeps the globe still for a visitor who asks for less motion, and lets them start it", async () => {
    reduced = true;
    data = { "/api/home/overview": OVERVIEW };
    mount();
    expect((await screen.findByTestId("map")).dataset.spinning).toBe("false");
    fireEvent.click(await screen.findByRole("button", { name: "Turn the globe" }));
    expect(screen.getByTestId("map").dataset.spinning).toBe("true");
  });

  it("switches between live calls and the replay as a keyboard-reachable choice, and never shows 0% for undecided calls", () => {
    const blk = (n: number, decided: number, accuracy: number, upsets: number) => ({
      n, decided, accuracy, upsets, brier: 0, logLoss: 0, baselineBrier: 0.25, reliability: [], weekly: [],
      byTier: { provisional: { n: 0, accuracy: 0, brier: 0 }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
      byLevel: { qual: { n: 0, accuracy: 0 }, playoff: { n: 0, accuracy: 0 } },
    });
    data = { "/api/predict/accuracy": {
      seasons: [{ season: 2026, label: "2026–27", live: blk(2, 0, 0, 0), backtest: null }, { season: 2025, label: "2025–26", live: null, backtest: blk(100, 90, 0.7, 27) }],
      engineVersion: "2.1.1", liveThreshold: 10_000, headline: { kind: "backtest", season: 2025, accuracy: 0.7, n: 100 }, recentCalls: [], generatedAt: new Date().toISOString(),
    } };
    mount();
    // Each choice carries its sample size; the replay leads (the live sample is under the threshold).
    expect(screen.getByRole("radio", { name: "Season replay, 100 scored" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Season replay · the headline")).toBeTruthy();
    expect(screen.getByText("63 correct")).toBeTruthy();
    expect(screen.getByText("27 missed")).toBeTruthy();
    expect(screen.getByText(/The headline is the 2025–26 replay, the newest with at least 10,000 replayed matches\. Live calls take over once a season has 10,000 scored \(2026–27: 2 so far\)\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Logged live, 2 scored" }));
    expect(screen.getByText("Logged live · still calibrating")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("Still calibrating this season. Early-season calls lean on ratings built from few matches, so this number moves as results arrive. It isn’t the headline until 2026–27 has 10,000 live calls scored (2 so far).");
    expect(screen.getByLabelText("No percentage yet")).toBeTruthy();
    expect(screen.queryByText(/^0(\.0)?$/)).toBeNull();
    expect(screen.getByText(/All 2 scored calls were ties or 50:50 calls/)).toBeTruthy();
  });

  it("a few weeks into a season, opens on last season's replay as the headline and says live is still calibrating", () => {
    const blk = (n: number, decided: number, accuracy: number, upsets: number) => ({
      n, decided, accuracy, upsets, brier: 0.2, logLoss: 0.6, baselineBrier: 0.25, reliability: [], weekly: [],
      byTier: { provisional: { n, accuracy, brier: 0.2 }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
      byLevel: { qual: { n, accuracy }, playoff: { n: 0, accuracy: 0 } },
    });
    // Production on 2026-10-27, headline picked by the shared rule (the server does the same).
    const seasons = [
      { season: 2026, label: "2026–27 BIOBUZZ", live: blk(681, 673, 396 / 673, 277), backtest: blk(1053, 1040, 0.68, 333) },
      { season: 2025, label: "2025–26 DECODE", live: null, backtest: blk(41743, 41405, 30554 / 41405, 10851) },
    ];
    data = { "/api/predict/accuracy": { seasons, engineVersion: "3.2.0", liveThreshold: LIVE_THRESHOLD, headline: pickHeadline(seasons), recentCalls: [], generatedAt: new Date().toISOString() } };
    mount();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["Season replay, 41,743 scored", "Logged live, 681 scored"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Season replay · the headline")).toBeTruthy();
    expect(screen.getByText("73.8")).toBeTruthy();
    expect(screen.queryByText(/Live calls lead/)).toBeNull();
    fireEvent.click(radios[1]);
    expect(screen.getByText("Logged live · still calibrating")).toBeTruthy();
    expect(screen.queryByText(/· the headline/)).toBeNull();
    expect(screen.getByRole("note").textContent).toMatch(/^Still calibrating this season\..*until 2026–27 BIOBUZZ has 10,000 live calls scored \(681 so far\)\.$/);
  });

  it("shows the live figure beside the replay at the same size, labelled as all engine versions when it blends them", () => {
    const blk = (n: number, decided: number, accuracy: number, upsets: number) => ({
      n, decided, accuracy, upsets, brier: 0.2, logLoss: 0.6, baselineBrier: 0.25, reliability: [], weekly: [],
      byTier: { provisional: { n, accuracy, brier: 0.2 }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
      byLevel: { qual: { n, accuracy }, playoff: { n: 0, accuracy: 0 } },
    });
    const e = (engine: string, n: number, accuracy: number) => ({ engine, n, accuracy, brier: 0.2, logLoss: 0.6 });
    const seasons = [
      { season: 2026, label: "2026–27 BIOBUZZ", live: blk(706, 698, 415 / 698, 283), backtest: blk(1087, 1070, 0.68, 340), liveByEngine: [e("2.1.1", 59, 0.49), e("2.6.0", 15, 0.73), e("3.2.0", 632, 0.601)] },
      { season: 2025, label: "2025–26 DECODE", live: null, backtest: blk(41743, 41405, 30554 / 41405, 10851) },
    ];
    data = { "/api/predict/accuracy": { seasons, engineVersion: "3.2.0", liveThreshold: LIVE_THRESHOLD, headline: pickHeadline(seasons), recentCalls: [], generatedAt: new Date().toISOString() } };
    mount();
    const [replay, live] = screen.getAllByRole("radio");
    expect(replay.textContent).toMatch(/73\.8%/);
    expect(live.textContent).toMatch(/59\.5%/);
    expect(live.textContent).toMatch(/all season, all engine versions/);
    // Both figures share one size class.
    const size = (r: HTMLElement) => [...r.querySelectorAll("span")].find((s) => s.className.includes("font-display"))!.className;
    expect(size(live)).toBe(size(replay));
    fireEvent.click(live);
    expect(screen.getByText(/all engine versions \(v2\.1\.1, v2\.6\.0, v3\.2\.0\)/)).toBeTruthy();
    expect(screen.getByText(/from engine v3\.2\.0 alone, the one serving now \(632 scored\)/)).toBeTruthy();
  });

  it("opens on the same headline as the methodology ledger and shows how much of the season the replay covers", () => {
    const blk = (n: number, decided: number, accuracy: number, upsets: number) => ({
      n, decided, accuracy, upsets, brier: 0.2, logLoss: 0.6, baselineBrier: 0.25, reliability: [], weekly: [],
      byTier: { provisional: { n, accuracy, brier: 0.2 }, moderate: { n: 0, accuracy: 0, brier: 0 }, confident: { n: 0, accuracy: 0, brier: 0 } },
      byLevel: { qual: { n, accuracy }, playoff: { n: 0, accuracy: 0 } },
    });
    // No headline yet (both samples too small): the replay of the newest season opens, as on /methodology.
    data = { "/api/predict/accuracy": {
      seasons: [{ season: 2026, label: "2026–27 BIOBUZZ", live: blk(33, 33, 16 / 33, 17), backtest: blk(207, 198, 126 / 198, 72), replay: { scored: 231, replayed: 207, eventSkipped: 0, shortHanded: 24, other: 0 } }],
      engineVersion: "2.1.1", liveThreshold: 10_000, headline: null, recentCalls: [], generatedAt: new Date().toISOString(),
    } };
    mount();
    expect(screen.getByRole("radio", { name: "Season replay, 207 scored" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Season replay", { selector: "p" })).toBeTruthy(); // not "the headline": nothing leads yet
    expect(screen.getByText(/No headline yet: a replay needs 10,000 matches and live calls 10,000 scored/)).toBeTruthy();
    expect(screen.getByText("126 correct")).toBeTruthy();
    expect(screen.getByText("72 missed")).toBeTruthy();
    expect(screen.getByText(/207 of 231 scored matches replayed; 24 had a robot missing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Logged live, 33 scored" }));
    expect(screen.getByText("16 correct")).toBeTruthy();
    expect(screen.getByText("17 missed")).toBeTruthy();
    expect(screen.queryByText(/scored matches replayed/)).toBeNull(); // replay coverage never on the live view
  });

  it("says usage isn't published instead of showing zero", () => {
    data = { "/api/public-usage": USAGE_OFF };
    mount();
    expect(screen.getByText(/Public usage totals aren’t published yet/)).toBeTruthy();
    expect(screen.queryByText("Page views")).toBeNull();
  });

  it("shows a measured zero when usage is published", () => {
    data = { "/api/public-usage": { ...USAGE_OFF, status: "available", reason: null, totals: { pageViews: 0, sessionStarts: 0 }, daily: [{ day: "2026-10-17", pageViews: 0, sessionStarts: 0 }] } };
    mount();
    expect(screen.getByText("Page views")).toBeTruthy();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("invites a visitor without a team to find one (no sign-in), and never shows someone else's", () => {
    mount();
    expect(screen.getByRole("button", { name: /Find your team/ })).toBeTruthy();
    expect(screen.queryByText("4215")).toBeNull();
  });

  it("shows your team's next match with its odds and confidence tier", () => {
    personal = { user: null, state: st(4215) };
    data = { "/api/teams/4215/matches": { matches: [NEXT] }, "/api/teams-summary": { teams: [{ team: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ" }] } };
    mount();
    expect(screen.getByText("Hypnotic Robotics")).toBeTruthy();
    expect(screen.getByText(/64% to win/)).toBeTruthy();
    expect(document.body.textContent).toContain("confidence: fair");
    expect(path).toBe("/"); // not signed in: no redirect
  });

  it("stays on Home for a signed-in scout with a team: their team shows here, no redirect to My team", () => {
    personal = { user: { email: "a@b.c" }, state: st(4215) };
    data = { "/api/teams/4215/matches": { matches: [NEXT] }, "/api/teams-summary": { teams: [{ team: 4215, name: "Hypnotic Robotics", place: "Oradell, NJ" }] } };
    mount();
    expect(path).toBe("/");
    expect(screen.getByText("Hypnotic Robotics")).toBeTruthy();
  });

  it("opens with a search arriving in the URL (/?q=, the site search search engines know), even for a signed-in scout", () => {
    personal = { user: { email: "a@b.c" }, state: st(4215) };
    render(<MemoryRouter initialEntries={["/?q=%20hypnotic%20"]}><Home /><Where /></MemoryRouter>);
    expect(path).toBe("/");
    const box = screen.getByLabelText("Search teams, events and matches") as HTMLInputElement;
    expect(box.value).toBe("hypnotic");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    // And says plainly what the site is.
    expect(screen.getByText(/^Control Scout is free FTC scouting and match predictions/)).toBeTruthy();
  });

  it("opens the atlas on the globe on phones too", async () => {
    phone = true;
    data = { "/api/home/overview": OVERVIEW };
    mount();
    expect((await screen.findByRole("radio", { name: "Globe" })).getAttribute("aria-checked")).toBe("true");
  });
});
