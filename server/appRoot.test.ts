// The app's folder is the one with its package.json, found from the module's own place: the same from the source
// and from the built bundle (build/server/index.mjs), whatever the working directory. And the background jobs the
// server starts (the data cycle, pack builds) still load their TypeScript when the server runs from the bundle.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_ROOT, appPath, findRoot } from "./appRoot";
import { childArgs, runScriptInChild } from "./data/cycle";

const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;

describe("the app's folder", () => {
  it("holds the package.json, the scripts the server runs and its content", () => {
    expect(existsSync(join(APP_ROOT, "package.json"))).toBe(true);
    expect(existsSync(appPath("scripts", "data-cycle.ts"))).toBe(true);
    expect(existsSync(appPath("scripts", "build-packs.ts"))).toBe(true);
    expect(existsSync(appPath("server", "share", "fonts"))).toBe(true);
  });
  it("is found walking up from where the bundle lives, and outside the app it falls back to the working directory", () => {
    expect(findRoot(join(APP_ROOT, "build", "server"))).toBe(APP_ROOT);
    expect(findRoot(join(APP_ROOT, "server", "share"))).toBe(APP_ROOT);
    const away = mkdtempSync(join(tmpdir(), "cs-root-"));
    try { expect(findRoot(away)).toBe(process.cwd()); } finally { rmSync(away, { recursive: true, force: true }); }
  });
  it("is the same in a fresh process started from another folder (not just the working directory)", () => {
    const away = mkdtempSync(join(tmpdir(), "cs-cwd-"));
    try {
      const out = execFileSync(process.execPath, ["--import", tsxLoader, "--input-type=module", "-e",
        `import(${JSON.stringify(pathToFileURL(appPath("server", "appRoot.ts")).href)}).then((m) => process.stdout.write(m.APP_ROOT))`], { cwd: away, encoding: "utf8" });
      expect(out).toBe(APP_ROOT);
    } finally { rmSync(away, { recursive: true, force: true }); }
  });
});

describe("background jobs from the bundle", () => {
  it("load TypeScript through tsx even when the server's own flags don't (the bundle's), keeping its other flags", () => {
    expect(childArgs([], "x.ts")).toEqual(["--import", "tsx", "x.ts"]);
    expect(childArgs(["--enable-source-maps"], "x.ts")).toEqual(["--import", "tsx", "--enable-source-maps", "x.ts"]);
    expect(childArgs(["--import", "tsx"], "x.ts")).toEqual(["--import", "tsx", "x.ts"]);
  });
  it("a TypeScript script started with the bundle's flags runs, from the app's folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-child-"));
    const out = join(dir, "out.txt"), script = join(dir, "job.ts");
    // TypeScript-only syntax: it runs only if the child loads it through tsx.
    writeFileSync(script, `import { writeFileSync } from "node:fs";\nconst where: string = process.cwd();\nwriteFileSync(${JSON.stringify(out)}, where);\n`);
    try {
      await runScriptInChild(script, "test job", 60_000, ["--enable-source-maps"]);
      expect(readFileSync(out, "utf8")).toBe(APP_ROOT);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
