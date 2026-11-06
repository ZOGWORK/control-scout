// The sign-off's "no per-query branch" check: every team number, team name, event, division and place the sign-off
// sets name, plus year literals, grepped in the search parser and answers (tests excluded). A hit is a line to
// read: a team or event name there is a branch for one query; a year may be a season boundary, so years are listed
// apart for a person to judge.
//
//   npx tsx scripts/search-signoff/literals.ts            prints the hits, exits 1 if a name or number is found
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const DIRS = ["server/api/query", "server/api/answers", "server/api/searchAnswer.ts", "server/api/search.ts", "server/api/searchEvents.ts", "src/components/search"];
const files = (p: string): string[] => {
  const abs = join(ROOT, p);
  try { if (statSync(abs).isFile()) return [abs]; } catch { return []; }
  return readdirSync(abs).flatMap((f) => files(join(p, f)));
};
const code = DIRS.flatMap(files).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test(kit)?\.(ts|tsx)$|testkit|fixtures?/.test(f));

// Every literal the sets use: team numbers, then the names of teams, events, divisions and places they mention.
// The queries only (not the Nov 4 notes beside them, whose numbers are results, not literals a branch would use).
const queries = (x: unknown): string[] => typeof x === "string" ? [] : Array.isArray(x) ? x.flatMap(queries)
  : x && typeof x === "object" ? Object.entries(x).flatMap(([k, v]) => (k === "q" && typeof v === "string" ? [v] : k === "phrasings" ? (v as string[]) : queries(v))) : [];
const sets = ["A", "B", "C", "D", "paraphrase", "anyteam"].flatMap((s) => queries(JSON.parse(readFileSync(join(import.meta.dirname, "sets", `${s}.json`), "utf8")))).join("\n");
// A number is a team's unless the words around it make it a threshold ("over 100 points", "rank 1000+", "top 100").
const numbers = [...new Set([...sets.matchAll(/(\b(?:over|than|top|below|least|rank|of)\s+)?\b(\d{3,5})\b(\+|\s+(?:points|matches|percent|teams))?/gi)]
  .filter((m) => !m[1] && !m[3]).map((m) => m[2]).filter((n) => !/^(19|20)\d\d$/.test(n)))];
const NAMES = ["hypnotic", "ultraviolet", "enforcers", "alphatronic", "delta force", "bad wolf", "gearview", "roborebels", "critical mass", "cosmic goose", "delbotics",
  "bolts and gears", "alphabit", "first street kids", "makeminds", "don't blink", "raider robotics", "quality control", "east bergen", "parkway", "turnpike",
  "vlaicu", "coanda", "essex", "lovelace", "ross division", "far north", "deep south", "oradell", "cluj", "river edge", "zzzqqq"];
const nameRe = new RegExp(`\\b(${numbers.join("|")})\\b|${NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}`, "i");
const yearRe = /\b20[12]\d\b/;

const hits: string[] = [], years: string[] = [];
for (const f of code) readFileSync(f, "utf8").split("\n").forEach((line, i) => {
  const l = line.trim();
  if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // comments explain with examples; only code can branch
  const at = `${relative(ROOT, f).replace(/\\/g, "/")}:${i + 1}: ${l.slice(0, 160)}`;
  if (nameRe.test(l)) hits.push(at);
  else if (yearRe.test(l)) years.push(at);
});
console.log(`${code.length} files searched for ${numbers.length} team numbers and ${NAMES.length} names from the sign-off sets.`);
console.log(`\nTeam/event/place literals in code: ${hits.length}`);
for (const h of hits) console.log(`  ${h}`);
console.log(`\nYear literals in code (to read: season boundaries are allowed, a year for one query is not): ${years.length}`);
for (const y of years) console.log(`  ${y}`);
process.exit(hits.length ? 1 : 0);
