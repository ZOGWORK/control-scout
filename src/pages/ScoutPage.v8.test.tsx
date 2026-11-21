// @vitest-environment jsdom
// Scout in v8 (docs/design/v8-revamp-brief.md §7.7, <html data-v8>): Event day opens on the next thing to scout
// (the next match as a big label with the one primary button, then the next pit team), the watch strip folds
// behind Change, the event bar is a quiet line with Stop scouting in More, the match chips and the save bar's
// controls carry the v8 look (no green, orange or slate-blue fill behind words), and the forms are 48px.
// With v8 off, each piece draws as before.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ScoutEvent } from "../lib/scoutEvent";
import type { ScoutSession } from "../lib/scoutSession";
import type { ScheduleMatch } from "../shared/scoutMatch";
import { EventDay } from "../components/scout/eventday/EventDay";
import { EventBar } from "../components/scout/eventday/EventBar";
import { watchingWords } from "../components/scout/eventday/NextUp";
import { MatchHeader } from "../components/scout/redesign/MatchHeader";
import { BigFieldInput } from "../components/scout/redesign/BigFieldInput";

const v8 = (on: boolean) => { if (on) document.documentElement.setAttribute("data-v8", ""); else document.documentElement.removeAttribute("data-v8"); };
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

beforeEach(() => v8(true));
afterEach(() => { cleanup(); v8(false); });

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
    const primaries = screen.getAllByRole("button").filter((b) => b.className.includes("v8:bg-white/10") && b.className.includes("v8:ring-white/[0.12]"));
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

  it("classic look: the strip, the four tiles and no Next up card", () => {
    v8(false);
    day();
    expect(screen.queryByRole("region", { name: "Next to scout" })).toBeNull();
    expect(screen.getByText("What are you watching?")).toBeTruthy();
    expect(screen.getByText("Entries today")).toBeTruthy();
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
  it("classic look: the tinted box with both buttons", () => {
    v8(false);
    render(<EventBar event={event()} onChange={() => {}} onStop={() => {}} />);
    const bar = screen.getByRole("region", { name: "Event you're scouting" });
    expect(bar.dataset.eventBar).toBeUndefined();
    expect(within(bar).getByRole("button", { name: /Stop scouting/ })).toBeTruthy();
  });
});

describe("the match screen in v8", () => {
  it("marks the open match with the slate-blue line on white, never a coloured fill; the classic classes stay", () => {
    render(<MatchHeader schedule={[m(1), m(2)]} index={1} watching={session.watching} nextIndex={1} progress={(i) => (i === 0 ? "done" : "todo")} onIndex={() => {}} />);
    const cur = screen.getByRole("button", { name: /Q2, current/ });
    expect(cur.className).toContain("v8:bg-white/10");
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
