// Issue #2202: a finished league meet's first screen said "No awards published yet. They appear after the closing
// ceremony." and "No playoff result on record", which reads as broken: league meets never give awards or play
// playoffs. It now says so plainly in one card; an event that does give awards keeps the "not published yet" words.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { FinishedFocus, noAwardsNote } from "./EventFocus";
import type { EventDetail } from "../shared/api";

const detail = (type: string, awards: EventDetail["awards"] = []) => ({
  event: { season: 2025, code: "USTXCECAM1", name: "CTX CARL League Meet 1", type, typeLabel: type, status: "finished", remote: false, start: "2026-11-22", end: "2026-11-22" },
  field: [], matches: [], alliances: [], awards, advancement: null, forecastUnsupported: null, live: null,
}) as unknown as EventDetail;

const render = (d: EventDetail) => renderToStaticMarkup(
  <MemoryRouter><FinishedFocus d={d} mine={new Set()} nameOf={(t) => `Team ${t}`} onAll={() => {}} /></MemoryRouter>,
);

describe("awards on a finished event's first screen (#2202)", () => {
  it("a league meet says it has no awards or winning alliance, never 'not published yet'", () => {
    const html = render(detail("LeagueMeet"));
    expect(html).toContain("data-no-awards");
    expect(html).toContain("League meets play qualification matches only");
    expect(html).not.toContain("No awards published yet");
    expect(html).not.toContain("No playoff result on record");
  });

  it("an event that gives awards still waits for them, with its Winners card", () => {
    const html = render(detail("Qualifier"));
    expect(html).toContain("No awards published yet");
    expect(html).toContain("No playoff result on record");
    expect(html).not.toContain("data-no-awards");
  });

  it("awards on record are always listed, whatever the type says", () => {
    const html = render(detail("LeagueMeet", [{ type: "Inspire", placement: 1, team: 30838, name: "Inspire Award" }]));
    expect(html).toContain("data-focus-awards");
    expect(html).not.toContain("data-no-awards");
  });

  it("only types that never have awards get the note", () => {
    expect(noAwardsNote("LeagueMeet")?.title).toBe("No awards at a league meet");
    for (const t of ["LeagueTournament", "Qualifier", "Scrimmage", "toString", null, undefined]) expect(noAwardsNote(t)).toBeNull();
  });
});
