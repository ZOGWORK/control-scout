// Which SQL queries do the hot routes run, how many, and how long each takes?
// Wraps the database client, calls each route through the real app (in-process,
// no network), and prints per-route query counts and the slowest statements
// with their EXPLAIN QUERY PLAN. Uses the local .data database.
//
//   npm run query-profile
import "../server/env.js";
import type { AddressInfo } from "node:net";

const { db, migrate } = await import("../server/db.js");
await migrate();
const client = db();
type Q = { sql: string; ms: number };
let log: Q[] = [];
const wrap = <K extends "execute" | "batch">(k: K) => {
  const orig = (client as any)[k].bind(client);
  (client as any)[k] = async (stmt: any, ...rest: any[]) => {
    const t0 = performance.now();
    try { return await orig(stmt, ...rest); } finally {
      const sql = typeof stmt === "string" ? stmt : Array.isArray(stmt) ? `[batch ${stmt.length}]` : stmt.sql;
      log.push({ sql: sql.replace(/\s+/g, " ").trim(), ms: performance.now() - t0 });
    }
  };
};
wrap("execute"); wrap("batch");

const { createApp } = await import("../server/app.js");
const server = createApp().listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const routes = ["/api/teams/4215", "/api/teams/18360", "/api/search?q=4215&limit=15", "/api/search?q=X%20Drvie&limit=15", "/api/events?season=2026", "/api/events/2025/AUBRQ2", "/api/teams/18360/matches?season=2025"];
const plans = new Map<string, string>();
for (const r of routes) {
  await fetch(base + r).then((x) => x.arrayBuffer()); // warm caches
  log = [];
  const t0 = performance.now();
  await fetch(base + r).then((x) => x.arrayBuffer());
  const total = performance.now() - t0;
  const sqlMs = log.reduce((n, q) => n + q.ms, 0);
  const byText = new Map<string, { n: number; ms: number }>();
  for (const q of log) { const k = q.sql.slice(0, 160); const e = byText.get(k) ?? { n: 0, ms: 0 }; e.n++; e.ms += q.ms; byText.set(k, e); }
  console.log(`\n${r}  ${total.toFixed(0)} ms total · ${log.length} queries · ${sqlMs.toFixed(0)} ms in SQL`);
  for (const [sql, e] of [...byText].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5)) {
    console.log(`  ${String(e.n).padStart(4)}× ${e.ms.toFixed(1).padStart(7)} ms  ${sql}`);
    if (!plans.has(sql) && /^SELECT/i.test(sql) && !sql.startsWith("[batch")) plans.set(sql, "");
  }
}
// Query plans for the statements above (with placeholder args they may not run; plan is what matters).
console.log("\nQUERY PLANS");
for (const sql of plans.keys()) {
  const full = log.find((q) => q.sql.startsWith(sql))?.sql ?? sql;
  try {
    const n = (full.match(/\?/g) ?? []).length;
    const p = await client.execute({ sql: `EXPLAIN QUERY PLAN ${full}`, args: Array(n).fill(0) });
    const lines = p.rows.map((x: any) => String(x.detail));
    if (lines.some((l) => /SCAN (?!.*USING)/.test(l) || /TEMP B-TREE/.test(l))) console.log(`\n  ${sql}\n    ${lines.join("\n    ")}`);
  } catch { /* statement needs real args; skip */ }
}
server.close();
process.exit(0);
