import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recover, withPackLock } from "./build.js";

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

  it("takes over a fresh lock whose process is gone (restart mid-build)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    writeFileSync(join(dir, ".build.lock"), JSON.stringify({ host: hostname(), pid: 2 ** 22 + 12345 }));
    await expect(withPackLock(dir, async () => "ok")).resolves.toBe("ok");
  });

  it("keeps a fresh lock held by another live process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    writeFileSync(join(dir, ".build.lock"), JSON.stringify({ host: hostname(), pid: process.ppid }));
    await expect(withPackLock(dir, async () => "x")).rejects.toThrow(/Another pack build/);
  });

  it("takes over a lock with this process's own pid when it isn't building (reused pid)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    writeFileSync(join(dir, ".build.lock"), JSON.stringify({ host: hostname(), pid: process.pid }));
    await expect(withPackLock(dir, async () => "ok")).resolves.toBe("ok");
  });

  it("a late recovery never removes a lock another builder just took", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    const lock = join(dir, ".build.lock");
    const dead = JSON.stringify({ host: hostname(), pid: 2 ** 22 + 777 });
    writeFileSync(lock, dead);
    let release!: () => void;
    // Builder A recovers the dead lock and builds…
    const a = withPackLock(dir, () => new Promise<void>((r) => { release = r; }));
    await new Promise((r) => setTimeout(r, 10));
    const aLock = readFileSync(lock, "utf8");
    // …while builder B, which judged the same dead lock stale earlier, recovers late.
    recover(lock, dead);
    expect(readFileSync(lock, "utf8")).toBe(aLock); // A's lock is back in place
    await expect(withPackLock(dir, async () => "b")).rejects.toThrow(/Another pack build/);
    release();
    await a;
  });

  it("releases the lock when the build fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-lock-"));
    await expect(withPackLock(dir, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(join(dir, ".build.lock"))).toBe(false);
  });
});
