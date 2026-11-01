// Server queries name the columns they read: a SELECT * (or alias.*) ships every column of the row from the database,
// score sheets and all, and grows silently with every new column. One that truly reads a derived table's own columns
// says so in a comment containing "select-star:" on its line or one of the two lines above.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const STAR = /\bSELECT\s+(?:DISTINCT\s+)?\*|\b[a-z_]\w*\.\*\s*(?:,|\bFROM\b)/gi;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" || d.name === "__snapshots__" ? [] : sources(p);
    return /\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name) ? [p] : [];
  });
}

/** Every unexplained star select in server code, as "file:line". */
export function unexplainedStars(files = sources(ROOT)): string[] {
  const out: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lines = text.split("\n");
    for (const m of text.matchAll(STAR)) {
      const line = text.slice(0, m.index).split("\n").length - 1;
      if (!lines.slice(Math.max(0, line - 2), line + 1).some((l) => l.includes("select-star:"))) out.push(`${relative(ROOT, f).replace(/\\/g, "/")}:${line + 1}`);
    }
  }
  return out;
}

describe("server queries name their columns", () => {
  it("has no SELECT * without a select-star: comment", () => {
    expect(unexplainedStars()).toEqual([]);
  });

  it("catches the forms it's meant to", () => {
    expect([..."SELECT * FROM t; select a.* from t a; SELECT DISTINCT * FROM t; SELECT ws.id, w.*, x FROM t".matchAll(STAR)]).toHaveLength(4);
    expect([..."SELECT COUNT(*) n FROM t; SELECT a.b FROM t; /^.*$/".matchAll(STAR)]).toHaveLength(0);
  });
});
