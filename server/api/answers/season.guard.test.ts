// One "current season" for search (docs/search-pipeline.md, "Season default"): ./season.ts reads it from the data and
// today's date, and every answer (server/api/answers) and the query pipeline (server/api/query) ask it. The older
// readers directly under server/api still use CURRENT_SEASON for what is the configured season rather than a search's
// default (registration counts, a predict link); the second test keeps them from defining a season default of their own. The fixed CURRENT_SEASON (the newest season in the
// season list) and a reader's own "this season" helper disagree with it around the September rollover, before the
// next season is listed, and in the days a Championship is under way.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = join(import.meta.dirname, "..", "..");
const ONE_SOURCE = join(SERVER, "api", "answers", "season.ts");

/** Every source file under `dir`, tests aside. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name) ? [p] : [];
  });
}
const name = (p: string) => relative(SERVER, p).replace(/\\/g, "/");
/** The file's code without its comments, so a comment naming the constant is no use of it. */
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("search's current season has one source", () => {
  it("no answer or query reader reads the fixed CURRENT_SEASON: they ask ./season.ts", () => {
    const dirs = [join(SERVER, "api", "answers"), join(SERVER, "api", "query")];
    const using = dirs.flatMap(sources).filter((p) => p !== ONE_SOURCE && /\bCURRENT_SEASON\b/.test(code(p))).map(name);
    expect(using).toEqual([]);
  });

  it("no other file in the server defines a season helper of its own", () => {
    const HELPER = /\b(?:function|const|let)\s+(currentSeason|defaultSeason|completedSeason|lastSeason|askSeason)\b/;
    const own = sources(SERVER).filter((p) => p !== ONE_SOURCE && HELPER.test(code(p))).map((p) => `${name(p)}: ${HELPER.exec(code(p))![1]}`);
    expect(own).toEqual([]);
  });
});
