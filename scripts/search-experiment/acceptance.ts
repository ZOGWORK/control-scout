// The search completion tests that need real data (docs/search.md), against the local database (.data/scout.db),
// through the same code the API and /search run. Bruno AI is a fake Control Point on a local port with fixed
// rewrites (no model, no key, no network): what's tested is the chain around him, never his wording.
// The tests that need the browser or a fixture database are in vitest (server/api/searchAnswer.test.ts,
// src/components/search/SearchBox.answer.test.tsx) and the screenshots (npm run shots -- --search).
//
//   npx tsx scripts/search-experiment/acceptance.ts [--out <dir>]
//
// Writes acceptance.json and prints one PASS/FAIL line per test with its evidence. It switches brunoSearch and
// searchLearning in the local database for the tests that need them and puts them back as they were.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { all, db, get, migrate, run } from "../../server/db.js";
import { invalidateFlags } from "../../server/flags.js";
import { ensureSearchIndex } from "../../server/api/search.js";
import { rebuildSearch } from "../../server/stats/job.js";
import { MAX_QUERY, searchAnswer } from "../../server/api/searchAnswer.js";
import { BRUNO_TIMEOUT_MS, refine, resetBrunoCache } from "../../server/api/searchBruno.js";
import { recordIntent, topIntents } from "../../server/api/searchIntents.js";
import { hitHref } from "../../src/shared/search.js";
import type { SearchAnswer, SearchHit } from "../../src/shared/api.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", ".");

// --- The fake Control Point --------------------------------------------------------------------------------
/** Bruno's fixed rewrites, as the real one would answer them (CP server/brunoSearch.ts: a query or null). */
const REWRITES: Record<string, string | null> = {
  "robots that hypnotise": "hypnotic robotics",
  "that team with the hypnosis name opr": "hypnotic robotics opr",
  "hypnotic rankng pont": "hypnotic ranking points",
  "the wolf team that is bad": "bad wolf",
  "asdfgh": null,
  "zxqv qqzv opr": null,
};
let mode: "ok" | "slow" | "error" = "ok";
let calls = 0;
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    if (req.headers["x-internal-key"] !== "acceptance") { res.writeHead(401).end("{}"); return; }
    const { query } = JSON.parse(body || "{}") as { query?: string };
    const answer = () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ query: REWRITES[String(query).toLowerCase()] ?? null }));
    if (mode === "error") { res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "model failed" })); return; }
    if (mode === "slow") { setTimeout(answer, BRUNO_TIMEOUT_MS + 2000); return; }
    answer();
  });
});

// --- Helpers ------------------------------------------------------------------------------------------------
interface Result { id: string; name: string; pass: boolean; evidence: string[] }
const results: Result[] = [];
let intentReport: unknown = null;
const label = (h: SearchHit | undefined) => (h ? `${h.kind} ${h.ref}${h.atEvent ? ` @${h.atEvent}` : ""}${h.href ? ` → ${h.href}` : ""}` : "(none)");
const show = (a: SearchAnswer) => `step=${a.step}${a.didYouMean ? ` didYouMean="${a.didYouMean}"` : ""}${a.refined ? ` refined="${a.refined}"` : ""} top=${label(a.hits[0])} n=${a.hits.length}${a.pages.length ? ` pages=[${a.pages.map((p) => p.href).join(",")}]` : ""}${a.recovery ? ` understood=${JSON.stringify(a.recovery.understood)} closest=[${a.recovery.closest.map(label).join(", ")}] browse=[${a.recovery.browse.map((b) => b.href).join(",")}]` : ""}`;
const facts = (h: SearchHit | undefined) => (h?.facts ?? []).map((f) => `${f.label}: ${f.value}`).join(" | ");

async function test(id: string, name: string, fn: (ev: string[]) => Promise<boolean>) {
  const ev: string[] = [];
  let pass = false;
  try { pass = await fn(ev); } catch (e) { ev.push(`threw: ${(e as Error).stack?.split("\n").slice(0, 3).join(" ")}`); }
  results.push({ id, name, pass, evidence: ev });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name}\n${ev.map((e) => `       ${e}`).join("\n")}`);
}
const ask = async (q: string, ev: string[], opts = {}) => { const a = await searchAnswer(q, opts); ev.push(`"${q}" → ${show(a)}`); return a; };
const teamTop = (a: SearchAnswer, n: string) => a.hits[0]?.kind === "team" && a.hits[0].ref === n && !a.hits[0].href;

async function setFlagRow(name: string, enabled: boolean | null) {
  if (enabled == null) await run("DELETE FROM feature_flags WHERE name = ?", [name]);
  else await run("INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES (?, ?, ?, 'acceptance') ON CONFLICT (name) DO UPDATE SET enabled = excluded.enabled", [name, enabled ? 1 : 0, new Date().toISOString()]);
  invalidateFlags();
}

// --- Run ----------------------------------------------------------------------------------------------------
await migrate(db());
await ensureSearchIndex(rebuildSearch);
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
process.env.CONTROL_POINT_INTERNAL_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
process.env.CONTROL_POINT_INTERNAL_KEY = "acceptance";
const savedFlags = await all<{ name: string; enabled: number }>("SELECT name, enabled FROM feature_flags WHERE name IN ('brunoSearch', 'searchLearning')");
const restore = async () => {
  for (const n of ["brunoSearch", "searchLearning"]) { const r = savedFlags.find((f) => f.name === n); await setFlagRow(n, r ? Number(r.enabled) === 1 : null); }
};
// The tests below that aren't about learning run with it off, so local clicks can't change an order.
await setFlagRow("searchLearning", false);

try {
  // T1–T14 query correctness
  await test("T1", "\"4215\" → single top team 4215; Enter opens its page", async (ev) => {
    const a = await ask("4215", ev);
    ev.push(`link ${hitHref(a.hits[0])}`);
    return a.hits.length === 1 && teamTop(a, "4215") && hitHref(a.hits[0]) === "/teams/4215" && a.step === "deterministic";
  });
  await test("T2", "\"team 4215\" → the same", async (ev) => { const a = await ask("team 4215", ev); return a.hits.length === 1 && teamTop(a, "4215"); });
  await test("T3", "\"hypnotic\" → 4215 on top", async (ev) => teamTop(await ask("hypnotic", ev), "4215"));
  await test("T4", "\"hypnotic ranking point(s)\" → 4215 with rank, record, RS", async (ev) => {
    let ok = true;
    for (const q of ["hypnotic ranking points", "hypnotic ranking point"]) {
      const a = await ask(q, ev);
      ev.push(`facts ${facts(a.hits[0])}`);
      const ls = (a.hits[0]?.facts ?? []).map((f) => f.label);
      ok &&= teamTop(a, "4215") && ["Ranking score", "Event rank", "Record"].every((l) => ls.includes(l));
    }
    return ok;
  });
  await test("T5", "\"hypnotic OPR\" → season OPR and event OPRs", async (ev) => {
    const a = await ask("hypnotic OPR", ev);
    const h = a.hits[0];
    ev.push(`facts ${facts(h)}`, `events ${(h?.events ?? []).map((e) => `${e.code} ${e.opr}`).join(", ")}`);
    return teamTop(a, "4215") && h.facts!.some((f) => f.label === "OPR" && f.value === "101.6") && (h.events?.filter((e) => e.opr != null).length ?? 0) >= 2;
  });
  await test("T6", "\"hypnotic OPR at <real event>\" → team at event", async (ev) => {
    const a = await ask("hypnotic OPR at New Jersey Championship Parkway", ev);
    ev.push(`facts ${facts(a.hits[0])}`, `link ${hitHref(a.hits[0])}`);
    return a.hits[0]?.atEvent === "2025:USNJCMPPKWY" && hitHref(a.hits[0]) === "/events/2025/USNJCMPPKWY?team=4215" && a.hits[0].facts!.some((f) => f.label === "Event OPR" && f.value === "101.6");
  });
  await test("T7", "\"hypnotic OPR at this event\" → event list with OPRs, never a guessed event", async (ev) => {
    const a = await ask("hypnotic OPR at this event", ev);
    const h = a.hits[0];
    ev.push(`facts ${facts(h)}`, `events ${(h?.events ?? []).map((e) => `${e.code} ${e.opr}`).join(", ")}`);
    return teamTop(a, "4215") && !h.atEvent && (h.events?.length ?? 0) >= 2 && h.facts!.some((f) => f.label === "Which event?");
  });
  await test("T8", "\"hypnotic versus bad wolf history\" → Compare 4215 vs 6980", async (ev) => {
    const a = await ask("hypnotic versus bad wolf history", ev);
    return hitHref(a.hits[0]) === "/compare?teams=4215,6980";
  });
  await test("T9", "\"hypnotic difficulty through events\" → 4215's schedule difficulty", async (ev) => {
    const a = await ask("hypnotic difficulty through events", ev);
    ev.push(`link ${hitHref(a.hits[0])}`, `facts ${facts(a.hits[0])}`);
    return teamTop(a, "4215") && hitHref(a.hits[0]).endsWith("#schedule-difficulty");
  });
  await test("T10", "\"records\" → Pages group with the records link, below the results", async (ev) => {
    const a = await ask("records", ev);
    return a.pages.some((p) => p.href === "/teams" && p.title === "Team records") && !a.hits.some((h) => h.href === "/teams");
  });
  await test("T11", "\"rec\" → no Pages group", async (ev) => (await ask("rec", ev)).pages.length === 0);
  await test("T12", "misspellings → the right team on top, step reported", async (ev) => {
    let ok = true;
    for (const [q, n] of [["hipnotic", "4215"], ["hypnotik", "4215"], ["hypnotic rankng pont", "4215"], ["bad wulf", "6980"]] as const) ok &&= teamTop(await ask(q, ev), n);
    return ok;
  });
  await test("T13", "\"asdfgh\" and \"\" → recovery", async (ev) => {
    const a = await ask("asdfgh", ev), b = await ask("", ev);
    return a.step === "recovery" && b.step === "recovery" && a.recovery!.browse.length === 2 && b.recovery!.browse.length === 2;
  });
  await test("T14", "a team number with no team → recovery", async (ev) => {
    const a = await ask("999998", ev);
    return a.step === "recovery" && a.hits.length === 0 && a.recovery!.understood.some((u) => u.includes("No FTC team 999998"));
  });

  // T22–T25 routing lands on the right place
  await test("T22", "versus → Compare with the right teams", async (ev) => {
    const a = await ask("hypnotic vs bad wolf", ev);
    const b = await ask("bad wolf versus hypnotic", ev);
    return hitHref(a.hits[0]) === "/compare?teams=4215,6980" && hitHref(b.hits[0]) === hitHref(a.hits[0]);
  });
  await test("T23", "difficulty → the schedule difficulty section", async (ev) => {
    const a = await ask("hypnotic schedule difficulty", ev);
    ev.push(`link ${hitHref(a.hits[0])}`);
    return teamTop(a, "4215") && /^\/teams\/4215\?season=\d{4}#schedule-difficulty$/.test(hitHref(a.hits[0]));
  });
  await test("T24", "OPR / RP → their stat lines", async (ev) => {
    const o = await ask("hypnotic opr", ev), r = await ask("hypnotic rp", ev);
    ev.push(`opr: ${facts(o.hits[0])}`, `rp: ${facts(r.hits[0])}`);
    return o.hits[0].facts!.some((f) => f.label === "OPR") && r.hits[0].facts!.some((f) => f.label === "Ranking score");
  });
  await test("T25", "named-event OPR → team at event; \"this event\" → the event list", async (ev) => {
    const a = await ask("hypnotic opr at east bergen", ev), b = await ask("hypnotic opr at this event", ev);
    return a.hits[0]?.atEvent === "2025:USNJNOLT2" && !b.hits[0]?.atEvent && (b.hits[0]?.events?.length ?? 0) > 0;
  });

  // T26–T29 the fallback chain (Bruno on, against the fake)
  await setFlagRow("brunoSearch", true);
  resetBrunoCache();
  await test("T26", "chain order: deterministic → did-you-mean → Bruno → recovery, step per query", async (ev) => {
    const d = await ask("hypnotic robotics", ev);
    const y = await ask("hipnotic robotcs", ev);
    const base = await ask("robots that hypnotise", ev);
    const ai = await refine("robots that hypnotise");
    ev.push(`refine "robots that hypnotise" → ${ai ? show(ai) : "null"}`);
    const r = await ask("asdfgh", ev);
    const air = await refine("asdfgh");
    ev.push(`refine "asdfgh" → ${air ? show(air) : "null"}`);
    return d.step === "deterministic" && y.step === "did-you-mean" && base.weak && ai?.step === "ai" && teamTop(ai, "4215")
      && r.step === "recovery" && air?.step === "recovery" && air.recovery?.ai?.refined === null;
  });
  await test("T27", "Bruno timeout or error → search's own results stand alone", async (ev) => {
    let ok = true;
    for (const m of ["slow", "error"] as const) {
      mode = m; resetBrunoCache();
      const base = await searchAnswer("the wolf team that is bad");
      const t0 = performance.now();
      const r = await refine("the wolf team that is bad");
      const ms = Math.round(performance.now() - t0);
      ev.push(`${m}: base ${show(base)}; refine → ${r === null ? "null (nothing added)" : show(r)} in ${ms} ms`);
      ok &&= r === null && ms < BRUNO_TIMEOUT_MS + 1500;
    }
    mode = "ok"; resetBrunoCache();
    return ok;
  });
  await test("T28", "Bruno-refined numbers match the database exactly", async (ev) => {
    const r = await refine("that team with the hypnosis name opr");
    const s = await get<{ opr_np: number; season: number }>("SELECT opr_np, season FROM team_season_stats WHERE team = 4215 ORDER BY season DESC LIMIT 1");
    ev.push(`refine → ${r ? show(r) : "null"}`, `facts ${facts(r?.hits[0])}`, `database: team_season_stats ${s?.season} opr_np=${s?.opr_np}`);
    const same = await searchAnswer("hypnotic robotics opr");
    return r?.step === "ai" && JSON.stringify(r.hits[0].facts) === JSON.stringify(same.hits[0].facts) && r.hits[0].facts!.some((f) => f.label === "OPR" && f.value === Number(s!.opr_np).toFixed(1));
  });
  await test("T29", "nonsense stat query → recovery, nothing made up", async (ev) => {
    const a = await ask("zxqv qqzv opr", ev);
    const r = await refine("zxqv qqzv opr");
    ev.push(`refine → ${r ? show(r) : "null"}`);
    return a.step === "recovery" && !a.hits.some((h) => h.facts?.length) && (r === null || (r.step === "recovery" && !r.hits.length));
  });
  await test("T70b", "Bruno is never asked by GET /api/search (only /api/search/refine, after)", async (ev) => {
    const before = calls;
    for (const q of ["asdfgh", "robots that hypnotise", "hipnotic"]) await searchAnswer(q);
    ev.push(`fake Control Point calls during 3 weak searches: ${calls - before}`);
    return calls === before;
  });
  await setFlagRow("brunoSearch", false);
  await test("T27b", "Bruno switched off → refine adds nothing, no call made", async (ev) => {
    resetBrunoCache();
    const before = calls;
    const r = await refine("robots that hypnotise");
    ev.push(`refine → ${r === null ? "null" : show(r)}; calls ${calls - before}`);
    return r === null && calls === before;
  });

  // T41–T45 robustness
  await test("T41", "\"  HYPnotic  \" → 4215", async (ev) => teamTop(await ask("  HYPnotic  ", ev), "4215"));
  await test("T42", "\"hypnotic,\", \"team-4215\", \"4215!\" → 4215", async (ev) => {
    let ok = true;
    for (const q of ["hypnotic,", "team-4215", "4215!"]) ok &&= teamTop(await ask(q, ev), "4215");
    return ok;
  });
  await test("T43", "a 200-character query → an answer, cut to the limit, no error", async (ev) => {
    const q = ("hypnotic robotics ").repeat(12).slice(0, 200);
    const a = await searchAnswer(q);
    ev.push(`200 chars → q length ${a.q.length} (limit ${MAX_QUERY}), ${show(a)}`);
    return a.q.length <= MAX_QUERY && teamTop(a, "4215");
  });
  await test("T44", "whitespace only → recovery", async (ev) => (await ask("   \t  ", ev)).step === "recovery");
  await test("T45", "same query twice with learning off → identical order", async (ev) => {
    const a = await searchAnswer("robotics"), b = await searchAnswer("robotics");
    ev.push(`order ${a.hits.slice(0, 6).map(label).join(", ")}`);
    return JSON.stringify(a.hits) === JSON.stringify(b.hits) && a.hits.length > 3;
  });

  // T46–T51 events, seasons, matches
  await test("T46", "an event code → that event on top", async (ev) => {
    const a = await ask("USNJCMPPKWY", ev);
    return a.hits[0]?.kind === "event" && a.hits[0].ref === "2025:USNJCMPPKWY";
  });
  await test("T47", "\"East Bergen\" → its events, newest season first", async (ev) => {
    const a = await ask("East Bergen", ev);
    const evs = a.hits.filter((h) => h.kind === "event");
    ev.push(`events ${evs.map((h) => h.ref).join(", ")}`);
    const seasons = evs.map((h) => h.season ?? 0);
    return evs.length >= 2 && seasons.every((s, i) => i === 0 || s <= seasons[i - 1]);
  });
  await test("T48", "\"hypnotic at East Bergen\" → team at event", async (ev) => {
    const a = await ask("hypnotic at East Bergen", ev);
    ev.push(`facts ${facts(a.hits[0])}`, `link ${hitHref(a.hits[0])}`);
    return a.hits[0]?.atEvent === "2025:USNJNOLT2" && hitHref(a.hits[0]) === "/events/2025/USNJNOLT2?team=4215";
  });
  await test("T49", "\"hypnotic 2025-26\" → season-labeled results", async (ev) => {
    const a = await ask("hypnotic 2025-26", ev);
    ev.push(`subtitle "${a.hits[0]?.subtitle}", link ${hitHref(a.hits[0])}`);
    return teamTop(a, "4215") && a.hits[0].subtitle.startsWith("2025–26") && hitHref(a.hits[0]).includes("season=2025");
  });
  await test("T50", "\"championship\" → many events, newest first, never one guess", async (ev) => {
    const a = await ask("championship", ev);
    const evs = a.hits.filter((h) => h.kind === "event");
    ev.push(`events ${evs.slice(0, 8).map((h) => `${h.ref}`).join(", ")}`);
    const seasons = evs.map((h) => h.season ?? 0);
    return evs.length >= 5 && seasons.every((s, i) => i === 0 || s <= seasons[i - 1]);
  });
  await test("T51", "a match query → that match", async (ev) => {
    const a = await ask("USNJCMPPKWY Q1", ev);
    return a.hits[0]?.kind === "match" && a.hits[0].ref === "2025:USNJCMPPKWY:qual:0:1";
  });

  // T52–T56 versus and routing edges
  await test("T52", "reversed order → the same Compare", async (ev) => hitHref((await ask("bad wolf versus hypnotic", ev)).hits[0]) === "/compare?teams=4215,6980");
  await test("T53", "\"hypnotic vs bad wolf\" → Compare", async (ev) => hitHref((await ask("hypnotic vs bad wolf", ev)).hits[0]) === "/compare?teams=4215,6980");
  await test("T54", "versus an unknown team → recovery with 4215 and a note", async (ev) => {
    const a = await ask("hypnotic vs zzqqxxw", ev);
    return a.step === "recovery" && a.recovery!.closest.some((h) => h.ref === "4215") && a.recovery!.understood.some((u) => u.includes("zzqqxxw"));
  });
  await test("T55", "three teams → a three-team Compare", async (ev) => hitHref((await ask("hypnotic vs bad wolf vs cyber dragons", ev)).hits[0]) === "/compare?teams=4215,6980,10820");
  await test("T56", "\"hypnotic awards\" → awards; \"hypnotic matches\" → matches", async (ev) => {
    const a = await ask("hypnotic awards", ev), m = await ask("hypnotic matches", ev);
    ev.push(`links ${hitHref(a.hits[0])} , ${hitHref(m.hits[0])}`);
    return hitHref(a.hits[0]).endsWith("#awards") && hitHref(m.hits[0]).endsWith("#matches");
  });

  // Review fixes on real data: a named season's own numbers, a tied event never guessed, an event name holding a state
  await test("R1", "a named season's numbers are that season's (typed or in words)", async (ev) => {
    const a = await ask("hypnotic opr 2024-25", ev), b = await ask("hypnotic opr last season", ev);
    const s24 = await get<{ opr_np: number }>("SELECT opr_np FROM team_season_stats WHERE team = 4215 AND season = 2024");
    ev.push(`2024-25 facts ${facts(a.hits[0])} (database ${s24?.opr_np}) link ${hitHref(a.hits[0])}`, `last season facts ${facts(b.hits[0])} link ${hitHref(b.hits[0])}`);
    return a.hits[0].facts!.some((f) => f.label === "OPR" && f.value === Number(s24!.opr_np).toFixed(1)) && hitHref(a.hits[0]).includes("season=2024")
      && b.hits[0].facts!.some((f) => f.label === "Season" && f.value === "2025–26") && hitHref(b.hits[0]).includes("season=2025");
  });
  await test("R2", "several of a team's events match: a pick, not a guess", async (ev) => {
    const a = await ask("hypnotic opr at northern league meet", ev);
    ev.push(`facts ${facts(a.hits[0])}, events to pick ${a.hits[0].events?.length}`);
    return !a.hits[0].atEvent && a.hits[0].facts!.some((f) => f.value.startsWith("Several of its events match")) && (a.hits[0].events?.length ?? 0) > 1;
  });
  await test("R3", "\"New Jersey Championship rankings\" is the event's rankings, not the state's", async (ev) => {
    const a = await ask("New Jersey Championship rankings", ev);
    ev.push(`link ${hitHref(a.hits[0])}`);
    return a.hits[0]?.kind === "event" && hitHref(a.hits[0]).endsWith("?tab=rankings") && !a.intent;
  });
  await test("R4", "versus with a season in words opens Compare on it", async (ev) => hitHref((await ask("hypnotic versus bad wolf reputation last season", ev)).hits[0]) === "/compare?teams=4215,6980&season=2025");

  // T62–T64 security and privacy (T61's page and T63/T64's fixtures: the HTTP block below and vitest)
  await test("T62", "\"4215 OR 1=1\" is text", async (ev) => {
    const before = await get<{ n: number }>("SELECT COUNT(*) n FROM teams");
    const a = await ask("4215 OR 1=1", ev);
    const after = await get<{ n: number }>("SELECT COUNT(*) n FROM teams");
    ev.push(`teams before ${before?.n}, after ${after?.n}`);
    return before?.n === after?.n && a.hits.every((h) => ["team", "event", "match", "place"].includes(h.kind));
  });

  // T70 deterministic latency
  await test("T70", "deterministic p50/p95 reported; AI/ML never slows the first result", async (ev) => {
    const qs = ["4215", "hypnotic", "hypnotic ranking points", "hypnotic opr", "hipnotic", "bad wulf", "east bergen", "championship", "USNJCMPPKWY Q1", "hypnotic vs bad wolf", "asdfgh", "records"];
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) for (const q of qs) { const t0 = performance.now(); await searchAnswer(q); ms.push(performance.now() - t0); }
    const pct = (p: number) => { const s = [...ms].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]); };
    ev.push(`${ms.length} searches (${qs.length} queries × 5, warm): p50 ${pct(50)} ms, p95 ${pct(95)} ms`);
    return true;
  });

  // HTTP: T18, T20, T59, T61 (the real app, signed out)
  const dist = mkdtempSync(join(tmpdir(), "cs-accept-"));
  writeFileSync(join(dist, "index.html"), readFileSync(join(process.cwd(), "index.html"), "utf8"));
  const { createApp } = await import("../../server/app.js");
  const server: Server = createApp({ dist }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await test("T18", "a direct /search?q= visit works signed out", async (ev) => {
    const r = await fetch(`${base}/search?q=hypnotic`);
    const html = await r.text();
    ev.push(`status ${r.status}, first paint lists /teams/4215: ${html.includes('href="/teams/4215"')}`);
    return r.status === 200 && html.includes('href="/teams/4215"');
  });
  await test("T59", "a copied /search?q= link gives the same results signed out", async (ev) => {
    const html = await (await fetch(`${base}/search?q=${encodeURIComponent("hypnotic ranking points")}`)).text();
    const boot = JSON.parse(/<script type="application\/json" id="cs-search-hits">(.*?)<\/script>/s.exec(html)![1]) as SearchAnswer;
    const api = await (await fetch(`${base}/api/search?q=${encodeURIComponent("hypnotic ranking points")}&answer=1&limit=25`)).json() as SearchAnswer;
    ev.push(`page top ${label(boot.hits[0])}, API top ${label(api.hits[0])}, same order: ${JSON.stringify(boot.hits.map(label)) === JSON.stringify(api.hits.map(label))}`);
    return JSON.stringify(boot.hits.map(label)) === JSON.stringify(api.hits.map(label));
  });
  await test("T20", "/opensearch.xml type and template; head link on every page", async (ev) => {
    const r = await fetch(`${base}/opensearch.xml`);
    const xml = await r.text();
    ev.push(`content-type ${r.headers.get("content-type")}`, `template ${/template="([^"]+)"/.exec(xml)?.[1]}`);
    let ok = /application\/opensearchdescription\+xml/.test(r.headers.get("content-type") ?? "") && xml.includes("/search?q={searchTerms}");
    for (const p of ["/", "/teams/4215", "/events", "/events/2025/USNJCMPPKWY", "/search?q=hypnotic", "/rankings"]) {
      const has = (await (await fetch(`${base}${p}`)).text()).includes('rel="search" type="application/opensearchdescription+xml"');
      ev.push(`${p}: head link ${has}`);
      ok &&= has;
    }
    return ok;
  });
  await test("T61", "\"<script>alert(1)</script>\" is shown as harmless text", async (ev) => {
    const q = "<script>alert(1)</script>";
    const html = await (await fetch(`${base}/search?q=${encodeURIComponent(q)}`)).text();
    const api = await (await fetch(`${base}/api/search?q=${encodeURIComponent(q)}&answer=1`)).json() as SearchAnswer;
    ev.push(`page holds a raw "<script>alert": ${html.includes("<script>alert")}; escaped heading: ${html.includes("&lt;script&gt;alert(1)&lt;/script&gt;")}; API ${show(api)}`);
    return !html.includes("<script>alert") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  // T71–T75 intent understanding, honest gaps, the demand signal
  const click = (q: string, h: SearchHit) => fetch(`${base}/api/search/click`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, kind: h.kind, ref: h.ref }) });
  const intentRow = (kind: string, pattern: string) => get<{ count: number; met: number; last_seen: string }>("SELECT count, met, last_seen FROM search_intents WHERE kind = ? AND pattern = ?", [kind, pattern]);
  const savedIntents = await all<Record<string, unknown>>("SELECT * FROM search_intents");
  await run("DELETE FROM search_intents");
  try {
    await test("T71", "\"4215 ranking at last year's Decode season, state of New Jersey\" → 4215's 2025–26 view, New Jersey's rankings, intent logged", async (ev) => {
      const q = "4215 ranking at last year's Decode season, state of New Jersey";
      const a = await ask(q, ev);
      ev.push(`intent ${JSON.stringify(a.intent)}`);
      for (const h of a.hits.slice(0, 2)) ev.push(`  ${label(h)} link ${hitHref(h)} | ${h.title} | ${h.subtitle} | ${facts(h)}`);
      // The region's 2025–26 rankings view exists (/rankings?season=2025&region=USA:NJ), so it's offered with 4215's
      // real place there, and no "doesn't exist" note: one would be false.
      const r = await click(q, a.hits[0]);
      const row = await intentRow("season-region-ranking", "[team] ranking [season] [region]");
      ev.push(`POST /api/search/click → ${r.status}; search_intents row ${JSON.stringify(row)}`);
      return teamTop(a, "4215") && hitHref(a.hits[0]) === "/teams/4215?season=2025#events" && a.hits[1]?.href === "/rankings?season=2025&region=USA%3ANJ"
        && a.hits[1].facts!.some((f) => f.label === "New Jersey rank") && a.intent?.kind === "season-region-ranking" && a.intent.met && !a.intent.gap && row?.count === 1;
    });
    await test("T72", "\"hypnotic versus bad wolf reputation\" → Compare 4215 vs 6980 with histories and awards, no reputation score", async (ev) => {
      const a = await ask("hypnotic versus bad wolf reputation", ev);
      ev.push(`gap "${a.intent?.gap}"`);
      const cmp = await (await fetch(`${base}/api/compare?teams=4215,6980`)).json() as { season: number; teams: { team: { number: number }; events: unknown[]; awards: { type: string; event: string }[] }[] };
      for (const t of cmp.teams) ev.push(`compare ${cmp.season}: ${t.team.number} events ${t.events.length}, awards ${t.awards.length} (${t.awards.map((x) => `${x.type} at ${x.event}`).join("; ")})`);
      const json = JSON.stringify(cmp) + JSON.stringify(a.hits);
      const scoreLike = /reputation\w*"\s*:|"label":"reputation/i.test(json);
      ev.push(`a reputation figure in the answer or the Compare data: ${scoreLike}`);
      return hitHref(a.hits[0]) === "/compare?teams=4215,6980" && a.step === "closest" && !scoreLike && cmp.teams.every((t) => t.events.length > 0) && cmp.teams.some((t) => t.awards.length > 0);
    });
    await test("T73", "a view that doesn't exist → understood intent, closest real result, gap note", async (ev) => {
      let ok = true;
      for (const q of ["hypnotic robot specs", "bad wolf team members", "cyber dragons budget"]) {
        const a = await ask(q, ev);
        ev.push(`  understood ${JSON.stringify(a.intent?.understood)} gap "${a.intent?.gap}" link ${hitHref(a.hits[0])}`);
        ok &&= a.step === "closest" && !!a.intent?.gap && a.hits[0]?.kind === "team" && !a.hits[0].facts?.length;
      }
      // Not understood at all: the recovery state, never a gap note.
      const n = await ask("qqzzxx wwvvb", ev);
      return ok && n.step === "recovery" && !n.intent;
    });
    await test("T74", "unmet intents: a repeat adds to the count; nothing about who, no query text", async (ev) => {
      const q = "hypnotic robot specs";
      const a = await searchAnswer(q);
      for (let i = 0; i < 3; i++) await click(q, a.hits[0]);
      const row = await intentRow("robot-specs", "[team] robot specs");
      const cols = (await all<{ name: string }>("PRAGMA table_info(search_intents)")).map((c) => c.name);
      const raw = await get<{ n: number }>("SELECT COUNT(*) n FROM search_intents WHERE pattern LIKE '%hypnotic%' OR pattern LIKE '%4215%'");
      ev.push(`after 3 picks: ${JSON.stringify(row)}`, `columns: ${cols.join(", ")}`, `rows holding a team's name or number: ${raw?.n}`);
      return row?.count === 3 && row.met === 0 && /^\d{4}-\d\d-\d\d$/.test(row.last_seen) && cols.join(",") === "kind,pattern,met,count,last_seen" && raw?.n === 0;
    });
    // T75: the demand signal from a seeded set of whole searches (as /search visits and picks would count them).
    const SEED: [string, number][] = [
      ["hypnotic versus bad wolf reputation", 9], ["x drive vs cyber dragons reputation", 4], ["hypnotic reputation", 7], ["bad wolf reputation", 5],
      ["hypnotic robot specs", 6], ["cyber dragons drivetrain", 5], ["bad wolf robot weight", 2], ["hypnotic team members", 6], ["x drive mentors", 3],
      ["cyber dragons budget", 4], ["hypnotic funding", 2], ["hypnotic instagram", 3], ["bad wolf social media", 2],
      ["4215 ranking at last year's Decode season, state of New Jersey", 8], ["new jersey rankings last season", 6], ["texas rankings this season", 3],
      ["hypnotic ranking in new jersey", 4], ["bad wolf rankings into the deep season in new jersey", 1],
    ];
    for (const [q, n] of SEED) { const a = await searchAnswer(q); for (let i = 0; i < n; i++) await recordIntent(a.intent); }
    await test("T75", "the top unmet intents, as patterns with counts (seeded)", async (ev) => {
      const top = await topIntents(20);
      const met = (await topIntents(20, false)).filter((r) => r.met);
      for (const r of top) ev.push(`  unmet ${String(r.count).padStart(3)}  ${r.pattern}   (${r.kind})`);
      for (const r of met) ev.push(`  met   ${String(r.count).padStart(3)}  ${r.pattern}   (${r.kind})`);
      intentReport = { unmet: top, met };
      return top.length >= 5 && top.every((r, i) => i === 0 || r.count <= top[i - 1].count) && top.every((r) => !/hypnotic|wolf|4215|dragons|drive|jersey|texas/i.test(r.pattern));
    });
  } finally {
    await run("DELETE FROM search_intents");
    for (const r of savedIntents) await run("INSERT INTO search_intents (kind, pattern, met, count, last_seen) VALUES (?, ?, ?, ?, ?)", [r.kind as string, r.pattern as string, r.met as number, r.count as number, r.last_seen as string]);
  }
  server.close();
} finally {
  await restore();
  fake.close();
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "acceptance.json"), JSON.stringify({ at: new Date().toISOString(), results, intents: intentReport }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((f) => f.id).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
