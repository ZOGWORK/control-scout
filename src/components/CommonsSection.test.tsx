// @vitest-environment jsdom
// The scouting commons on the team page: signed out, nothing is asked or shown; signed in, other workspaces' pit
// entries show credited to the workspace, each with its age said prominently (before the event: stale; over a
// day: aging), under a labelled layer; nothing shows when nothing is shared. And pitAge's rules on their own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import type { CommonsAnswer, CommonsEntry } from "../shared/commons";
import { emptyConsensus } from "../shared/consensus";

const h = vi.hoisted(() => ({ user: null as AccountUser | null }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: { myTeam: null }, syncReady: false }) }));

const { CommonsSection } = await import("./CommonsSection");
const { pitAge } = await import("../lib/commons");

const HOUR = 36e5;
const NOW = new Date("2025-11-08T15:00:00").getTime();
const user: AccountUser = { id: 7, email: "ada@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: false } as AccountUser;
const entry = (over: Partial<CommonsEntry>): CommonsEntry => ({
  id: "1:a", source: { id: 1, name: "Robo Owls" }, season: 2025, eventCode: "USCMQ1", team: 18360,
  data: { drivetrain: "Mecanum", weight: 38 }, notes: "Claw rebuilt Saturday", fields: [
    { id: "drivetrain", label: "Drivetrain", type: "choice", phase: "pit", options: ["Mecanum", "Tank"] },
    { id: "weight", label: "Robot weight (lb)", type: "counter", phase: "pit", max: 60 },
  ], scoutedAt: NOW - 2 * HOUR, publishedAt: NOW - HOUR, photos: [], ...over,
});
const answer = (entries: CommonsEntry[]): CommonsAnswer => ({
  season: 2025, team: 18360, events: [{ code: "USCMQ1", name: "Commons Qualifier", start: "2025-11-08", end: "2025-11-08" }], entries,
  layer: { ...emptyConsensus(18360), entries: entries.length, pitEntries: entries.length, scouts: entries.length, counters: [{ kind: "pit", id: "weight", label: "Robot weight (lb)", type: "counter", avg: 38, n: 1 }], tags: [{ label: "Drivetrain: Mecanum", count: 1 }] },
  ownHidden: 1,
});

let asked: string[] = [];
let body: CommonsAnswer = answer([]);
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  asked = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { asked.push(String(url)); return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); h.user = null; });

const show = () => render(<MemoryRouter><CommonsSection team={18360} season={2025} /></MemoryRouter>);

describe("CommonsSection", () => {
  it("signed out: asks nothing, shows nothing", async () => {
    show();
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual([]);
    expect(screen.queryByTestId("commons")).toBeNull();
  });

  it("nothing shared: nothing shown", async () => {
    h.user = user;
    show();
    await waitFor(() => expect(asked.some((u) => u.includes("/api/scout/commons?season=2025&team=18360"))).toBe(true));
    expect(screen.queryByTestId("commons")).toBeNull();
  });

  it("shows other workspaces' entries credited to the workspace, the layer, and each claim's age", async () => {
    h.user = user;
    body = answer([entry({ scoutedAt: Date.now() - 2 * HOUR })]);
    show();
    const block = await screen.findByTestId("commons");
    expect(screen.getByText("Scouting commons")).toBeTruthy();
    expect(screen.getByText(/your workspace's share is left out here/)).toBeTruthy();
    const card = within(block).getByTestId("commons-entry");
    expect(within(card).getByText("Robo Owls")).toBeTruthy();
    expect(within(card).getByText("Claw rebuilt Saturday")).toBeTruthy();
    expect(within(card).getByText("Mecanum")).toBeTruthy();
    expect(within(card).getByTestId("pit-age").textContent).toMatch(/^Scouted /);
    expect(within(block).getByText("Drivetrain: Mecanum")).toBeTruthy();
  });
});

describe("pitAge", () => {
  const ev = { start: "2025-11-08" };
  it("fresh within a day of the event, with hours", () => {
    expect(pitAge(NOW - 3 * HOUR, ev, NOW)).toMatchObject({ tone: "fresh", note: "3h ago" });
    expect(pitAge(NOW - 10 * 60_000, ev, NOW)).toMatchObject({ tone: "fresh", note: "Within the hour" });
  });
  it("before the event started: stale, whatever the hours", () => {
    expect(pitAge(new Date("2025-11-07T20:00:00").getTime(), ev, NOW)).toMatchObject({ tone: "stale", note: "Before this event: the robot may have changed" });
  });
  it("a day old: aging; two or more: stale", () => {
    expect(pitAge(NOW - 30 * HOUR, undefined, NOW)).toMatchObject({ tone: "aging", note: "A day old: check it still holds" });
    expect(pitAge(NOW - 50 * HOUR, undefined, NOW)).toMatchObject({ tone: "stale", note: "2 days old: check it still holds" });
  });
  it("names the weekday", () => {
    expect(pitAge(NOW - HOUR, ev, NOW).when).toMatch(/Sat/);
  });
});
