// The runner's merge step (scripts/lib/autopilotMergeStep.ts): main quiet, at most one of its own PRs, live by sha.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mainQuiet, mainStill, pickMerge, servesMerge } from "./autopilotMergeStep";

describe("mainQuiet", () => {
  it("merges only once main's last commit is old enough", () => {
    expect(mainQuiet(0, 605_000, 605_000)).toBeNull();
    expect(mainQuiet(0, 604_000, 605_000)).toBe("main's last commit is 604 s old, under 605 s");
    expect(mainQuiet(Number.NaN, 1, 605_000)).toBe("main's last commit time couldn't be read");
  });
});

describe("mainStill", () => {
  it("merges only if main hasn't moved since the gate read it, and is still quiet", () => {
    expect(mainStill("aaaaaaaaa1", { sha: "aaaaaaaaa1", at: 0 }, 605_000, 605_000)).toBeNull();
    expect(mainStill("aaaaaaaaa1", { sha: "bbbbbbbbb2", at: 0 }, 605_000, 605_000)).toBe("main moved to bbbbbbbbb since the gate read aaaaaaaaa");
    expect(mainStill("aaaaaaaaa1", { sha: "aaaaaaaaa1", at: 1_000 }, 605_000, 605_000)).toBe("main's last commit is 604 s old, under 605 s");
  });
});

describe("pickMerge", () => {
  const clean = (head: string) => ({ head, problems: [] as string[] });
  it("merges at most one: the first of its own PRs, not rebuilt this run, whose gate passes", () => {
    const gated: number[] = [];
    const r = pickMerge([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }], {
      rebuilt: new Set([1]), me: "auto",
      author: (n) => (n === 2 ? "someone" : "auto"),
      gate: (n) => { gated.push(n); return clean(`sha${n}`); },
    });
    expect(r.pick).toEqual({ number: 3, head: "sha3" });
    expect(r.passed).toEqual(["#1 rebuilt this run: waits for its review", "#2 is someone's, not this autopilot's (auto): left"]);
    // The gate stops at the first that passes: #4 isn't even checked.
    expect(gated).toEqual([3]);
  });

  it("passes over a PR its gate stops, with the first reasons, and merges none when every one waits", () => {
    const reasons = ["a", "b", "c", "d", "e", "f"];
    const r = pickMerge([{ number: 7 }], { rebuilt: new Set(), me: "auto", author: () => "auto", gate: () => ({ head: "x", problems: reasons }) });
    expect(r).toEqual({ pick: null, passed: ["#7 waits: a; b; c; d (+2)"] });
  });
});

describe("pickMerge: one PR that can't be read", () => {
  it("waits, and never stops the PRs after it", () => {
    const r = pickMerge([{ number: 5 }, { number: 6 }, { number: 7 }], {
      rebuilt: new Set(), me: "auto",
      author: (n) => { if (n === 6) throw new Error("gh: HTTP 502"); return "auto"; },
      gate: (n) => { if (n === 5) throw new Error("no rows array under the data mark"); return { head: `sha${n}`, problems: [] }; },
    });
    expect(r.pick).toEqual({ number: 7, head: "sha7" });
    expect(r.passed).toEqual(["#5 waits: its gate couldn't be read (no rows array under the data mark)", "#6 waits: its gate couldn't be read (gh: HTTP 502)"]);
  });
});

describe("servesMerge", () => {
  const ancestors = new Set(["m1>r2"]);
  const isAncestor = (a: string, b: string) => ancestors.has(`${a}>${b}`);
  it("is live when the release is the merge or a main commit after it", () => {
    expect(servesMerge(JSON.stringify({ ok: true, release: "m1" }), "m1", isAncestor)).toBe(true);
    expect(servesMerge(JSON.stringify({ release: "r2" }), "m1", isAncestor)).toBe(true);
    expect(servesMerge(JSON.stringify({ release: "r0" }), "m1", isAncestor)).toBe(false);
  });
  it("asks again when no release can be read (restarting, down, not JSON)", () => {
    expect(servesMerge("<html>502</html>", "m1", isAncestor)).toBeNull();
    expect(servesMerge(JSON.stringify({ ok: false }), "m1", isAncestor)).toBeNull();
    // Serving the release but not ready yet (warming up after the restart): not live yet.
    expect(servesMerge(JSON.stringify({ release: "m1", ready: false }), "m1", isAncestor)).toBeNull();
    expect(servesMerge(JSON.stringify({ release: "m1", ready: true }), "m1", isAncestor)).toBe(true);
  });
});

describe("the runner's merge step (scripts/clip-autopilot.ts 1c)", () => {
  it("is called only after every top-level const and let of its section has run", () => {
    // A const read before its line runs throws (temporal dead zone): the step's catch would log "nothing merged" every run.
    const src = readFileSync("scripts/clip-autopilot.ts", "utf8");
    const section = src.slice(src.indexOf("// --- 1c."), src.indexOf("// --- 2."));
    const call = section.indexOf("if (!DRY && MERGE) mergeOne();");
    expect(call).toBeGreaterThan(section.indexOf("function mergeOne("));
    const late = [...section.matchAll(/^(?:const|let) (\w+)/gm)].filter((m) => (m.index ?? 0) > call).map((m) => m[1]);
    expect(late).toEqual([]);
  });
});
