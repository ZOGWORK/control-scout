// The data status (E5): healthy says so in a few words with no retry; a mismatch or
// a season still being prepared explains itself in plain language and offers a
// retry; a full timestamp always carries its time zone.
import { describe, expect, it } from "vitest";
import { fullTime, readinessView } from "./readiness";

const at = { resultsAt: "2026-10-17T12:00:00Z", statsAt: "2026-10-17T12:05:00Z" };

describe("readinessView", () => {
  it("keeps a healthy season to one quiet line", () => {
    expect(readinessView({ state: "ready", ...at })).toEqual({ tone: "ok", label: "Statistics up to date", detail: null, retry: false });
  });
  it("tells a temporary mismatch from a season not prepared at all", () => {
    const behind = readinessView({ state: "catching-up", ...at });
    const preparing = readinessView({ state: "preparing", ...at, statsAt: null });
    expect(behind).toMatchObject({ tone: "wait", label: "Statistics catching up", retry: true });
    expect(preparing).toMatchObject({ tone: "wait", label: "Statistics being prepared", retry: true });
    expect(behind.detail).not.toBe(preparing.detail);
    for (const v of [behind, preparing]) expect(v.detail).not.toMatch(/team_season_records|kv|job|cron/i);
  });
  it("makes no claim when the status is missing", () => {
    expect(readinessView(undefined)).toMatchObject({ tone: "wait", retry: true });
  });
});

describe("fullTime", () => {
  it("includes the time zone", () => {
    expect(fullTime("2026-10-17T12:00:00Z", "en-US", "UTC")).toBe("Oct 17, 2026, 12:00 PM UTC");
    expect(fullTime("2026-10-17T12:00:00Z", "en-US", "America/New_York")).toBe("Oct 17, 2026, 8:00 AM EDT");
  });
  it("passes an unreadable value through", () => {
    expect(fullTime("not a time")).toBe("not a time");
  });
});
