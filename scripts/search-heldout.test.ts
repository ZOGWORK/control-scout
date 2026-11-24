// The held-out sets stay held out (audit M2, 24 Nov): no held-out question may appear word for word in the repo's tests
// or code (./search-heldout-leaks.ts says where it looks). One that does was seen while building search, so its pass
// says nothing about questions nobody has seen: move it with `npm run search:heldout -- --split`, or reword the test.
// And the grading of an answer against the one a person wrote (./search-heldout-grade.ts).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldoutSets } from "./heldoutSets";
import { leaks, scannedTexts } from "./search-heldout-leaks";
import { gradeWant, wantFacts } from "./search-heldout-grade";

// Every set: the shared file and each set's own file in scripts/heldout/ (./heldoutSets.ts).
const rows = heldoutSets();
// Each scan reads every file in the repo: slow on a busy CI shard, so a minute, not the default 20 s.
const SCAN_MS = 60_000;
const held = rows.filter((x) => !x.train), train = rows.filter((x) => x.train);

describe("held out means held out", () => {
  it("no held-out question appears word for word in tests or code", () => {
    const found = leaks(held.map((x) => x.q));
    const lines = [...found].map(([q, files]) => `"${q}" in ${files.slice(0, 3).join(", ")}`);
    expect(lines, `held-out questions in tests or code (move them: npm run search:heldout -- --split, or reword the test that has one from scripts/heldout/):\n${lines.join("\n")}`).toEqual([]);
  }, SCAN_MS);
  it("each question once: no set and number twice in the file", () => {
    const ids = rows.map((x) => `${x.set}#${x.n}`);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
  it("a question is in one set or the other, never both", () => {
    // By its set and number, and by its words: the same question under another id is still in both.
    const key = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");
    const ids = new Set(train.map((x) => `${x.set}#${x.n}`)), qs = new Set(train.map((x) => key(x.q)));
    expect(held.filter((x) => ids.has(`${x.set}#${x.n}`) || qs.has(key(x.q)))).toEqual([]);
  });
  it("finds a question as a whole phrase, never inside a longer word, and across lines", () => {
    const texts = new Map([["server/x.test.ts", 'expect(await ask("4215 opr rank")).tobe(1); // 14215 oprs']]);
    expect([...leaks(["4215 opr", "4215 opr rank", "215 opr", "4215 oprs"], texts).keys()]).toEqual(["4215 opr", "4215 opr rank"]);
    // Split across lines in a real file: read through scannedTexts, it is still that question.
    const root = mkdtempSync(join(tmpdir(), "heldout-leaks-"));
    try {
      mkdirSync(join(root, "server"));
      writeFileSync(join(root, "server", "y.test.ts"), 'ask("best auto in\n      nj")');
      expect([...leaks(["best auto in nj"], scannedTexts(root)).keys()]).toEqual(["best auto in nj"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("skips only a folder the checkout lacks", () => {
    const root = mkdtempSync(join(tmpdir(), "heldout-leaks-"));
    try {
      expect(scannedTexts(root).size).toBe(0);
      // A file where a scanned folder should be can't be walked: it fails, never a smaller scan.
      writeFileSync(join(root, "server"), "");
      expect(() => scannedTexts(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("looks through tests and code, never the eval lists themselves", () => {
    const paths = [...scannedTexts().keys()];
    expect(paths.some((p) => p.endsWith(".test.ts"))).toBe(true);
    // A set's own file (scripts/heldout/) is an eval list too: read, every question in it would match itself.
    // So is the replay set (scripts/search-replay.json): the questions visitors asked, held to their issues' fixes.
    expect(paths.some((p) => /search-heldout\.json|^scripts\/heldout\/|search-signoff\/sets\/|search-replay\.json/.test(p))).toBe(false);
  }, SCAN_MS);
});

describe("graded against the written answer", () => {
  it("takes only what can be checked from a want", () => {
    expect(wantFacts("26-6-0, 2025–26, 5 events")).toEqual(["26-6-0"]);
    // A rank moves as teams are added, a rating with each engine version: neither is held to what was written.
    expect(wantFacts("101.6, #612 of 8,308, 2025–26")).toEqual(["101.6"]);
    expect(wantFacts("4215 favored, ratings 98 versus 50.3")).toEqual([]);
    expect(wantFacts("Oradell, NJ, USA")).toEqual(["oradell", "nj", "usa"]);
    expect(wantFacts("Rookie year 2010")).toEqual(["2010"]);
    expect(wantFacts("Alliance partners in 2025–26, list stated")).toEqual([]);
  });
  it("correct when every fact is in the answer, wrong when one isn't", () => {
    expect(gradeWant("101.6, #612 of 8,308, 2025–26", "OPR in 2025–26 · 101.6 · #612 of 8,308", 2025).verdict).toBe("correct");
    expect(gradeWant("101.6, #612 of 8,308, 2025–26", "OPR in 2025–26 · 1101.65 · #612", 2025)).toMatchObject({ verdict: "wrong", missing: ["101.6"] });
    expect(gradeWant("26-6-0, 2025–26", "Record in 2025–26 · 26–6–0", 2025).verdict).toBe("correct");
    expect(gradeWant("Oradell, NJ, USA", "Hypnotic Robotics (4215) · Oradell, NJ", 2025)).toMatchObject({ verdict: "wrong", missing: ["usa"] });
  });
  it("unchecked when the answer is about another season, or the want has nothing to check", () => {
    expect(gradeWant("26-6-0, 2025–26", "Record in 2026–27 · 3-1-0", 2026).verdict).toBe("unchecked");
    expect(gradeWant("4215 OPR for 2024–25, 88.1", "OPR in 2024–25 · 88.1", 2024).verdict).toBe("correct");
    expect(gradeWant("Awards in 2025–26 only, list stated", "anything", 2025).verdict).toBe("unchecked");
    expect(gradeWant(undefined, "anything", 2025).verdict).toBe("unchecked");
  });
});

// One reader per question (the search audit's C2): the questions both the pipeline and the keyword layer claim,
// recorded by set and number (./search-heldout.claims.json), read against a whole run by ./search-heldout.ts.
describe("the record of questions claimed twice", () => {
  const recorded = (JSON.parse(readFileSync(join(import.meta.dirname, "search-heldout.claims.json"), "utf8")) as { both: string[] }).both;
  it("names held-out questions only, each once, in order", () => {
    const ids = new Set(held.map((x) => `${x.set}#${x.n}`));
    expect(recorded.filter((k) => !ids.has(k))).toEqual([]);
    expect(recorded).toEqual([...new Set(recorded)].sort());
  });
  it("is rewritten by a whole held-out run only: --claims with a set, a filter, the training set or --split is refused", () => {
    // Refused before any database is opened, so quick; the record is left as it was. Every file a run that wasn't
    // refused could write (the record, and the held-out file --split rewrites) is put back whatever happens, so a
    // failing run never leaves the checkout changed.
    const files = ["search-heldout.claims.json", "search-heldout.json"].map((n) => join(import.meta.dirname, n));
    const before = files.map((p) => readFileSync(p, "utf8"));
    try {
      for (const part of [["--set", "q260"], ["--only", "closest"], ["--train"], ["--split"]]) {
        const r = spawnSync(process.execPath, ["--import", "tsx", join(import.meta.dirname, "search-heldout.ts"), "--claims", ...part], { encoding: "utf8", timeout: 60_000 });
        // The child's own error, when it didn't start, timed out or died on an import: never read as a refusal gone.
        const why = `${part.join(" ")}: status ${r.status}${r.error ? `, ${r.error.message}` : ""}
${r.stderr ?? ""}`;
        expect(r.status, why).toBe(1);
        expect(r.stdout, why).toContain("--claims records a whole held-out run only");
      }
      files.forEach((p, i) => expect(readFileSync(p, "utf8"), p).toBe(before[i]));
    } finally {
      files.forEach((p, i) => writeFileSync(p, before[i]));
      rmSync(`${files[1]}.tmp`, { force: true });
    }
  }, 120_000);
});
