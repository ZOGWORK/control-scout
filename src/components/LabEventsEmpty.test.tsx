// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LabEventsEmpty } from "./LabEventsEmpty";

afterEach(() => cleanup());

const base = { teamCount: 0, teamEvents: 0, season: 2026, q: "", otherMatches: 0, otherSeason: null, onShowAll: () => {}, onSeason: () => {}, onClearSearch: () => {} };

describe("LabEventsEmpty", () => {
  it("a team registered nowhere: says so, and offers every event and its last season", () => {
    const onShowAll = vi.fn(), onSeason = vi.fn();
    render(<LabEventsEmpty {...base} team={4215} otherSeason={2025} onShowAll={onShowAll} onSeason={onSeason} />);
    expect(screen.getByText("4215 isn't registered for any 2026–27 event yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search all events" }));
    expect(onShowAll).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Try 2025–26" }));
    expect(onSeason).toHaveBeenCalledWith(2025);
  });

  it("a team with only league meets or scrimmages is told none of them advance", () => {
    render(<LabEventsEmpty {...base} team={4215} teamEvents={3} />);
    expect(screen.getByText("4215 has no 2026–27 qualifier, league tournament or championship yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try/ })).toBeNull();
  });

  it("a search that misses the team's events offers every event and clearing the search", () => {
    const onClearSearch = vi.fn();
    render(<LabEventsEmpty {...base} team={4215} teamCount={2} q="athens" onClearSearch={onClearSearch} />);
    expect(screen.getByText(`None of 4215's 2026–27 events match "athens"`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search all events" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClearSearch).toHaveBeenCalledOnce();
  });

  it("no team: a missed search explains the scrimmages and league meets it skipped", () => {
    render(<LabEventsEmpty {...base} team={null} teamCount={null} q="oradell" otherMatches={2} />);
    expect(screen.getByText(`No qualifier, league tournament or championship matches "oradell"`)).toBeTruthy();
    expect(screen.getByText(/2 scrimmages or league meets match/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search all events" })).toBeNull();
  });
});
