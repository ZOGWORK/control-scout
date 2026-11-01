// @vitest-environment jsdom
// The Scout page end to end: with no event picked the event picker is the page; once picked, Event day shows the
// event's match and pit queues, and a match opened from the queue is scouted for every team watched with one Save
// (one entry per team at that event and match), which moves on to the next match. Entries holds the list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { localScoutEntries, saveScoutEntry } from "../lib/scouting";
import { writeScoutSession } from "../lib/scoutSession";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { TooltipProvider } from "../components/ui/overlay";
import type { MatchView } from "../shared/api";

const h = vi.hoisted(() => ({ personal: { user: null, providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {}, bookmarks: [], myTeam: null } } }));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

const team = (number: number) => ({ number, surrogate: false, dq: false, onField: true });
const match = (n: number, red: number[], blue: number[]): MatchView => ({
  season: 2025, code: "USNJQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: `2025-11-08T10:${String(n).padStart(2, "0")}:00`, startsAt: null, played: false,
  red: { teams: red.map(team), score: null }, blue: { teams: blue.map(team), score: null }, video: null, prediction: null,
});
const fieldRow = (t: number, name: string) => ({ team: t, name, city: null, state: null, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null, opr: { np: null, auto: null, teleop: null, endgame: null, pen: null } });
const detail = { event: { name: "NJ Qualifier 1", code: "USNJQ1", start: "2025-11-08", end: "2025-11-08", city: "Newark", state: "NJ", teams: 3, matchesTotal: 2 }, matches: [match(1, [101, 102], [201, 202]), match(2, [103, 104], [203, 204])],
  field: [fieldRow(101, "Gear Grinders"), fieldRow(102, "Bad Wolf"), fieldRow(201, "Volt Vipers")], alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null };

let where = "";
function Where() { const l = useLocation(); where = l.search; return null; }
const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[url]}><ScoutPage /><Where /></MemoryRouter></TooltipProvider>);
const param = (k: string) => new URLSearchParams(where).get(k);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear(); sessionStorage.clear();
  resetFlags({ ...DEFAULT_FLAGS });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/events/2025/USNJQ1")) return new Response(JSON.stringify(detail), { status: 200 });
    if (url.includes("/api/events")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetFlags({ ...DEFAULT_FLAGS }); });

const red = () => writeScoutSession(null, { season: 2025, eventCode: "USNJQ1", watching: { kind: "alliance", side: "red" } });
const sectionNames = () => within(screen.getByRole("tablist", { name: "Scout sections" })).getAllByRole("tab").map((t) => t.textContent);

describe("Event day", () => {
  it("with no event picked, the picker is the page: no sections above it", async () => {
    show("/scout?season=2025");
    expect(await screen.findByText("Which event are you scouting?")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Scout sections" })).toBeNull();
  });

  it("once picked, the event is the header and Event day has both queues and the progress strip", async () => {
    red();
    show("/scout?season=2025");
    const bar = await screen.findByRole("region", { name: "Event you're scouting" });
    expect(await within(bar).findByText("NJ Qualifier 1")).toBeTruthy();
    expect(within(bar).getByText(/2 matches · 3 teams/)).toBeTruthy();
    expect(sectionNames()).toEqual(["Event day", "Entries"]);
    expect(await screen.findByRole("region", { name: "Match queue" })).toBeTruthy();
    const pit = screen.getByRole("region", { name: "Pit queue" });
    expect(within(pit).getByText("0 / 3")).toBeTruthy();
    expect(screen.getByText("Next match").parentElement?.textContent).toContain("Q1");
  });

  it("an entry being filled in keeps its answers through Change event and back", async () => {
    red();
    show("/scout?season=2025&tab=entries");
    fireEvent.click(await screen.findByRole("button", { name: /Type a match in/ }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Fast intake" } });
    fireEvent.click(screen.getByRole("button", { name: /Change event/ }));
    expect(await screen.findByText("Which event are you scouting?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to USNJQ1" }));
    await waitFor(() => expect(param("pick")).toBeNull());
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Fast intake");
  });

  it("a pit entry and an opened entry keep their answers when another section is opened and closed", async () => {
    red();
    saveScoutEntry({ uuid: "keepopen0001", season: 2025, team: 4242, eventCode: "USNJQ1", matchLabel: "Q9", kind: "match", data: {}, notes: "" });
    show("/scout?season=2025&tab=event&pit=102");
    fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Pit draft" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Entries" }));
    await waitFor(() => expect(param("tab")).toBe("entries"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Event day" }));
    await waitFor(() => expect(param("tab")).toBe("event"));
    expect((screen.getAllByLabelText("Notes") as HTMLTextAreaElement[]).map((n) => n.value)).toContain("Pit draft");
  });

  it("a typed-in match keeps its answers when another section is opened and closed", async () => {
    red();
    show("/scout?season=2025&tab=entries");
    fireEvent.click(await screen.findByRole("button", { name: /Type a match in/ }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Slow climb" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Event day" }));
    await waitFor(() => expect(param("tab")).toBe("event"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Entries" }));
    await waitFor(() => expect(param("tab")).toBe("entries"));
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Slow climb");
  });

  it("a team page's Scout this team with no event picked asks for the event, then opens that team's pit form there", async () => {
    show("/scout?season=2025&team=102&new=1");
    expect(await screen.findByText("Which event are you scouting?")).toBeTruthy();
    await waitFor(() => expect(param("pit")).toBe("102"));
    red();
    expect(await screen.findByRole("form", { name: "Pit entry" })).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Team: 102/ })).toBeTruthy();
  });

  it("Change event opens the picker over the event, with a way back", async () => {
    red();
    show("/scout?season=2025");
    fireEvent.click(await screen.findByRole("button", { name: /Change event/ }));
    await waitFor(() => expect(param("pick")).toBe("1"));
    expect(await screen.findByText("Which event are you scouting?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to USNJQ1" }));
    await waitFor(() => expect(param("pick")).toBeNull());
    expect(await screen.findByRole("region", { name: "Match queue" })).toBeTruthy();
  });

  it("what you watch changes from the strip, at once", async () => {
    red();
    show("/scout?season=2025");
    fireEvent.click(await screen.findByRole("radio", { name: "All 4 teams" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("cs-scout-session:personal")!).watching).toEqual({ kind: "all" }));
    fireEvent.click(screen.getByRole("radio", { name: "One alliance" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Blue/ }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("cs-scout-session:personal")!).watching).toEqual({ kind: "alliance", side: "blue" }));
  });

  it("scouts a whole match for an alliance with one Save, then moves to the next match", async () => {
    red();
    show("/scout?season=2025");
    fireEvent.click(await screen.findByRole("button", { name: /^Scout Q1/ }));
    await waitFor(() => expect(param("at")).toBe("Q1"));
    expect(await screen.findByRole("button", { name: /Save Q1/ })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent).join()).toMatch(/101.*102/);
    const addOne = () => screen.getAllByRole("button", { name: /Add one$/ })[0];
    fireEvent.click(addOne());
    fireEvent.click(screen.getAllByRole("tab").find((t) => t.textContent?.includes("102"))!);
    fireEvent.click(addOne());
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    await waitFor(() => expect(param("at")).toBe("Q2"));
    const saved = localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => [e.team, e.matchLabel, e.kind]).sort();
    expect(saved).toEqual([[101, "Q1", "match"], [102, "Q1", "match"]]);
    expect(await screen.findByRole("button", { name: /Save Q2/ })).toBeTruthy();
  });

  it("a team with nothing entered is asked about, and Skip saves only the other", async () => {
    red();
    show("/scout?season=2025&at=Q1");
    fireEvent.click((await screen.findAllByRole("button", { name: /Add one$/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip 102" }));
    await waitFor(() => expect(param("at")).toBe("Q2"));
    expect(localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => e.team)).toEqual([101]);
  });

  it("watching all 4 teams: quick rows, one Save for the four, and a team's full form on request", async () => {
    writeScoutSession(null, { season: 2025, eventCode: "USNJQ1", watching: { kind: "all" } });
    show("/scout?season=2025&at=Q1");
    for (const t of [101, 102, 201, 202]) fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${t} .*Add one$`) }));
    fireEvent.click(screen.getByRole("button", { name: "Full form for 201" }));
    expect(await screen.findByRole("tab", { name: /201/, selected: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to all 4 teams" }));
    expect(await screen.findByRole("button", { name: "Full form for 202" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save Q1/ }));
    await waitFor(() => expect(param("at")).toBe("Q2"));
    expect(localScoutEntries(null).filter((e) => e.eventCode === "USNJQ1").map((e) => e.team).sort()).toEqual([101, 102, 201, 202]);
  });

  it("the queue picks up after the last match done, and the strip counts it", async () => {
    red();
    for (const t of [101, 102]) saveScoutEntry({ uuid: `done-${t}`, season: 2025, team: t, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: {}, notes: "" });
    show("/scout?season=2025");
    expect(await screen.findByRole("button", { name: /^Scout Q2/ })).toBeTruthy();
    expect(screen.getByText("Matches scouted").parentElement?.textContent).toContain("1 / 2");
  });

  it("the open match stays put when entries arrive (another scout's, or a sync), and the timer with it", async () => {
    red();
    show("/scout?season=2025&at=Q1");
    expect(await screen.findByRole("button", { name: /Save Q1/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Match started/ }));
    act(() => { for (const t of [101, 102]) saveScoutEntry({ uuid: `other-${t}`, season: 2025, team: t, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match", data: {}, notes: "" }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByRole("button", { name: /Save Q1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Stop$/ })).toBeTruthy(); // still running
  });

  it("moving between matches never touches the entry list's match filter", async () => {
    red();
    show("/scout?season=2025&at=Q1&match=Q9");
    fireEvent.click(await screen.findByRole("button", { name: /^Next match/ }));
    await waitFor(() => expect(param("at")).toBe("Q2"));
    expect(param("match")).toBe("Q9");
  });

  it("back to Event day from a match", async () => {
    red();
    show("/scout?season=2025&at=Q1");
    fireEvent.click(await screen.findByRole("button", { name: /^Event day$/ }));
    await waitFor(() => expect(param("at")).toBeNull());
    expect(await screen.findByRole("region", { name: "Match queue" })).toBeTruthy();
  });

  it("old links: ?tab=match and ?tab=matches open Event day, a match named in them included", async () => {
    red();
    show("/scout?season=2025&tab=matches&list=1");
    await waitFor(() => expect(param("tab")).toBe("event"));
    expect(param("list")).toBeNull();
    expect(await screen.findByRole("region", { name: "Match queue" })).toBeTruthy();
    cleanup();
    show("/scout?season=2025&tab=match&at=Q2");
    await waitFor(() => expect(param("tab")).toBe("event"));
    expect(await screen.findByRole("button", { name: /Save Q2/ })).toBeTruthy();
  });

  it("a pit team in the queue opens a pit entry for it at this event", async () => {
    red();
    show("/scout?season=2025");
    const pit = await screen.findByRole("region", { name: "Pit queue" });
    fireEvent.click(await within(pit).findByRole("button", { name: /^102 Bad Wolf, pit to do/ }));
    // The pit form for that team, at this event, with the queue's place in it ("Pit X of Y").
    await waitFor(() => expect(param("pit")).toBe("102"));
    expect(await screen.findByRole("form", { name: "Pit entry" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Pit \d+ of \d+/ })).toBeTruthy();
  });

  it("an old ?tab=data link opens Entries, which still has the list", async () => {
    saveScoutEntry({ uuid: "old-entry", season: 2025, team: 4242, eventCode: "USNJQ1", matchLabel: "Q9", kind: "match", data: {}, notes: "" });
    show("/scout?season=2025&tab=data");
    await waitFor(() => expect(param("tab")).toBe("entries"));
    expect(await screen.findByText("4242")).toBeTruthy();
  });
});
