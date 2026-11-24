// The replay set (scripts/search-replay.ts): every query of a closed `failed-search` issue, asked again. These are the
// pure parts, tested on their own: reading an issue's queries, which issues count, and the pass rate's floor.
//   scripts/search-replay-build.ts  writes scripts/search-replay.json from the closed issues (gh)
//   scripts/search-replay.ts        asks each query again and fails below the floor

/** An issue as `gh issue list --json number,body,stateReason,labels` gives it. */
export interface ClosedIssue { number: number; body: string; stateReason: string | null; labels: { name: string }[] }

/** One query to replay: the issue it was filed on (the newest, when two issues hold it), as typed (redacted, as the
 *  issue holds it), the result type it was filed with, and whether it's one of our own eval questions. */
export interface ReplayRow {
  issue: number;
  q: string;
  /** The result type the issue was filed with ("no-match", "team-fallback", …). */
  filed: string;
  /** "eval": the query is word for word a question of scripts/search-heldout.json or scripts/search-signoff/sets, so it
   *  was our own test traffic; "visitor": anyone else's. */
  source: "visitor" | "eval";
  /** What it got when the set was last recorded (search:replay -- --write): the answer's kind when answered
   *  ("stat:<family>/<intent>", "card:<kind>", "verdict", "events", …), "fail:<type>" when it failed. null: not yet. */
  kind: string | null;
}

export interface ReplaySet { built: string; closed: number; notPlanned: number; dismissed: number; rows: ReplayRow[] }

/** The queries an issue body lists: the first fenced block under "### Query as typed" (one query) or "### Queries that
 *  failed this way" (a pattern's latest variants), one per line (server/searchFailures.ts failureBody). */
export function queriesOf(body: string): string[] {
  const m = /^### (?:Query as typed|Queries that failed this way)[^\n]*\r?\n(`{3,})[^\n]*\r?\n([\s\S]*?)\r?\n\1/m.exec(body);
  return m ? m[2].split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}

/** The result type an issue was filed with (its body's "**Result type:**" line). */
export const filedType = (body: string) => /\*\*Result type:\*\* *([\w-]+)/.exec(body)?.[1] ?? "unknown";

/** Same words, same query: case, spacing and the ends ignored. */
export const sameQuery = (q: string) => q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Why a closed issue is left out of the set, or null when it's in: closed as not planned (or as a duplicate, which
 *  says nothing about the query answering either; counted with them), or labelled `dismissed` (not worth fixing: it
 *  stays closed, so failing again says nothing). Only closed as completed is in. */
export function leftOut(i: ClosedIssue): "not-planned" | "dismissed" | null {
  if (i.stateReason === "NOT_PLANNED" || i.stateReason === "DUPLICATE") return "not-planned";
  if (i.labels.some((l) => l.name === "dismissed")) return "dismissed";
  return null;
}

/** The set from the closed issues. A query held by two issues is one row, under the newest issue; when the newest is
 *  left out, so is the query (its latest word is "not worth fixing"). `kinds`: the kind each query got when last
 *  recorded (kept across a rebuild). */
export function buildSet(issues: ClosedIssue[], evalQuestions: Iterable<string>, kinds: Map<string, string | null>, built: string): ReplaySet {
  const ev = new Set([...evalQuestions].map(sameQuery));
  const rows = new Map<string, ReplayRow>();
  const seen = new Set<string>();
  let notPlanned = 0, dismissed = 0;
  for (const i of [...issues].sort((a, b) => b.number - a.number)) {
    const out = leftOut(i);
    if (out === "not-planned") notPlanned++;
    if (out === "dismissed") dismissed++;
    for (const q of queriesOf(i.body)) {
      const k = sameQuery(q);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!out) rows.set(k, { issue: i.number, q, filed: filedType(i.body), source: ev.has(k) ? "eval" : "visitor", kind: kinds.get(k) ?? null });
    }
  }
  return { built, closed: issues.length, notPlanned, dismissed, rows: [...rows.values()].sort((a, b) => a.issue - b.issue || a.q.localeCompare(b.q)) };
}

/** The file as written: one row a line, so a rebuild's diff is the rows that changed. */
export function serialize(s: ReplaySet): string {
  const { rows, ...head } = s;
  return `${JSON.stringify(head).slice(0, -1)},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
}

/** The pass rate in percent (100 for none asked). */
export const rate = (passed: number, of: number) => (of ? (100 * passed) / of : 100);
