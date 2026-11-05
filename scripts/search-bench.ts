// FTC One Search's latency benchmark: every query in scripts/search-bench/queries.txt (the 260 list, the complex
// queries, misspellings) asked once each of a running server's /api/search?answer=1, as the header's search asks it.
// Prints p50, p95, p99 and max per group and overall, and the slowest queries. With --out it writes each answer's
// reading (step, did you mean, what it understood, its card or stat, its first results, and a hash of the whole
// answer) as JSON lines; with --compare it checks a run against one written before, so a speed change can show it
// answers every query exactly as before.
//   npx tsx scripts/search-bench.ts --base http://127.0.0.1:3000 --out before.jsonl
//   npx tsx scripts/search-bench.ts --base http://127.0.0.1:3000 --compare before.jsonl
//   npx tsx scripts/search-bench.ts --base https://controlscout.org --sample 20     (read-only spot check)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { SearchAnswer } from "../src/shared/api.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (arg("--base") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const sample = Number(arg("--sample") ?? 0);
const only = arg("--only");

type Q = { group: string; q: string };
let group = "";
let qs: Q[] = [];
for (const line of readFileSync(new URL("./search-bench/queries.txt", import.meta.url), "utf8").split(/\r?\n/)) {
  if (line.startsWith("## ")) group = line.slice(3).trim();
  else if (line.trim() && !line.startsWith("#")) qs.push({ group, q: line.trim() });
}
if (only) qs = qs.filter((x) => x.group === only);
// An even spread across the list, the same every run.
if (sample > 0 && sample < qs.length) qs = Array.from({ length: sample }, (_, i) => qs[Math.floor((i * qs.length) / sample)]);

/** What an answer read the query as: the parts a person sees first, and a hash of all of it. */
function reading(a: SearchAnswer) {
  return {
    step: a.step,
    didYouMean: a.didYouMean ?? null,
    understood: a.understood?.label ?? null,
    intent: a.intent ? JSON.stringify(a.intent) : null,
    card: a.card ? `${a.card.kind}: ${a.card.title}` : null,
    stat: a.stat ? JSON.stringify(a.stat).slice(0, 200) : null,
    hits: a.hits.slice(0, 5).map((h) => `${h.kind}:${h.ref}`),
    hash: createHash("sha1").update(JSON.stringify(a)).digest("hex").slice(0, 12),
  };
}

const rows: { group: string; q: string; ms: number; status: number; reading?: ReturnType<typeof reading> }[] = [];
for (const { group, q } of qs) {
  const t = performance.now();
  let status = 0, body: SearchAnswer | null = null;
  try {
    const res = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}&limit=25&answer=1`);
    status = res.status;
    if (res.ok) body = (await res.json()) as SearchAnswer;
    else await res.arrayBuffer();
  } catch { status = -1; }
  rows.push({ group, q, ms: performance.now() - t, status, ...(body ? { reading: reading(body) } : {}) });
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0; };
const line = (name: string, xs: number[]) =>
  console.log(`${name.padEnd(12)} n=${String(xs.length).padStart(3)}  p50 ${pct(xs, 50).toFixed(0).padStart(5)} ms  p95 ${pct(xs, 95).toFixed(0).padStart(5)} ms  p99 ${pct(xs, 99).toFixed(0).padStart(5)} ms  max ${Math.max(...xs).toFixed(0).padStart(5)} ms`);
for (const g of [...new Set(rows.map((r) => r.group))]) line(g, rows.filter((r) => r.group === g).map((r) => r.ms));
line("all", rows.map((r) => r.ms));
console.log("slowest:");
for (const r of [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10)) console.log(`  ${r.ms.toFixed(0).padStart(5)} ms  ${r.q}`);
const failed = rows.filter((r) => r.status !== 200);
// A failed request is a failed run: its time and answer are missing from what was measured.
if (failed.length) { console.log(`${failed.length} failed: ${failed.map((r) => `${r.q} (${r.status})`).join(", ")}`); process.exitCode = 1; }

const out = arg("--out");
if (out) writeFileSync(out, rows.map((r) => JSON.stringify({ q: r.q, ...r.reading })).join("\n") + "\n");
const before = arg("--compare");
if (before) {
  const was = new Map(readFileSync(before, "utf8").split("\n").filter(Boolean).map((l) => { const o = JSON.parse(l); return [o.q as string, o]; }));
  let changed = 0;
  // A query the earlier run lacks (or one that failed either time) was never compared: the check is incomplete.
  const missing = rows.filter((r) => !was.has(r.q) || !r.reading).map((r) => r.q);
  for (const r of rows) {
    const a = was.get(r.q);
    if (!a || !r.reading) continue;
    const now = { q: r.q, ...r.reading };
    if (JSON.stringify(a) === JSON.stringify(now)) continue;
    changed++;
    const keys = Object.keys({ ...a, ...now }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify((now as Record<string, unknown>)[k]));
    console.log(`CHANGED ${JSON.stringify(r.q)}: ${keys.map((k) => `${k} ${JSON.stringify(a[k])} → ${JSON.stringify((now as Record<string, unknown>)[k])}`).join("; ")}`);
  }
  console.log(`${changed} of ${rows.length - missing.length} answers compared changed`);
  if (missing.length) console.log(`NOT COMPARED: ${missing.length} (not in ${before}, or no answer this run): ${missing.slice(0, 10).map((q) => JSON.stringify(q)).join(", ")}${missing.length > 10 ? ", …" : ""}`);
  if (changed || missing.length) process.exitCode = 1;
}
