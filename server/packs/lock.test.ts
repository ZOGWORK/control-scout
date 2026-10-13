import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withPackLock } from "./build.js";

describe("withPackLock", () => {
  it("refuses a second build while one holds the lock, then releases it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    let release!: () => void;
    const first = withPackLock(dir, () => new Promise<string>((r) => { release = () => r("first"); }));
    await expect(withPackLock(dir, async () => "second")).rejects.toThrow(/Another pack build/);
    release();
    await expect(first).resolves.toBe("first");
    expect(existsSync(join(dir, ".build.lock"))).toBe(false);
    await expect(withPackLock(dir, async () => "third")).resolves.toBe("third");
  });

  it("takes over a stale lock left by a crashed build", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    const lock = join(dir, ".build.lock");
    writeFileSync(lock, "");
    const old = (Date.now() - 3 * 3600_000) / 1000;
    utimesSync(lock, old, old);
    await expect(withPackLock(dir, async () => "ok")).resolves.toBe("ok");
  });

  it("releases the lock when the build fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    await expect(withPackLock(dir, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(join(dir, ".build.lock"))).toBe(false);
  });
});
