// @vitest-environment jsdom
// The LIVE panel as a user sees it: a countdown to the next match for their teams (red and blue, the
// win call with its tier), "Up next" without a timer when there's no time, the event's next match when
// none of theirs is left, new data moving it on, a new score flashing, and no timer left on exit.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail, MatchView } from "../shared/api";
import type { Assignment } from "../shared/assignments";

const personal = { videoLinks: {}, myTeam: null as number | null, tracked: { teams: [] as number[], events: [] as string[] } };
let assignments: Assignment[] = [];
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: personal, user: { id: 1, controlPoint: { accountId: 7, workspaces: [{ id: "ws1", name: "Team", role: "member" }] } } }) }));
vi.mock("../lib/flags", () => ({ useFlag: () => true }));
vi.mock("../lib/assignments", () => ({ useAssignments: (space: string | null) => ({ list: space ? assignments : [] }) }));
vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));

const { LivePanel, LiveCountdownChip, useLiveTarget } = await import("./LivePanel");
const { HeaderActions } = await import("./EventActions");
const { MatchRow } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const NOW = Date.UTC(2026, 9, 16, 15, 0);
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
function match(n: number, red: number[], blue: number[], o: Partial<MatchView> = {}): MatchView {
  const side = (ts: number[]) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
  return { season: 2025, code: "LIVE1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null,
    played: false, red: side(red), blue: side(blue), video: null,
    prediction: { pRed: 0.63, redMean: 120, blueMean: 104, tier: "moderate", kind: "now", predictedAt: null }, ...o };
}
function detail(matches: MatchView[], o: Partial<EventDetail["event"]> = {}): EventDetail {
  const teams = new Set(matches.flatMap((m) => [...m.red.teams, ...m.blue.teams].map((t) => t.number)));
  return {
    event: { season: 2025, code: "LIVE1", name: "Live Test", status: "live", timezone: "America/Chicago", start: "2026-10-16", end: "2026-10-16" } as EventDetail["event"],
    field: [...teams].map((team) => ({ team }) as EventDetail["field"][number]),
    matches, alliances: [], awards: [], advancement: null, forecastUnsupported: null,
    live: { checkedAt: new Date(NOW - 20_000).toISOString(), everySeconds: 60, auto: true }, ...o as object,
  } as EventDetail;
}
const refresh = { busy: false, note: null, at: 0, run: async () => {} };

function Panel({ d }: { d: EventDetail }) {
  const target = useLiveTarget(d, true);
  return <><LivePanel d={d} target={target} refresh={refresh} /><LiveCountdownChip target={target} onClick={() => {}} /></>;
}
const show = (d: EventDetail) => render(<MemoryRouter><TooltipProvider><Panel d={d} /></TooltipProvider></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  personal.myTeam = null; personal.tracked.teams = []; assignments = [];
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const MATCHES = [
  match(13, [1, 2], [3, 4], { played: true, startsAt: at(-8) }),
  match(14, [5, 6], [7, 8], { startsAt: at(2) }),
  match(15, [18360, 9], [10, 11], { startsAt: at(12) }),
  match(16, [12, 13], [555, 14], { startsAt: at(22) }),
];

describe("LivePanel", () => {
  it("counts down to my tracked team's next match, with red, blue and the call", () => {
    personal.tracked.teams = [18360];
    show(detail(MATCHES));
    expect(screen.getByText("Up next for you")).toBeTruthy();
    expect(screen.getAllByText("Q15").length).toBeGreaterThan(0);
    expect(screen.getByRole("timer").textContent).toBe("in12:00");
    expect(screen.getByText("Tracked")).toBeTruthy();
    expect(screen.getByText("Red 63% to win")).toBeTruthy();
    expect(screen.getByText(/moderate/)).toBeTruthy(); // never a call without its tier
    expect(screen.getByText(/10:12/)).toBeTruthy(); // 15:12 UTC at the venue (Chicago)
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByRole("timer").textContent).toBe("in10:55");
    expect(screen.getByRole("button", { name: /Q15 starts in 11 minutes/ })).toBeTruthy(); // the phone's sticky chip
  });

  it("counts down to a team assigned to me in my workspace", () => {
    localStorage.setItem("cs-scout-space", JSON.stringify({ id: "ws1" }));
    assignments = [{ id: 1, workspaceId: "ws1", season: 2025, eventCode: "LIVE1", team: 555, assigneeAccountId: 7, status: "open" } as Assignment,
      { id: 2, workspaceId: "ws1", season: 2025, eventCode: "LIVE1", team: 5, assigneeAccountId: 99, status: "open" } as Assignment];
    show(detail(MATCHES));
    expect(screen.getAllByText("Q16").length).toBeGreaterThan(0);
    expect(screen.getByText("Assigned to you")).toBeTruthy();
  });

  it("one tap from the next match to its scouting report (v1.6 Task 2)", () => {
    personal.tracked.teams = [18360];
    const { container } = show(detail(MATCHES));
    const link = container.querySelector("[data-live-report]")!;
    expect(link.textContent).toMatch(/Know your match/);
    expect(link.getAttribute("href")).toBe("/events/2025/LIVE1/match/qual:0:15");
  });

  it("with no teams of mine, counts down to the event's next match and says how to get mine", () => {
    show(detail(MATCHES));
    expect(screen.getByText("Next match")).toBeTruthy();
    expect(screen.getAllByText("Q14").length).toBeGreaterThan(0);
    expect(screen.getByText(/your team/)).toBeTruthy();
  });

  it("without a start time, says what's up next without a timer", () => {
    personal.myTeam = 18360;
    show(detail(MATCHES.map((m) => ({ ...m, startsAt: null }))));
    expect(screen.getAllByText("Q15").length).toBeGreaterThan(0);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText("No start time published for this match.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Q15 is up next/ })).toBeTruthy();
  });

  it("moves on when new data says the match was played", () => {
    personal.tracked.teams = [18360, 555];
    const { rerender } = show(detail(MATCHES));
    expect(screen.getByRole("timer").textContent).toBe("in12:00");
    const played = MATCHES.map((m) => (m.number === 15 ? { ...m, played: true } : m));
    rerender(<MemoryRouter><TooltipProvider><Panel d={detail(played)} /></TooltipProvider></MemoryRouter>);
    expect(screen.getAllByText("Q16").length).toBeGreaterThan(0);
    expect(screen.getByRole("timer").textContent).toBe("in22:00");
  });

  it("says when my teams are done", () => {
    personal.tracked.teams = [1];
    show(detail(MATCHES));
    expect(screen.getByText("Your teams are done for now")).toBeTruthy();
    expect(screen.getByText(/No more scheduled matches for 1, so this is the event's next match/)).toBeTruthy();
  });

  it("leaves no timer running once it's gone (the event ended)", () => {
    personal.tracked.teams = [18360];
    const { unmount } = show(detail(MATCHES));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a new score", () => {
  it("flashes when it arrives, not when the row first shows", () => {
    const m = match(15, [18360, 9], [10, 11]);
    const row = (x: MatchView) => <MemoryRouter><TooltipProvider><MatchRow m={x} /></TooltipProvider></MemoryRouter>;
    const { rerender, container } = render(row(m));
    expect(container.querySelector(".cs-score-flash")).toBeNull();
    const score = (total: number) => ({ total, np: total, auto: 0, teleop: 0, endgame: 0, pen: 0 });
    rerender(row({ ...m, played: true, red: { ...m.red, score: score(130) }, blue: { ...m.blue, score: score(98) } }));
    expect(container.querySelectorAll(".cs-score-flash").length).toBe(2);
    const fresh = render(row({ ...m, played: true, red: { ...m.red, score: score(130) }, blue: { ...m.blue, score: score(98) } }));
    expect(fresh.container.querySelector(".cs-score-flash")).toBeNull();
  });
});

describe("the panel's actions (watch, track) beside Know your match", () => {
  const STREAM = "https://www.youtube.com/watch?v=live123";
  const withEvent = (o: Partial<EventDetail["event"]>): EventDetail => { const d = detail(MATCHES); return { ...d, event: { ...d.event, ...o } }; };
  // The event page's header as it composes it: the LIVE panel while live, then the action row under the date line.
  function Header({ d, live }: { d: EventDetail; live: boolean }) {
    const [on, setOn] = useState(false);
    const track = { on, toggle: () => setOn((x) => !x) };
    const target = useLiveTarget(d, live);
    return <>
      {live && <LivePanel d={d} target={target} refresh={refresh} track={track} />}
      <HeaderActions liveMode={live} livestream={d.event.livestream} track={track}><button type="button">Open in what-if lab</button></HeaderActions>
    </>;
  }
  const header = (d: EventDetail, live = true) => render(<MemoryRouter><TooltipProvider><Header d={d} live={live} /></TooltipProvider></MemoryRouter>);
  const panel = () => document.querySelector<HTMLElement>("[data-live-panel]");
  const below = () => document.querySelector<HTMLElement>("[data-header-actions]")!;

  it("shows Watch livestream inside the panel, next to Know your match, opening the stream in a new tab", () => {
    header(withEvent({ livestream: STREAM }));
    const link = within(panel()!).getByRole("link", { name: /Watch livestream/ });
    expect(link.getAttribute("href")).toBe(STREAM);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.closest("[data-live-actions]")?.querySelector("[data-live-report]")).toBeTruthy();
  });

  it("has no Watch livestream without a stream URL", () => {
    header(withEvent({ livestream: null }));
    expect(screen.queryByRole("link", { name: /livestream/i })).toBeNull();
    expect(within(panel()!).getByRole("button", { name: "Track event" })).toBeTruthy();
  });

  it("keeps watch and track once every match is played (Know your match goes)", () => {
    const d = withEvent({ livestream: STREAM });
    header({ ...d, matches: d.matches.map((m) => ({ ...m, played: true })) });
    expect(screen.getByText(/Every scheduled match has a result/)).toBeTruthy();
    expect(document.querySelector("[data-live-report]")).toBeNull();
    expect(within(panel()!).getByRole("link", { name: /Watch livestream/ }).getAttribute("href")).toBe(STREAM);
    fireEvent.click(within(panel()!).getByRole("button", { name: "Track event" }));
    expect(within(panel()!).getByRole("button", { name: "Tracking" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("tracks and untracks the event from inside the panel", () => {
    header(detail(MATCHES));
    const btn = within(panel()!).getByRole("button", { name: "Track event" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    const on = within(panel()!).getByRole("button", { name: "Tracking" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(on);
    expect(within(panel()!).getByRole("button", { name: "Track event" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("while live, shows watch and track once (in the panel) and keeps the what-if lab below", () => {
    header(withEvent({ livestream: STREAM }));
    expect(screen.getAllByRole("link", { name: /livestream/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Track/ })).toHaveLength(1);
    expect(within(below()).queryByRole("link", { name: /livestream/i })).toBeNull();
    expect(within(below()).queryByRole("button", { name: /^Track/ })).toBeNull();
    expect(within(below()).getByRole("button", { name: "Open in what-if lab" })).toBeTruthy();
  });

  it("when not live, the header shows both, the stream as a button", () => {
    header(withEvent({ status: "finished", livestream: STREAM }), false);
    expect(panel()).toBeNull();
    const link = within(below()).getByRole("link", { name: /Watch livestream/ });
    expect(link.getAttribute("href")).toBe(STREAM);
    expect(link.getAttribute("data-slot")).toBe("button");
    fireEvent.click(within(below()).getByRole("button", { name: "Track event" }));
    expect(within(below()).getByRole("button", { name: "Tracking this event" }).getAttribute("aria-pressed")).toBe("true");
  });
});
