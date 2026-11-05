// Searches, in process, timed: each query given is answered once to warm what a running server holds warm, then
// REPS more times (default 3), printing the fastest and slowest of those and the SQL statements one answer ran (count
// and time, slowest first). SQL_SLOW=<ms> prints each statement slower than that with its arguments. Run under
// --cpu-prof for where the rest goes. Uses the database DATABASE_URL names (the local .data one by default).
//   npx tsx scripts/search-profile.ts "4215 lasetest matches" "hypnotc robotics"
//   node --import tsx --cpu-prof --cpu-prof-dir=<dir> scripts/search-profile.ts "<query>"
import "../server/env.js";

const { db, migrate } = await import("../server/db.js");
await migrate();
const client = db() as unknown as { execute: (stmt: string | { sql: string; args?: unknown }, ...rest: unknown[]) => Promise<unknown> };
let sqlMs = 0, sqlN = 0;
const slow = new Map<string, { n: number; ms: number }>();
const orig = client.execute.bind(client);
client.execute = async (stmt, ...rest) => {
  const t = performance.now();
  try { return await orig(stmt, ...rest); } finally {
    const ms = performance.now() - t;
    sqlMs += ms; sqlN++;
    const text = typeof stmt === "string" ? stmt : stmt.sql;
    const sql = text.replace(/\s+/g, " ").slice(0, 140);
    const s = slow.get(sql) ?? { n: 0, ms: 0 };
    slow.set(sql, { n: s.n + 1, ms: s.ms + ms });
    if (process.env.SQL_SLOW && ms > Number(process.env.SQL_SLOW)) console.log(`  slow ${ms.toFixed(0)} ms: ${text} ${JSON.stringify(typeof stmt === "string" ? rest[0] : stmt.args)}`);
  }
};
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { ensureSearchIndex } = await import("../server/api/search.js");
const { rebuildSearch } = await import("../server/stats/job.js");
const { warmSpelling } = await import("../server/api/spelling.js");
await ensureSearchIndex(rebuildSearch);
await warmSpelling();
const reps = Number(process.env.REPS ?? 3);
for (const q of process.argv.slice(2)) {
  await searchAnswer(q, { limit: 25, learn: false });
  const times: number[] = [];
  let a: Awaited<ReturnType<typeof searchAnswer>> | null = null;
  for (let i = 0; i < reps; i++) {
    sqlMs = 0; sqlN = 0; slow.clear();
    const t = performance.now();
    a = await searchAnswer(q, { limit: 25, learn: false });
    times.push(performance.now() - t);
  }
  console.log(`${Math.min(...times).toFixed(0)}–${Math.max(...times).toFixed(0)} ms  ${q}  → ${a!.step}${a!.didYouMean ? ` (did you mean ${a!.didYouMean})` : ""}  · SQL ${sqlN} statements, ${sqlMs.toFixed(0)} ms`);
  for (const [sql, s] of [...slow].sort((x, y) => y[1].ms - x[1].ms).slice(0, 6)) console.log(`    ${s.ms.toFixed(0).padStart(5)} ms ×${s.n}  ${sql}`);
}
process.exit(0);
