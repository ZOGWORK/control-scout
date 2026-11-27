// A season's pack carried into a new release (packs/build.ts carriedSeason): an event-day build rebuilds the current
// season's pack and links the frozen seasons' files under the new version's name instead of rewriting 90 MB of bytes
// that cannot have changed. Every manifest keeps naming its own files, so pruning an old release is still safe.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { carriedSeason } from "./build.js";

const dir = () => mkdtempSync(join(tmpdir(), "cs-carry-"));

describe("carriedSeason", () => {
  it("names the old release's files as the new version's, byte for byte", () => {
    const d = dir();
    writeFileSync(join(d, "scout-pack-2026-11-27-1-2025.db"), "database bytes");
    writeFileSync(join(d, "scout-pack-2026-11-27-1-2025.db.gz"), "gzipped");
    const entry = {
      name: "scout-pack-2026-11-27-1-2025.db", url: "/packs/scout-pack-2026-11-27-1-2025.db", bytes: 14, sha256: "abc",
      seasons: [2025], kind: "full" as const, contents: "Every DECODE event.", stats: { matches: 3, events: 1 },
      gz: { name: "scout-pack-2026-11-27-1-2025.db.gz", url: "/packs/scout-pack-2026-11-27-1-2025.db.gz", bytes: 7, sha256: "def" },
    };
    const carried = carriedSeason(d, "2026-11-27.2", entry);
    expect(carried.name).toBe("scout-pack-2026-11-27-2-2025.db");
    expect(carried.url).toBe("/packs/scout-pack-2026-11-27-2-2025.db");
    expect(carried.gz!.name).toBe("scout-pack-2026-11-27-2-2025.db.gz");
    expect(readFileSync(join(d, carried.name), "utf8")).toBe("database bytes");
    expect(readFileSync(join(d, carried.gz!.name), "utf8")).toBe("gzipped");
    // Everything the manifest says about it still holds: the bytes never changed, only their name.
    expect(carried.sha256).toBe("abc");
    expect(carried.gz!.sha256).toBe("def");
    expect(carried.stats).toEqual({ matches: 3, events: 1 });
    expect(carried.contents).toBe("Every DECODE event.");
    // A hard link where the filesystem has them: same inode, no second copy of the bytes.
    expect(statSync(join(d, carried.name)).ino).toBe(statSync(join(d, entry.name)).ino);
  });

  it("nothing half-written is ever left under a name the manifest could list", () => {
    const d = dir();
    writeFileSync(join(d, "scout-pack-2026-11-27-1-2023.db"), "season 2023");
    const entry = { name: "scout-pack-2026-11-27-1-2023.db", url: "/packs/scout-pack-2026-11-27-1-2023.db", bytes: 11, sha256: "x", seasons: [2023], kind: "full" as const, contents: "Every season's pack." };
    carriedSeason(d, "2026-11-27.5", entry);
    expect(readdirSync(d).filter((f) => f.includes(".part"))).toEqual([]);
    // A carry that can't finish throws and leaves nothing behind: the next build starts this version's name clean.
    expect(() => carriedSeason(d, "2026-11-27.6", { ...entry, name: "scout-pack-gone-2023.db" })).toThrow();
    expect(readdirSync(d)).toEqual(["scout-pack-2026-11-27-1-2023.db", "scout-pack-2026-11-27-5-2023.db"]);
  });

  it("a release built twice gets its own name back, and an existing target is left as it is", () => {
    const d = dir();
    writeFileSync(join(d, "scout-pack-2026-11-27-1-2024.db"), "season 2024");
    const entry = { name: "scout-pack-2026-11-27-1-2024.db", url: "/packs/scout-pack-2026-11-27-1-2024.db", bytes: 11, sha256: "x", seasons: [2024], kind: "full" as const, contents: "Every season's pack." };
    carriedSeason(d, "2026-11-27.3", entry);
    writeFileSync(join(d, "scout-pack-2026-11-27-4-2024.db"), "already here");
    const again = carriedSeason(d, "2026-11-27.4", entry);
    expect(readFileSync(join(d, again.name), "utf8")).toBe("already here");
  });
});
