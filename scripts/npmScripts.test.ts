// Every `npm run <name>` the scripts' own headers tell people to type has to exist in package.json.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("npm scripts named in scripts/", () => {
  it("each `npm run X` in a script's comments is a real package.json script", () => {
    const missing: string[] = [];
    for (const f of readdirSync(__dirname).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const text = readFileSync(join(__dirname, f), "utf8");
      for (const m of text.matchAll(/^\s*\/\/.*?npm run ([a-z][\w:-]*)/gm)) if (!(m[1] in pkg.scripts)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
  it("offline:check runs the offline journeys script", () => {
    expect(pkg.scripts["offline:check"]).toBe("tsx scripts/offline-check.ts");
  });
});
