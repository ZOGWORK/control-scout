// @vitest-environment jsdom
// The event page's source line names the source of the team list actually shown, never FIRST for a list FIRST
// doesn't publish, and says when a list on an event that isn't over hasn't been read for a while.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { EventDetail, FieldRow } from "../shared/api";
import { TeamsSource } from "./TeamsSource";

const NOW = Date.parse("2026-11-06T22:00:00Z");
const HOUR_AGO = new Date(NOW - 3600_000).toISOString();
const DAYS_AGO = new Date(NOW - 3 * 86400_000).toISOString();

const detail = (o: { source?: string; field?: number; status?: string; synced?: string | null; shared?: boolean; provisionalAt?: string; registered?: boolean }): EventDetail => ({
  event: { source: o.source ?? "first", status: o.status ?? "upcoming" },
  field: Array.from({ length: o.field ?? 0 }, (_, i) => ({ team: i + 1 }) as FieldRow),
  ...("synced" in o ? { teamsSyncedAt: o.synced } : {}),
  registered: o.registered ? { fetchedAt: HOUR_AGO } : null,
  sharedSessions: o.shared ? { fetchedAt: HOUR_AGO, other: { code: "X", name: "X" }, teams: [] } : null,
  provisional: o.provisionalAt ? { fetchedAt: o.provisionalAt } : null,
}) as unknown as EventDetail;

const line = (d: EventDetail, provisional = false) => {
  const { container } = render(<TeamsSource d={d} provisional={provisional} now={NOW} />);
  return container.textContent!;
};

describe("TeamsSource", () => {
  afterEach(cleanup);

  it("FIRST's list: FIRST, last synced", () => {
    expect(line(detail({ field: 13, synced: HOUR_AGO }))).toMatch(/^Source: FIRST Events API · last synced /);
    expect(line(detail({ field: 13, synced: HOUR_AGO }))).not.toMatch(/out of date/);
  });

  it("no list yet: says FIRST has published none, with when it was checked", () => {
    expect(line(detail({ synced: HOUR_AGO }))).toMatch(/^Source: FIRST Events API · no teams published yet · last checked /);
  });

  it("FTC New Jersey's list is labelled provisional, never FIRST", () => {
    const t = line(detail({ provisionalAt: HOUR_AGO }), true);
    expect(t).toMatch(/^Source: FTC New Jersey · provisional, FIRST has not published teams yet · read /);
    expect(t).not.toMatch(/FIRST Events API/);
  });

  it("FTC Scout's list when FIRST couldn't serve the event", () => {
    expect(line(detail({ source: "ftc-scout", field: 10, synced: HOUR_AGO }))).toMatch(/^Source: FTC Scout/);
    // FIRST's registrations shown on an event last fetched from FTC Scout are still FIRST's.
    expect(line(detail({ source: "ftc-scout", field: 10, synced: HOUR_AGO, registered: true }))).toMatch(/^Source: FIRST Events API · last synced/);
  });

  it("saved data or an older server (no time sent): the source alone, never 'not synced'", () => {
    const t = line(detail({ field: 13 }));
    expect(t).toBe("Source: FIRST Events API");
  });

  it("an old read on an event that isn't over is out of date; a finished event's isn't", () => {
    expect(line(detail({ field: 13, synced: DAYS_AGO }))).toMatch(/may be out of date/);
    expect(line(detail({ field: 13, synced: null }))).toMatch(/not synced yet · may be out of date/);
    expect(line(detail({ field: 13, synced: DAYS_AGO, status: "finished" }))).not.toMatch(/out of date/);
  });
});
