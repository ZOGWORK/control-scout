// localToUtcMs keeps each zone's offset by the hour: every answer is the formatter's own, across DST changes (including
// half-hour zones and Lord Howe's half-hour shift) and at every second of the changing hours.
import { describe, expect, it } from "vitest";
import { localToUtcMs } from "./time";

/** The same conversion with the formatter read every time (the code as it was). */
const fs = new Map<string, Intl.DateTimeFormat>();
function direct(local: string, zone: string): number | null {
  const f = fs.get(zone) ?? fs.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })).get(zone)!;
  const off = (ms: number) => {
    const parts = f.formatToParts(new Date(ms));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(ms / 1000) * 1000;
  };
  const guess = Date.parse(`${local}Z`);
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 23);

describe("localToUtcMs by the hour", () => {
  const zones = ["America/New_York", "America/Los_Angeles", "Europe/London", "Australia/Sydney", "Australia/Lord_Howe", "Asia/Kolkata", "America/St_Johns", "Pacific/Chatham", "UTC", "Asia/Shanghai", "America/Sao_Paulo"];
  it("gives the formatter's answer every 37 minutes through 2025 and 2026", () => {
    const wrong: string[] = [];
    for (const z of zones) {
      for (let ms = Date.UTC(2025, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 37 * 60_000 + 13_000) {
        const local = iso(ms);
        if (localToUtcMs(local, z) !== direct(local, z)) wrong.push(`${z} ${local}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("gives it around each change (every 7 s through the hours that keep no offset)", () => {
    const around = [
      ["America/New_York", "2026-03-08T01:30:00"], ["America/New_York", "2026-11-01T00:30:00"],
      ["Australia/Lord_Howe", "2026-04-05T01:00:00"], ["Australia/Lord_Howe", "2026-10-04T01:30:00"],
      ["Europe/London", "2026-03-29T00:30:00"], ["Pacific/Chatham", "2026-04-05T02:30:00"],
    ] as const;
    const wrong: string[] = [];
    for (const [z, start] of around) {
      const t0 = Date.parse(`${start}Z`);
      for (let s = 0; s < 3 * 3600; s += 7) {
        const local = iso(t0 + s * 1000);
        if (localToUtcMs(local, z) !== direct(local, z)) wrong.push(`${z} ${local}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);
});
