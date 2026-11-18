// scripts/clip-autopilot.ts openPr: a data PR's one commit sits on the main its file is read from (mainText reads
// origin/main; a fetch since the clone was put on main moves it, not HEAD). Read off the runner's own source: the
// runner runs its whole run when imported.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../clip-autopilot.ts", import.meta.url)), "utf8");
const start = src.indexOf("function openPr(");
const body = src.slice(start, src.indexOf("\n}\n", start));

describe("openPr", () => {
  it("puts HEAD on origin/main before writing main's file with its rows and committing", () => {
    const toMain = body.indexOf('git("switch", "--quiet", "--detach", "origin/main")');
    const write = body.indexOf("writeFileSync(o.file, applyRows(mainText(o.file), o.rows))");
    const commit = body.indexOf("commitEach(");
    expect(toMain).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(toMain);
    expect(commit).toBeGreaterThan(write);
    // A dry run opens nothing and leaves the checkout as it is: the switch is past its return.
    expect(body.indexOf("if (DRY)")).toBeLessThan(toMain);
  });
});
