import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_TIMINGS } from "./frameTimings";
import { ROWS as S2019 } from "./frameTimings/2019";
import { ROWS as S2021 } from "./frameTimings/2021";
import { ROWS as S2022 } from "./frameTimings/2022";
import { ROWS as S2023 } from "./frameTimings/2023";
import { ROWS as S2024 } from "./frameTimings/2024";
import { ROWS as S2025 } from "./frameTimings/2025";
import { ROWS as S2026 } from "./frameTimings/2026";

// The rows frameTimings.ts held when scripts/split-frame-timings.ts split it into one file a season
// (frameTimings.split.json): each row's video and event, the start of the sha-256 of the row as written, and its
// `checked`. Every one is still there, once, and unchanged unless a later read rewrote it (its `checked` then moved
// on); a row not pinned was written after the split, so no earlier than the newest pinned row.
const PINNED = (JSON.parse(readFileSync(join(__dirname, "frameTimings.split.json"), "utf8")) as string[]).map((line) => line.split(" ") as [string, string, string]);
const NEWEST = PINNED.map(([, , checked]) => checked).sort().at(-1)!;

const hash = (row: unknown) => createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 12);
const key = (f: { videoId: string; code: string }) => `${f.videoId}|${f.code}`;

describe("frame timings split by season", () => {
  it("serves every season file's rows, and nothing else", () => {
    expect(FRAME_TIMINGS).toEqual([S2019, S2021, S2022, S2023, S2024, S2025, S2026].flat());
    // A recording and event has one row, in one season's file.
    expect(new Set(FRAME_TIMINGS.map(key)).size).toBe(FRAME_TIMINGS.length);
  });

  it("keeps every row the single file held, unchanged", () => {
    expect(PINNED.length).toBeGreaterThan(0);
    const now = new Map(FRAME_TIMINGS.map((f) => [key(f), f]));
    for (const [k, h, checked] of PINNED) {
      const row = now.get(k);
      expect(row, k).toBeDefined();
      if (row!.checked === checked) expect(hash(row), k).toBe(h);
    }
    const pinned = new Set(PINNED.map(([k]) => k));
    for (const f of FRAME_TIMINGS) if (!pinned.has(key(f))) expect(f.checked >= NEWEST, key(f)).toBe(true);
  });
});
