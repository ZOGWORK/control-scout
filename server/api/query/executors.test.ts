// One executor per intent, each saying why when it says no (the search audit's C5, ./execute.ts EXECUTORS): the reason
// is noted for the soft-failure log (declineOf, ../../searchFailures.ts softFailureOf), never a silent null.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { CURRENT_SEASON } from "../../data/seasons";
import { clearAllCaches } from "../../caches";
import { refreshSearchSeason, resetSearchSeason } from "../answers/season";
import { declineOf, pipelineAnswer, type PipelineOptions } from "./execute";

const S = CURRENT_SEASON - 1;
const opts: PipelineOptions = { full: true, pages: [], resolve: async () => ({ hits: [], step: "deterministic" }) as never };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [23268, "Ultraviolet"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await rebuildSearch();
  resetSearchSeason();
  await refreshSearchSeason();
  clearAllCaches();
});

describe("the executors' no", () => {
  it("says why, for the soft-failure log", async () => {
    // Two teams with no comparison said: a lone "or" is the boolean reader's.
    expect(await pipelineAnswer("4215 or 23268", opts)).toBeNull();
    expect(declineOf("4215 or 23268")).toBe("two teams with no comparison said");
    // A count the team's answer doesn't list ("top 3" of its wins), and a gate before any executor (the finals).
    expect(await pipelineAnswer("4215 top 3 wins", opts)).toBeNull();
    expect(declineOf("4215 top 3 wins")).toBe("a count its answer doesn't list");
    expect(await pipelineAnswer("best finals teams", opts)).toBeNull();
    expect(declineOf("best finals teams")).toBe("the finals filter only matches");
    // Never asked: no reason.
    expect(declineOf("never asked")).toBeNull();
  });

  it("is a fixed phrase, never the query's words, and no executor returns a bare null", () => {
    const src = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
    const from = src.indexOf("async function executeOrDecline"), to = src.indexOf("const EXECUTORS");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const body = src.slice(from, to).replace(/^\s*\/\/.*$/gm, "");
    expect(body).not.toMatch(/return null\b/);
    // Each call's own last argument, found by its own closing bracket (never a neighbour's).
    let calls = 0;
    for (const m of body.matchAll(/\b(?:no|or)\(/g)) {
      const open = m.index! + m[0].length;
      let depth = 1, i = open, quote: string | null = null;
      for (; i < body.length && depth; i++) {
        const c = body[i];
        if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
      }
      const args = body.slice(open, i - 1);
      // The reason is the last argument: after the last comma outside any bracket or string.
      let cut = 0, d = 0, q: string | null = null;
      for (let j = 0; j < args.length; j++) {
        const c = args[j];
        if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === "`") q = c;
        else if ("([{".includes(c)) d++;
        else if (")]}".includes(c)) d--;
        else if (c === "," && d === 0) cut = j + 1;
      }
      expect(args.slice(cut).trim(), body.slice(m.index!, m.index! + 120)).toMatch(/^"[^"`$\\]+"$/);
      calls++;
    }
    expect(calls).toBeGreaterThan(40);
  });

  it("is each call's own, and read as search reads the query", async () => {
    // Asked at once: each question keeps its own reason, never the other's.
    await Promise.all([pipelineAnswer("4215 top 3 wins", opts), pipelineAnswer("best finals teams", opts), pipelineAnswer("4215 or 23268", opts)]);
    expect(declineOf("4215 top 3 wins")).toBe("a count its answer doesn't list");
    expect(declineOf("best finals teams")).toBe("the finals filter only matches");
    expect(declineOf("4215 or 23268")).toBe("two teams with no comparison said");
    // A question mark, spaces and case aside, as the route's query and the pipeline's differ.
    expect(declineOf("  Best finals TEAMS?")).toBe("the finals filter only matches");
  });
});
