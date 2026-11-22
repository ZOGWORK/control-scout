// A recording's storyboard (server/videos/storyboards.ts): the spec read at home and its levels, the tile showing a
// given second (a short last sheet too), the delivery through the auto-reads inbox, and each clip's own frame on search.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { all, migrate, openDb, run, setDb } from "../db";
import { processInbox } from "./autoReads";
import { applyStoryboards, forgetStoryboards, parseSpec, stillAt, STILL_INTO_S, storyboards, storyboardShape, withStills } from "./storyboards";
import type { SearchVideoItem } from "../../src/shared/api";

const ID = "zDyuEfqXA7w";
// The shape of zDyuEfqXA7w's real spec (a 5-hour stream: 1806 frames 10 s apart).
const SPEC = `https://i.ytimg.com/sb/${ID}/storyboard3_L$L/$N.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjT6pnXBg==|48#27#100#10#10#0#default#rs$AOn4CLAC|80#45#1806#10#10#10000#M$M#rs$AOn4CLDQ|160#90#1806#5#5#10000#M$M#rs$AOn4CLAH|320#180#1806#3#3#10000#M$M#rs$AOn4CLDS`;

beforeAll(async () => { setDb(openDb(":memory:")); await migrate(); });
beforeEach(async () => { await run("DELETE FROM video_storyboards"); forgetStoryboards(); });

describe("parseSpec", () => {
  it("reads each level of this video's sheets", () => {
    const sb = parseSpec(ID, SPEC)!;
    expect(sb.base).toBe(`https://i.ytimg.com/sb/${ID}/storyboard3_L$L/$N.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjT6pnXBg==`);
    expect(sb.levels.at(-1)).toEqual({ level: 3, w: 320, h: 180, count: 1806, cols: 3, rows: 3, ms: 10000, name: "M$M", sigh: "rs$AOn4CLDS" });
  });
  it("never another video's sheets, another host, or a spec with no timed frames", () => {
    expect(parseSpec("aaaaaaaaaaa", SPEC)).toBeNull();
    expect(parseSpec(ID, SPEC.replace("i.ytimg.com", "evil.example"))).toBeNull();
    expect(parseSpec(ID, SPEC.split("|").slice(0, 2).join("|"))).toBeNull();
    expect(parseSpec("not-an-id", SPEC)).toBeNull();
  });
});

describe("stillAt", () => {
  const sb = parseSpec(ID, SPEC)!;
  it("the largest level's tile for the second asked: its sheet, column and row", () => {
    // 15522 s → frame 1552 → sheet 172 (9 a sheet), tile 4: the middle of a 3 × 3 sheet.
    expect(stillAt(sb, 15522)).toEqual({ src: `https://i.ytimg.com/sb/${ID}/storyboard3_L3/M172.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjT6pnXBg==&sigh=rs%24AOn4CLDS`, col: 1, row: 1, cols: 3, rows: 3 });
  });
  it("a last sheet holds only the frames left: drawn that size", () => {
    // 1806 frames: the last sheet (200) holds 6, two rows of 3.
    expect(stillAt(sb, 18050)).toMatchObject({ src: expect.stringContaining("/M200.jpg"), col: 2, row: 1, cols: 3, rows: 2 });
  });
  it("past the video's end, or before it: none", () => {
    expect(stillAt(sb, 18060)).toBeNull();
    expect(stillAt(sb, -1)).toBeNull();
  });
});

describe("delivery and search", () => {
  it("a storyboards file in the inbox is kept; a spec for another video is dropped; a later read replaces it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-inbox-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ kind: "storyboards", rows: [{ videoId: ID, spec: SPEC }, { videoId: "aaaaaaaaaaa", spec: SPEC }], source: "test" }));
    const r = await processInbox({ dir });
    expect(r).toMatchObject({ files: 1, rejected: 0 });
    expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
    expect((await all<{ video_id: string }>("SELECT video_id FROM video_storyboards")).map((x) => x.video_id)).toEqual([ID]);
    await applyStoryboards({ kind: "storyboards", rows: [{ videoId: ID, spec: SPEC.replace("rs$AOn4CLDS", "rs$NEW") }] });
    expect((await storyboards([ID])).get(ID)?.levels.at(-1)?.sigh).toBe("rs$NEW");
  });
  it("a delivery's shape", () => {
    expect(storyboardShape({ kind: "storyboards", rows: [] })).toBeNull();
    expect(storyboardShape({ kind: "storyboards" })).toBe("no rows");
  });
  it("each clip cut from a recording gets its own frame, half a minute into its match; a match's own video keeps its thumbnail", async () => {
    await applyStoryboards({ kind: "storyboards", rows: [{ videoId: ID, spec: SPEC }] });
    const cut: SearchVideoItem = { videoId: ID, t: 15482, end: 15712, kind: "recording", match: "Q21" };
    const own: SearchVideoItem = { videoId: "pC9c2m_Z0t8", t: 0, kind: "match", match: "Q106" };
    const other: SearchVideoItem = { videoId: "bbbbbbbbbbb", t: 100, kind: "recording", match: "Q1" };
    await withStills([cut, own, other]);
    expect(cut.still).toEqual(stillAt(parseSpec(ID, SPEC)!, 15482 + STILL_INTO_S));
    expect(own.still).toBeUndefined();
    expect(other.still).toBeUndefined();
  });
});
