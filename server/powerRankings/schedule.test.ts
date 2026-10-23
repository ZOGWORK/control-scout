// When automatic power rankings go out: Friday 00:00 America/New_York, through daylight saving time.
import { describe, expect, it } from "vitest";
import { dueRefresh, dueSlot, isCurrentWeek, latestSlot, localDate, localMidnight, nextRefresh, nextSlot, refreshSlotFor, slotFor } from "./schedule";

const at = (iso: string) => Date.parse(iso);

describe("Friday 00:00 New York time", () => {
  it("is 04:00 UTC in daylight time (EDT) and 05:00 UTC in standard time (EST)", () => {
    expect(new Date(localMidnight("2026-10-23")).toISOString()).toBe("2026-10-23T04:00:00.000Z");
    expect(new Date(localMidnight("2026-11-06")).toISOString()).toBe("2026-11-06T05:00:00.000Z");
    expect(new Date(localMidnight("2027-01-15")).toISOString()).toBe("2027-01-15T05:00:00.000Z");
    expect(new Date(localMidnight("2027-03-19")).toISOString()).toBe("2027-03-19T04:00:00.000Z");
  });

  it("the Fridays either side of a DST change: Nov 1 2026 (fall back) and Mar 14 2027 (spring forward)", () => {
    expect(new Date(slotFor("2026-10-30").at).toISOString()).toBe("2026-10-30T04:00:00.000Z");
    expect(new Date(slotFor("2026-11-06").at).toISOString()).toBe("2026-11-06T05:00:00.000Z");
    expect(new Date(slotFor("2027-03-12").at).toISOString()).toBe("2027-03-12T05:00:00.000Z");
    expect(new Date(slotFor("2027-03-19").at).toISOString()).toBe("2027-03-19T04:00:00.000Z");
    // The window ends at Monday 00:00 New York time, after the switch: 72 h + 1 h when falling back.
    expect(slotFor("2026-10-30").until - slotFor("2026-10-30").at).toBe(73 * 3600_000);
    expect(slotFor("2027-03-12").until - slotFor("2027-03-12").at).toBe(71 * 3600_000);
  });

  it("the New York date, not the UTC one", () => {
    expect(localDate(at("2026-10-23T03:59:59Z"))).toBe("2026-10-22"); // Thursday 23:59:59 EDT
    expect(localDate(at("2026-10-23T04:00:00Z"))).toBe("2026-10-23");
  });

  it("week ids are the ISO week of the Friday", () => {
    expect(slotFor("2026-10-23").week).toBe("2026-w43");
    expect(slotFor("2027-01-01").week).toBe("2026-w53"); // 2026 has 53 ISO weeks
    expect(slotFor("2027-01-08").week).toBe("2027-w01");
  });
});

describe("due", () => {
  it("not a second before midnight; from midnight on", () => {
    expect(dueSlot(at("2026-10-23T03:59:59Z"))).toBeNull(); // Thursday night in New York (Friday in UTC)
    expect(dueSlot(at("2026-10-23T04:00:00Z"))).toMatchObject({ friday: "2026-10-23", week: "2026-w43" });
  });

  it("in winter, midnight is an hour later in UTC", () => {
    expect(dueSlot(at("2026-11-06T04:30:00Z"))).toBeNull();
    expect(dueSlot(at("2026-11-06T05:00:00Z"))).toMatchObject({ friday: "2026-11-06", week: "2026-w45" });
  });

  it("catches up after downtime through Sunday night, never into the next ISO week", () => {
    expect(dueSlot(at("2026-10-24T18:00:00Z"))?.week).toBe("2026-w43"); // Saturday
    expect(dueSlot(at("2026-10-26T03:59:00Z"))?.week).toBe("2026-w43"); // Sunday 23:59 EDT
    expect(dueSlot(at("2026-10-26T04:00:00Z"))).toBeNull(); // Monday 00:00 EDT
    expect(dueSlot(at("2026-10-28T12:00:00Z"))).toBeNull(); // Wednesday
  });

  it("latest and next slots", () => {
    expect(latestSlot(at("2026-10-28T12:00:00Z")).friday).toBe("2026-10-23");
    expect(nextSlot(at("2026-10-28T12:00:00Z")).friday).toBe("2026-10-30");
    expect(nextSlot(at("2026-10-23T04:00:00Z")).friday).toBe("2026-10-30");
    expect(new Date(nextSlot(at("2026-11-01T12:00:00Z")).at).toISOString()).toBe("2026-11-06T05:00:00.000Z");
  });
});

describe("the daily refresh", () => {
  it("every New York day from its 00:00 until the next, whatever the UTC date", () => {
    expect(dueRefresh(at("2026-10-25T03:59:59Z"))).toMatchObject({ day: "2026-10-24" }); // Saturday 23:59:59 EDT
    expect(dueRefresh(at("2026-10-25T04:00:00Z"))).toEqual(refreshSlotFor("2026-10-25"));
    expect(new Date(refreshSlotFor("2026-10-25").at).toISOString()).toBe("2026-10-25T04:00:00.000Z");
    expect(new Date(refreshSlotFor("2026-10-25").until).toISOString()).toBe("2026-10-26T04:00:00.000Z");
  });

  it("through daylight saving: the fall-back day is 25 hours, the spring-forward day 23", () => {
    const fall = refreshSlotFor("2026-11-01"), spring = refreshSlotFor("2027-03-14");
    expect(new Date(fall.at).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(fall.until - fall.at).toBe(25 * 3600_000);
    expect(new Date(refreshSlotFor("2026-11-02").at).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(spring.until - spring.at).toBe(23 * 3600_000);
  });

  it("the next check is the next New York midnight", () => {
    expect(nextRefresh(at("2026-10-25T03:59:59Z")).day).toBe("2026-10-25");
    expect(nextRefresh(at("2026-10-25T04:00:00Z")).day).toBe("2026-10-26");
    expect(new Date(nextRefresh(at("2026-10-31T12:00:00Z")).at).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("only the current week: from its Friday until the next Friday 00:00 New York time", () => {
    expect(isCurrentWeek("2026-w43", at("2026-10-24T12:00:00Z"))).toBe(true); // Saturday
    expect(isCurrentWeek("2026-w43", at("2026-10-30T03:59:59Z"))).toBe(true); // Thursday 23:59:59 EDT
    expect(isCurrentWeek("2026-w43", at("2026-10-30T04:00:00Z"))).toBe(false); // the next Friday: week 44's turn
    expect(isCurrentWeek("2026-w42", at("2026-10-24T12:00:00Z"))).toBe(false); // a past week
    // A week put out early (Publish now on Monday of week 44) is current from then on.
    expect(isCurrentWeek("2026-w44", at("2026-10-26T12:00:00Z"))).toBe(true);
    // Across the year end (2026 has 53 ISO weeks).
    expect(isCurrentWeek("2026-w53", at("2027-01-06T12:00:00Z"))).toBe(true);
    expect(isCurrentWeek("2026-w53", at("2027-01-08T05:00:00Z"))).toBe(false);
  });
});
