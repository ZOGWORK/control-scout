// @vitest-environment jsdom
// Scout in v8 (docs/design/v8-revamp-brief.md §7.7, <html data-v8>): Event day opens on the next thing to scout
// (the next match as a big label with the one primary button, then the next pit team), the watch strip folds
// behind Change, the event bar is a quiet line with Stop scouting in More, the match chips and the save bar's
// controls carry the v8 look (no green, orange or slate-blue fill behind words), and the forms are 48px.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ScoutEvent } from "../lib/scoutEvent";
import type { ScoutSession } from "../lib/scoutSession";
import type { ScheduleMatch } from "../shared/scoutMatch";
import { EventDay } from "../components/scout/eventday/EventDay";
import { EventBar } from "../components/scout/eventday/EventBar";
import { watchingWords } from "../components/scout/eventday/NextUp";
import { MatchHeader } from "../components/scout/redesign/MatchHeader";
import { BigFieldInput } from "../components/scout/redesign/BigFieldInput";

const own = (c: string) => c.split(/\s+/).filter((t) => t && !t.startsWith("v8:") && !t.includes(":v8:"));

const m = (n: number, played = false): ScheduleMatch => ({
  key: `q${n}`, label: `Q${n}`, level: "qual", time: `2025-11-08T10:${String(n).padStart(2, "0")}:00`, startsAt: null, played,
  red: [1111, 2222], blue: [3333, 4444],
});
const schedule = (matches: ScheduleMatch[], status: ScoutEvent["schedule"]["status"] = "ready") =>
  ({ status, matches, eventName: "Brisbane Qualifier 2", fromDevice: false, reload: async () => {} }) as unknown as ScoutEvent["schedule"];
const event = (over: Partial<ScoutEvent> = {}): ScoutEvent => ({
  code: "AUBRQ2", info: null, rows: new Map(), teamsFrom: "event",
  teams: [{ team: 1111, name: "Alpha Robotics" }, { team: 2222, name: "Bravo" }, { team: 3333, name: null }, { team: 4444, name: null }],
  schedule: schedule([m(1), m(2), m(3)]), ...over,
});
const session: ScoutSession = { season: 2025, eventCode: "AUBRQ2", watching: { kind: "slot", slot: "red1" }, setAt: 0 };
// Q1 is scouted for red 1 (1111), so Q2 is next.
const entries = [{ uuid: "a", kind: "match", team: 1111, eventCode: "AUBRQ2", matchLabel: "Q1", season: 2025, deleted: false }] as never[];

const day = (over: Partial<Parameters<typeof EventDay>[0]> = {}) => {
  const onMatch = vi.fn(), onPit = vi.fn(), onWatching = vi.fn();
  render(<MemoryRouter><EventDay event={event()} session={session} entries={entries} readOnly={false} onWatching={onWatching} onMatch={onMatch}
    onManualMatch={() => {}} onPit={onPit} ourTeams={[]} {...over} /></MemoryRouter>);
  return { onMatch, onPit, onWatching };
};

afterEach(() => cleanup());

describe("Event day in v8", () => {
  it("opens on the next match with the one primary button, and the next pit team", () => {
    const { onMatch, onPit } = day();
    const next = screen.getByRole("region", { name: "Next to scout" });
    expect(within(next).getByText("Q2").hasAttribute("data-next-label")).toBe(true);
    expect(within(next).getByText("Watching Red 1")).toBeTruthy();
    fireEvent.click(within(next).getByRole("button", { name: /Scout Q2/ }));
    expect(onMatch).toHaveBeenCalledWith("Q2");
    fireEvent.click(within(next).getByRole("button", { name: /Scout pit/ }));
    expect(onPit).toHaveBeenCalledWith(1111);
    // One primary (white on white/10) on the screen: the queues' buttons are outline or ghost.
    const primaries = screen.getAllByRole("button").filter((b) => b.className.includes("v8:bg-ink/10") && b.className.includes("v8:ring-ink/[0.12]"));
    expect(primaries.map((b) => b.textContent)).toEqual(["Scout Q2 "]);
    // The old strip and tiles aren't drawn; progress is a quiet line of three counts.
    expect(screen.queryByText("What are you watching?")).toBeNull();
    expect(screen.queryByText("Entries today")).toBeNull();
    expect(within(screen.getByLabelText("Your progress here")).getByText("Matches")).toBeTruthy();
  });

  it("folds the watch strip behind Change", () => {
    const { onWatching } = day();
    const change = screen.getByRole("button", { name: "Change" });
    expect(change.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(change);
    expect(screen.getByText("What are you watching?").className).toContain("v8:normal-case");
    fireEvent.click(screen.getByRole("radio", { name: "All 4 teams" }));
    expect(onWatching).toHaveBeenCalledWith({ kind: "all" });
  });

  it("says when there's no schedule, with Type a match in as the action", () => {
    day({ event: event({ schedule: schedule([], "none") }) });
    const next = screen.getByRole("region", { name: "Next to scout" });
    expect(within(next).getByText("No schedule yet")).toBeTruthy();
    expect(within(next).getByRole("button", { name: /Type a match in/ })).toBeTruthy();
  });

  it("read-only: nothing to press", () => {
    day({ readOnly: true });
    const next = screen.getByRole("region", { name: "Next to scout" });
    expect(within(next).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("the event bar in v8", () => {
  it("is a quiet line: Change event beside it, Stop scouting in More", () => {
    const onStop = vi.fn();
    render(<EventBar event={event()} onChange={() => {}} onStop={onStop} />);
    const bar = screen.getByRole("region", { name: "Event you're scouting" });
    expect(bar.dataset.eventBar).toBe("v8");
    expect(within(bar).getByRole("button", { name: "Change event" })).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: /Stop scouting/ })).toBeNull();
    expect(within(bar).getByRole("button", { name: "More event options" })).toBeTruthy();
  });
});

describe("the match screen in v8", () => {
  it("marks the open match with the slate-blue line on white, never a coloured fill; the classic classes stay", () => {
    render(<MatchHeader schedule={[m(1), m(2)]} index={1} watching={session.watching} nextIndex={1} progress={(i) => (i === 0 ? "done" : "todo")} onIndex={() => {}} />);
    const cur = screen.getByRole("button", { name: /Q2, current/ });
    expect(cur.className).toContain("v8:bg-ink/10");
    expect(cur.className).toContain("v8:ring-accent/70");
    expect(own(cur.className)).toContain("bg-accent/15");
    const done = screen.getByRole("button", { name: /Q1, done/ });
    expect(done.className).toContain("v8:text-emerald-400"); // a scouted match keeps its green (done)
  });
  it("gives the form's controls 48px and the 0.97 press", () => {
    render(<BigFieldInput f={{ id: "c", label: "Samples", type: "choice", options: ["Low", "High"] } as never} value={undefined} onChange={() => {}} />);
    const low = screen.getByRole("radio", { name: "Low" });
    expect(low.className).toContain("v8:min-h-12");
    expect(low.className).toContain("v8:active:scale-[0.97]");
  });
});

describe("watchingWords", () => {
  it("names what's watched", () => {
    expect(watchingWords({ kind: "all" })).toBe("All 4 teams");
    expect(watchingWords({ kind: "alliance", side: "blue" })).toBe("Blue alliance");
    expect(watchingWords({ kind: "slot", slot: "blue2" })).toBe("Blue 2");
  });
});

// ---------------------------------------------------------------------------
// The page's match flow, in the one look: a match opened from Event day is scouted for every team watched with one
// Save (one entry each), which moves on to the next match; a pit team in the queue opens its pit form.
// ---------------------------------------------------------------------------
const teamView = (number: number) => ({ number, surrogate: false, dq: false, onField: true });
const matchView = (n: number, red: number[], blue: number[]) => ({
  season: 2025, code: "USNJQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: `2025-11-08T10:${String(n).padStart(2, "0")}:00`, startsAt: null, played: false,
  red: { teams: red.map(teamView), score: null }, blue: { teams: blue.map(teamView), score: null }, video: null, prediction: null,
});
const fieldRow = (t: number, name: string) => ({ team: t, name, city: null, state: null, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null, opr: { np: null, auto: null, teleop: null, endgame: null, pen: null } });
const scoutDetail = {
  event: { name: "NJ Qualifier 1", code: "USNJQ1", start: "2025-11-08", end: "2025-11-08", city: "Newark", state: "NJ", teams: 3, matchesTotal: 2 },
  matches: [matchView(1, [101, 102], [201, 202]), matchView(2, [103, 104], [203, 204])],
  field: [fieldRow(101, "Gear Grinders"), fieldRow(102, "Bad Wolf"), fieldRow(201, "Volt Vipers")],
  alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null,
};

let scoutWhere = "";
function ScoutWhere() { const l = useLocation(); scoutWhere = l.search; return null; }
const scoutParam = (k: string) => new URLSearchParams(scoutWhere).get(k);

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {}, bookmarks: [], myTeam: null, tracked: { teams: [], events: [] } }, update: () => true }) }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));
// The picker's season menu, as one button (the real one is a Radix select): picks the next season.
vi.mock("../components/records/Controls", async (orig) => ({
  ...(await orig<typeof import("../components/records/Controls")>()),
  SeasonSelect: ({ value, onChange }: { value: number; onChange: (s: number) => void }) => <button type="button" onClick={() => onChange(value + 1)}>Next season</button>,
}));
const { default: ScoutPage } = await import("./ScoutPage");
const { localScoutEntries } = await import("../lib/scouting");
const { writeScoutSession } = await import("../lib/scoutSession");
const watchRed = () => writeScoutSession(null, { season: 2025, eventCode: "USNJQ1", watching: { kind: "alliance", side: "red" } });

beforeEach(() => {
  document.documentElement.setAttribute("data-v8", "");
  localStorage.clear(); sessionStorage.clear(); scoutWhere = "";
  vi.stubGlobal("fetch", async (input: string) => {
    const url = String(input);
    if (url.includes("/api/events/2025/USNJQ1")) return new Response(JSON.stringify(scoutDetail), { status: 200 });
    if (/\/api\/events(\?|$)/.test(url)) return new Response(JSON.stringify({ events: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const scoutPage = (url: string) => render(<MemoryRouter initialEntries={[url]}><ScoutPage /><ScoutWhere /></MemoryRouter>);

describe("the match flow in v8", () => {
  it("scouts a whole match for an alliance with one Save, then moves to the next match", async () => {
    watchRed();
    scoutPage("/scout?season=2025");
    fireEvent.click(await screen.findByRole("button", { name: /^Scout Q1/ }));
    await waitFor(() => expect(scoutParam("at")).toBe("Q1"));
    expect(await screen.findByRole("button", { name: /Save Q1/ })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent).join()).toMatch(/101.*102/);
    const addOne = () => screen.getAllByRole("button", { name: /Add one$/ })[0];
    fireEvent.click(addOne());
    fireEvent.click(screen.getAllByRole("tab").find((t) => t.textContent?.includes("102"))!);
    fireEvent.click(addOne());
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    await waitFor(() => expect(scoutParam("at")).toBe("Q2"));
    const saved = localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => [e.team, e.matchLabel, e.kind]).sort();
    expect(saved).toEqual([[101, "Q1", "match"], [102, "Q1", "match"]]);
    expect(await screen.findByRole("button", { name: /Save Q2/ })).toBeTruthy();
  });

  it("a team with nothing entered is asked about, and Skip saves only the other", async () => {
    watchRed();
    scoutPage("/scout?season=2025&at=Q1");
    fireEvent.click((await screen.findAllByRole("button", { name: /Add one$/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip 102" }));
    await waitFor(() => expect(scoutParam("at")).toBe("Q2"));
    expect(localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => e.team)).toEqual([101]);
  });

  it("a pit team in the queue opens a pit entry for it at this event", async () => {
    watchRed();
    scoutPage("/scout?season=2025");
    const pit = await screen.findByRole("region", { name: "Pit queue" });
    fireEvent.click(await within(pit).findByRole("button", { name: /^102 Bad Wolf, pit to do/ }));
    await waitFor(() => expect(scoutParam("pit")).toBe("102"));
    expect(await screen.findByRole("form", { name: "Pit entry" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Pit \d+ of \d+/ })).toBeTruthy();
  });
});
