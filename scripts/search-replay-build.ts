// Writes the replay set, scripts/search-replay.json, from the closed `failed-search` issues: every query each one
// lists, once (scripts/lib/searchReplay.ts). Issues closed as not planned or labelled `dismissed` are left out. A
// query that is word for word an eval question (scripts/search-heldout.json, scripts/search-signoff/sets) is marked
// source "eval", our own test traffic. Read-only on GitHub (one `gh issue list`); the kinds already recorded are kept.
// Then record what each query gets today and set the floor in scripts/search-replay.ts:
//
//   npm run search:replay:build
//   npm run search:replay -- --write
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSet, sameQuery, serialize, type ClosedIssue, type ReplaySet } from "./lib/searchReplay.js";

const REPO = "ZOGWORK/control-scout";
const FILE = join(import.meta.dirname, "search-replay.json");

const raw = execFileSync("gh", ["issue", "list", "-R", REPO, "--label", "failed-search", "--state", "closed", "--limit", "5000", "--json", "number,body,stateReason,labels"],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const issues = JSON.parse(raw) as ClosedIssue[];
// gh stops at --limit without saying so: a full page means some were cut.
if (issues.length >= 5000) throw new Error("5000 closed issues or more: raise --limit");

// A set's questions: a row's `q`, its `phrasings` (sets D, paraphrase) and its two teams' `a.q` and `b.q` (anyteam).
type EvalRow = { q?: string; phrasings?: string[]; a?: { q?: string }; b?: { q?: string } };
const questions = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as EvalRow[])
  .flatMap((x) => [x.q, ...(x.phrasings ?? []), x.a?.q, x.b?.q]).filter((q): q is string => typeof q === "string");
const sets = join(import.meta.dirname, "search-signoff", "sets");
const evalQuestions = [
  ...questions(join(import.meta.dirname, "search-heldout.json")),
  ...readdirSync(sets).filter((f) => f.endsWith(".json")).flatMap((f) => questions(join(sets, f))),
];

const before = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as ReplaySet).rows : [];
const kinds = new Map(before.map((r) => [sameQuery(r.q), r.kind]));
const set = buildSet(issues, evalQuestions, kinds, new Date().toISOString().slice(0, 10));
writeFileSync(FILE, serialize(set));
const ev = set.rows.filter((r) => r.source === "eval").length;
console.log(`${set.closed} closed issues: ${set.notPlanned} not planned, ${set.dismissed} dismissed, left out`);
console.log(`${set.rows.length} queries (${set.rows.length - ev} visitor, ${ev} eval) → ${FILE}`);
process.exit(0);
