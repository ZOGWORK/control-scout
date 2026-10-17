// @vitest-environment jsdom
// The "At a glance" card as rendered: which stats show for each kind of event, that the ones that don't
// apply are left out (no "—" filler), and the links (team pages, match reports, live panel, tabs).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import { finished, live, remote, upcoming } from "../lib/eventGlance.fixtures";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
const { EventGlance } = await import("./EventGlance");

afterEach(cleanup);
const show = (d: EventDetail, onLive?: () => void) => {
  const onTab = vi.fn();
  const r = render(<MemoryRouter><EventGlance d={d} onTab={onTab} onLive={onLive} /></MemoryRouter>);
  return { ...r, onTab };
};
const cell = (id: string) => document.querySelector(`[data-glance="${id}"]`) as HTMLElement | null;
const shown = () => [...document.querySelectorAll("[data-glance]")].map((x) => x.getAttribute("data-glance"));

describe("EventGlance", () => {
  it("finished: how it ended, scoring, leaders; no live or pre-event stats", () => {
    show(finished());
    expect(cell("phase")!.textContent).toBe("Ended Mar 15, 2026");
    expect(shown()).toEqual(["phase", "progress", "won", "inspire", "seed", "top-opr", "avg-score", "avg-margin", "high", "closest", "penalties", "upsets", "top-auto", "top-teleop", "top-endgame", "advancing"]);
    expect(cell("won")!.textContent).toBe("Won byAlliance 1 1 · 3");
    expect(cell("closest")!.textContent).toContain("Q2 tie");
    expect(cell("upsets")!.textContent).toContain("Every favourite won");
    expect(screen.queryByText("—")).toBeNull();
    // Finished: no odds button.
    expect(screen.queryByRole("button", { name: /see the odds/i })).toBeNull();
  });

  it("links: team numbers to team pages, high score and closest to match reports", () => {
    show(finished());
    const high = cell("high")!;
    expect(within(high).getByRole("link", { name: /200/ }).getAttribute("href")).toBe("/events/2025/TEST/match/playoff:1:1");
    expect(within(high).getByRole("link", { name: "1" }).getAttribute("href")).toBe("/teams/1?season=2025");
    expect(within(high).getByRole("link", { name: "3" }).getAttribute("href")).toBe("/teams/3?season=2025");
    expect(within(cell("closest")!).getByRole("link").getAttribute("href")).toBe("/events/2025/TEST/match/qual:0:2");
    expect(within(cell("inspire")!).getByRole("link", { name: "2" }).getAttribute("href")).toBe("/teams/2?season=2025");
    expect(within(cell("top-teleop")!).getByRole("link", { name: "1" }).getAttribute("href")).toBe("/teams/1?season=2025");
    for (const a of document.querySelectorAll("a")) expect(a.getAttribute("href")).toMatch(/^\/(teams|events)\//);
  });

  it("live: next match opens the live panel; both kinds of call shown apart; upset links to its report", () => {
    const onLive = vi.fn();
    show(live(), onLive);
    expect(cell("phase")!.textContent).toBe("Qualification");
    expect(cell("progress")!.textContent).toContain("3 / 5 matches played");
    fireEvent.click(within(cell("next")!).getByRole("button"));
    expect(onLive).toHaveBeenCalledOnce();
    expect(screen.getByText(/calls made before the match/)).toBeTruthy();
    expect(screen.getByText(/predicted from earlier data/)).toBeTruthy();
    expect(cell("upsets")!.textContent).toContain("Upsets (live calls)1 of 2");
    expect(within(cell("upsets")!).getByRole("link", { name: "Q2" }).getAttribute("href")).toBe("/events/2025/TEST/match/qual:0:2");
    expect(cell("won")).toBeNull();
    expect(cell("strongest")).toBeNull();
  });

  it("live without the live panel: next match links into the matches tab", () => {
    show(live());
    expect(within(cell("next")!).getByRole("link").getAttribute("href")).toBe("/?tab=matches&match=qual%3A0%3A4");
  });

  it("upcoming: the field instead of empty space, plus the odds", () => {
    const { onTab } = show(upcoming());
    expect(shown()).toEqual(["phase", "progress", "strongest", "avg-season-opr"]);
    expect(cell("progress")!.textContent).toContain("No schedule yet");
    expect(cell("progress")!.textContent).toContain("5 teams");
    expect(within(cell("strongest")!).getAllByRole("link").map((a) => a.textContent)).toEqual(["200", "300", "100"]);
    fireEvent.click(screen.getByRole("button", { name: /see the odds/i }));
    expect(onTab).toHaveBeenCalledWith("odds");
  });

  it("upcoming where the forecast isn't supported: the button opens match predictions", () => {
    show({ ...upcoming(), forecastUnsupported: "No advancement here." });
    expect(screen.getByRole("button", { name: /see the match predictions/i })).toBeTruthy();
  });

  it("remote: per-team scores only", () => {
    show(remote());
    expect(shown()).toEqual(["phase", "progress", "avg-score", "high"]);
    expect(cell("high")!.textContent).toContain("85 in Q2");
    expect(cell("high")!.textContent).not.toContain("red");
  });
});
