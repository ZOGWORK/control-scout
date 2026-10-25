// The app's folder is the one with its package.json, found from the module's own place: the same from the source
// and from the built bundle (build/server/index.mjs), whatever the working directory.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROOT, appPath } from "./appRoot";

describe("the app's folder", () => {
  it("holds the package.json, the scripts the server runs and its content", () => {
    expect(existsSync(join(APP_ROOT, "package.json"))).toBe(true);
    expect(existsSync(appPath("scripts", "data-cycle.ts"))).toBe(true);
    expect(existsSync(appPath("scripts", "build-packs.ts"))).toBe(true);
    expect(existsSync(appPath("server", "share", "fonts"))).toBe(true);
    expect(existsSync(appPath("content"))).toBe(true);
  });
});
