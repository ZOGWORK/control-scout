import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_TIMINGS, type FrameTiming } from "./frameTimings";

// Every season file there is, imported or not: one frameTimings.ts doesn't import serves nothing.
const FILES = import.meta.glob<FrameTiming[]>("./frameTimings/*.ts", { eager: true, import: "ROWS" });
const SEASONS = new Map(Object.entries(FILES).map(([path, rows]) => [/(\d{4})\.ts$/.exec(path)![1], rows]));

// The rows scripts/split-frame-timings.ts pinned when it split frameTimings.ts into one file a season
// (frameTimings.split.json): each row's video and event, the start of the sha-256 of the row as written, its
// `checked`, and the season whose file holds it. Every one is still there, once, in its season's file, and unchanged
// unless a later read rewrote it (its `checked` then moved on; a rewrite on the pinned day re-pins: run the script
// again). A row not pinned was written after the split, so no earlier than the newest pinned row.
const PINNED = (JSON.parse(readFileSync(join(__dirname, "frameTimings.split.json"), "utf8")) as string[]).map((line) => line.split(" ") as [string, string, string, string]);
const NEWEST = PINNED.map(([, , checked]) => checked).sort().at(-1)!;

const hash = (row: unknown) => createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 12);
const key = (f: { videoId: string; code: string }) => `${f.videoId}|${f.code}`;

describe("frame timings split by season", () => {
  it("serves every season file's rows, and nothing else", () => {
    const seasons = [...SEASONS.keys()].sort();
    expect(seasons).toEqual(expect.arrayContaining(["2019", "2021", "2022", "2023", "2024", "2025", "2026"]));
    expect(FRAME_TIMINGS).toEqual(seasons.flatMap((s) => SEASONS.get(s)!));
    // A recording and event has one row, in one season's file.
    expect(new Set(FRAME_TIMINGS.map(key)).size).toBe(FRAME_TIMINGS.length);
  });

  it("keeps every row the single file held in its season's file, unchanged", () => {
    expect(PINNED.length).toBeGreaterThan(0);
    for (const [k, h, checked, season] of PINNED) {
      const row = SEASONS.get(season)?.find((f) => key(f) === k);
      expect(row, `${k} in ${season}.ts`).toBeDefined();
      if (row!.checked === checked) expect(hash(row), `${k} changed on its pinned day: re-pin with scripts/split-frame-timings.ts`).toBe(h);
    }
    const pinned = new Set(PINNED.map(([k]) => k));
    for (const f of FRAME_TIMINGS) if (!pinned.has(key(f))) expect(f.checked >= NEWEST, key(f)).toBe(true);
  });
});
