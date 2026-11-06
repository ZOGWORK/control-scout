// FTC One Search live sign-off (scripts/search-signoff/README.md): every query in Sets A–D, the held-out paraphrases
// and the any-team pairs, asked of the live site signed out, graded, numbers checked against the team page, and
// written up as tables by set, by family and by failure pattern.
//
//   npx tsx scripts/search-signoff/run.ts                       controlscout.org, every set
//   npx tsx scripts/search-signoff/run.ts --sets C --out C:/tmp/signoff
//   npx tsx scripts/search-signoff/run.ts --base http://localhost:8787 --par 4
//   npx tsx scripts/search-signoff/run.ts --regrade <out>/results.jsonl   grade a saved run again, asking nothing new
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crosscheck, type Check } from "./crosscheck.js";
import { fold, grade, sameAnswer, type Grade, type Live } from "./grade.js";

const arg = (f: string) => { const i = process.argv.indexOf(`--${f}`); return i > 0 ? process.argv[i + 1] : undefined; };
const BASE = (arg("base") ?? "https://controlscout.org").replace(/\/$/, "");
const SETS = (arg("sets") ?? "A,B,C,D,P,T").split(",");
const PAR = +(arg("par") ?? 6);
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const OUT = arg("out") ?? join(tmpdir(), "control-scout-signoff", STAMP);
mkdirSync(OUT, { recursive: true });
const load = <T>(f: string): T => JSON.parse(readFileSync(join(import.meta.dirname, "sets", f), "utf8"));

type Q = { set: string; id: string; q: string; expect: string; family: string; nov4?: string; nov4Note?: string; group?: string };
type Done = Q & { ms: number; res: Live | null; err?: string; g: Grade; check: Check };

// Set A's families are the kind of answer asked for; B's and C's the sections of their own files.
const FAMILY: Record<string, string> = {
  "match-find": "Match finder (place, time)", "team-match": "A team's matches", record: "Record", opr: "OPR and rating", rating: "OPR and rating",
  rank: "OPR and rating", trend: "Trends", compare: "Compare", h2h: "Head to head", predict: "Predictions", awards: "Awards", leaderboard: "Leaderboards",
  event: "Events and states", events: "Events and states", worlds: "Events and states", fact: "Team facts", count: "Counts", explain: "Explain",
  "when-last": "When", "when-next": "When", "when-first": "When", ever: "Ever / did", penalties: "Penalties", partners: "Picks and partners",
  any: "Open questions", settings: "Predictions", invalid: "Invalid (no-match card)",
};
const familyOf = (expect: string) => FAMILY[expect.split("|")[0]] ?? expect;
const bFamily = (n: string) => n.startsWith("P") ? "Predictions P1–P23" : +n <= 24 ? "Original complex 1–24" : +n <= 44 ? "Event matches 25–44" : "States 45–61";
const cFamily = (n: number) => ["Compare / OPR 1–10", "Record, streaks, matches 11–20", "Awards 21–30", "Predictions 31–40", "Leaderboards, place, time, no-answer 41–50"][Math.floor((n - 1) / 10)];

const qs: Q[] = [];
if (SETS.includes("A")) for (const x of load<{ n: number; q: string; expect: string }[]>("A.json")) qs.push({ set: "A", id: `A${x.n}`, q: x.q, expect: x.expect, family: familyOf(x.expect) });
if (SETS.includes("B")) for (const x of load<{ n: string; q: string; expect: string; nov4: string; nov4Note: string }[]>("B.json")) qs.push({ set: "B", id: `B${x.n}`, q: x.q, expect: x.expect, family: bFamily(x.n), nov4: x.nov4, nov4Note: x.nov4Note });
if (SETS.includes("C")) for (const x of load<{ n: number; q: string; expect: string }[]>("C.json")) qs.push({ set: "C", id: `C${x.n}`, q: x.q, expect: x.expect, family: cFamily(x.n) });
type Fam = { family: string; intent: string; expect: string; same?: boolean; phrasings: string[] };
const D = SETS.includes("D") ? load<Fam[]>("D.json") : [];
D.forEach((f, i) => f.phrasings.forEach((q, j) => qs.push({ set: "D", id: `D${i + 1}.${j + 1}`, q, expect: f.expect === "count" && /zzz/.test(q) ? "count|invalid" : f.expect, family: f.family, group: f.intent })));
const P = SETS.includes("P") ? load<Omit<Fam, "family">[]>("paraphrase.json") : [];
P.forEach((f, i) => f.phrasings.forEach((q, j) => qs.push({ set: "P", id: `P${i + 1}.${j + 1}`, q, expect: f.expect, family: f.intent, group: f.intent })));
type Pair = { intent: string; expect: string; a: { team: number; q: string; invalid?: boolean; region?: string }; b: { team: number; q: string; invalid?: boolean; region?: string } };
const T = SETS.includes("T") ? load<Pair[]>("anyteam.json") : [];
T.forEach((p, i) => (["a", "b"] as const).forEach((s) => qs.push({ set: "T", id: `T${i + 1}${s}`, q: p[s].q, expect: p[s].invalid ? "invalid" : p.expect, family: p.intent, group: p.intent })));

const REGRADE = arg("regrade");
const saved = new Map<string, { res: Live | null; ms: number; err?: string }>(REGRADE
  ? readFileSync(REGRADE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.q, { res: d.res, ms: d.ms, err: d.err }]) : []);

async function ask(q: string): Promise<{ res: Live | null; ms: number; err?: string }> {
  if (saved.has(q)) return saved.get(q)!;
  let err = "";
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    try {
      const r = await fetch(`${BASE}/api/search?${new URLSearchParams({ q, limit: "40", answer: "1" })}`, { headers: { "user-agent": "cs-signoff" }, signal: AbortSignal.timeout(60_000) });
      if (r.ok) return { res: (await r.json()) as Live, ms: Math.round(performance.now() - t) };
      err = `HTTP ${r.status}`;
    } catch (e) { err = String(e); }
  }
  return { res: null, ms: 0, err };
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => ({})) as { release?: string; engine?: string };
console.log(`${BASE} release ${health.release?.slice(0, 8)} · ${qs.length} queries → ${OUT}`);
const done: Done[] = [];
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < qs.length) {
    const x = qs[next++];
    const { res, ms, err } = await ask(x.q);
    // "or" in an expectation lets a zero case be a count card or a no-match card.
    const g = x.expect.endsWith("|invalid") ? (() => { const a = grade(x.q, x.expect.replace(/\|invalid$/, ""), res, err); return a.verdict === "pass" ? a : grade(x.q, "invalid", res, err); })() : grade(x.q, x.expect, res, err);
    const check = res && g.verdict === "pass" ? await crosscheck(BASE, res) : { compared: false, ok: true, note: "" };
    if (!check.ok) Object.assign(g, { verdict: "fail", pattern: "numbers differ from the team page", missing: check.note });
    done.push({ ...x, ms, res, err, g, check });
    if (done.length % 50 === 0) console.log(`  ${done.length}/${qs.length}`);
  }
}));
const order = new Map(qs.map((x, i) => [x.id, i]));
done.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
writeFileSync(join(OUT, "results.jsonl"), done.map((d) => JSON.stringify({ ...d, res: d.res })).join("\n") + "\n");

// The report: tables first, then every failure by pattern.
const md: string[] = [];
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");
const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const tally = (xs: Done[]) => {
  const inv = xs.filter((d) => d.g.invalid && d.g.verdict === "pass").length, pass = xs.filter((d) => !d.g.invalid && d.g.verdict === "pass").length;
  return { total: xs.length, pass, fail: xs.length - pass - inv, inv, rate: pct(pass + inv, xs.length) };
};
md.push(`Live: ${BASE} · release ${health.release ?? "?"} · engine ${health.engine ?? "?"} · run ${new Date().toISOString()} · signed out`, "");
const SETNAME: Record<string, string> = { A: "A — 200 unique", B: "B — 61 complex + P1–P23", C: "C — 50 core", D: "D — natural questions", P: "Held-out paraphrases", T: "Any-team pairs" };
md.push("## By set", "", row(["Set", "Total", "Pass", "Fail", "Invalid (clear no-match)", "Pass rate"]), row(["---", "---:", "---:", "---:", "---:", "---:"]));
for (const s of SETS) { const t = tally(done.filter((d) => d.set === s)); if (t.total) md.push(row([SETNAME[s], t.total, t.pass, t.fail, t.inv, t.rate])); }
const all = tally(done.filter((d) => "ABCD".includes(d.set)));
md.push(row(["Full set (A+B+C+D)", all.total, all.pass, all.fail, all.inv, all.rate]), "");

for (const s of SETS.filter((x) => "ABCD".includes(x))) {
  const xs = done.filter((d) => d.set === s);
  md.push(`## Set ${SETNAME[s]}: by family`, "", row(["Family", "Total", "Pass", "Fail", "Invalid", "Pass rate", "Failure patterns"]), row(["---", "---:", "---:", "---:", "---:", "---:", "---"]));
  for (const f of [...new Set(xs.map((d) => d.family))]) {
    const of = xs.filter((d) => d.family === f), t = tally(of);
    const pats = new Map<string, number>();
    for (const d of of) if (d.g.verdict === "fail") pats.set(d.g.pattern, (pats.get(d.g.pattern) ?? 0) + 1);
    md.push(row([f, t.total, t.pass, t.fail, t.inv, t.rate, [...pats].map(([p, n]) => `${p} ×${n}`).join("; ") || "–"]));
  }
  md.push("");
}

const fails = done.filter((d) => d.g.verdict === "fail" && "ABCD".includes(d.set));
const byPattern = new Map<string, Done[]>();
for (const d of fails) (byPattern.get(d.g.pattern) ?? byPattern.set(d.g.pattern, []).get(d.g.pattern)!).push(d);
md.push("## Failures by pattern", "", row(["Pattern", "Count", "Sets"]), row(["---", "---:", "---"]));
for (const [p, xs] of [...byPattern].sort((a, b) => b[1].length - a[1].length)) md.push(row([p, xs.length, [...new Set(xs.map((d) => d.set))].join(" ")]));
md.push("");
for (const [p, xs] of [...byPattern].sort((a, b) => b[1].length - a[1].length)) {
  md.push(`### ${p} (${xs.length})`, "", row(["#", "Query", "Card it got", "Missing"]), row(["---", "---", "---", "---"]));
  for (const d of xs) md.push(row([d.id, esc(d.q), esc(d.g.card), esc(d.g.missing)]));
  md.push("");
}

md.push("## Invalid queries", "", row(["#", "Query", "Result", "Card"]), row(["---", "---", "---", "---"]));
for (const d of done.filter((x) => x.expect.includes("invalid"))) md.push(row([d.id, esc(d.q), d.g.verdict === "pass" ? "clear no-match card" : `FAIL: ${d.g.pattern}`, esc(d.g.card)]));
md.push("");

if (SETS.includes("B")) {
  md.push("## Set B against the Nov 4 baseline", "", row(["#", "Query", "Nov 4", "Now", "Card now"]), row(["---", "---", "---", "---", "---"]));
  for (const d of done.filter((x) => x.set === "B")) md.push(row([d.id, esc(d.q), d.nov4 ?? "", d.g.verdict === "pass" ? (d.g.invalid ? "INVALID (clear card)" : "PASS") : `FAIL (${d.g.pattern})`, esc(d.g.card)]));
  md.push("");
}

// Same intent, said several ways: the same card with the same number, unless the family says its phrasings differ.
const consistency = (set: string, groups: { intent: string; same?: boolean }[]) => {
  md.push(row(["Intent", "Phrasings", "Pass", "Same card + number", "Failing phrasings"]), row(["---", "---:", "---:", "---", "---"]));
  for (const f of groups) {
    const xs = done.filter((d) => d.set === set && d.group === f.intent);
    const pass = xs.filter((d) => d.g.verdict === "pass");
    const same = f.same === false ? "n/a (different questions)" : xs.every((d) => sameAnswer(d.res, xs[0].res)) ? "yes" : "NO";
    md.push(row([f.intent, xs.length, pass.length, same, xs.filter((d) => d.g.verdict === "fail").map((d) => `${esc(d.q)} → ${d.g.pattern}`).join("; ") || "–"]));
  }
  md.push("");
};
if (D.length) { md.push("## Set D: each family said 5+ ways", ""); consistency("D", D); }
if (P.length) { md.push("## Held-out paraphrases (not in any list)", ""); consistency("P", P); }
if (T.length) {
  md.push("## Any-team check", "", row(["Intent", "Team A query", "A", "Team B query", "B", "Notes"]), row(["---", "---", "---", "---", "---", "---"]));
  T.forEach((p, i) => {
    const a = done.find((d) => d.id === `T${i + 1}a`)!, b = done.find((d) => d.id === `T${i + 1}b`)!;
    const note: string[] = [];
    for (const [d, s] of [[a, p.a], [b, p.b]] as const) {
      const t = d.res?.stat?.team?.number;
      if (t != null && t !== s.team && !d.res?.stat?.teams?.some((x) => x.number === s.team)) { d.g.verdict = "fail"; note.push(`${s.team}: answered for ${t}`); }
      // A team's own region: a Romanian team's "states" is never an NJ event.
      if (s.region && /new jersey|\bnj\b/.test(fold(JSON.stringify(d.res?.stat?.scope ?? "")))) { d.g.verdict = "fail"; note.push(`${s.team}: NJ default`); }
    }
    md.push(row([p.intent, esc(p.a.q), a.g.verdict === "pass" ? "pass" : `FAIL (${a.g.pattern})`, esc(p.b.q), b.g.verdict === "pass" ? "pass" : `FAIL (${b.g.pattern})`, note.join("; ") || esc(b.g.card).slice(0, 90)]));
  });
  md.push("");
}

const compared = done.filter((d) => d.check.compared);
md.push("## Numbers against the live team page", "", `${compared.length} headline numbers compared, ${compared.filter((d) => !d.check.ok).length} differ.`, "");
for (const d of compared.filter((x) => !x.check.ok)) md.push(`- ${d.id} "${d.q}": ${d.check.note}`);
const ms = done.map((d) => d.ms).sort((a, b) => a - b);
md.push("", `Answer time (this runner, ${PAR} at once): median ${ms[Math.floor(ms.length / 2)]} ms, p95 ${ms[Math.floor(ms.length * 0.95)]} ms, slowest ${ms.at(-1)} ms.`);

writeFileSync(join(OUT, "report.md"), md.join("\n") + "\n");
console.log(md.slice(0, 12).join("\n"));
console.log(`\nreport: ${join(OUT, "report.md")}`);
