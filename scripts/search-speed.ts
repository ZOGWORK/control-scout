// Search's speed, measured against a running server (the search audit of 2026-11-24, section 2): People also ask cold
// alone and four at once, the off-topic ("Sorry") page's follow-ups, and the answer API cold and warm. Each run asks
// queries the server hasn't seen (team numbers it picks fresh, in a seeded order), so "cold" means cold.
//
//   npx tsx scripts/search-speed.ts --base http://127.0.0.1:3411 [--n 12] [--seed 1]
//
// Times are wall clock from this script (the request as a visitor waits for it) and, beside them, the server's own
// Server-Timing figure.
const flag = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = flag("base", "http://127.0.0.1:3411"), N = Number(flag("n", "12")), SEED = Number(flag("seed", "1")), DUMP = flag("dump", "");
// --dump <file>: each "alone" query's whole follow-up set (asked again until it's no longer partial), to compare two
// servers' sets.
const dumped: unknown[] = [];
type Follow = { ask: { q: string; preview: string }[]; related: { q: string; preview: string }[]; highlights?: { q: string; preview: string }; partial?: true };
async function whole(q: string): Promise<Follow> {
  const end = Date.now() + 120_000;
  for (;;) {
    if (Date.now() > end) throw new Error(`follow-ups for "${q}" still partial or failing after 120 s`);
    const f = (await follow(q).catch(() => null))?.body as Follow | null;
    if (f?.ask && !f.partial) return f;
    await new Promise((ok) => setTimeout(ok, 2_000));
  }
}

let s = SEED * 2654435761 % 2 ** 32;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
// Real teams: read from the server itself (several places' leaderboards), so every query names a team with data.
async function teams(): Promise<number[]> {
  const places = ["texas", "california", "michigan", "new jersey", "florida", "washington", "ohio", "georgia", "minnesota", "virginia", "new york", "illinois"];
  const out = new Set<number>();
  for (const p of places) {
    const text = await fetch(`${BASE}/api/search?q=${encodeURIComponent(`top teams in ${p}`)}&answer=1&limit=25`).then((x) => x.text());
    for (const m of text.matchAll(/\/teams\/(\d+)/g)) out.add(Number(m[1]));
  }
  return [...out];
}

const pct = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const fmt = (xs: number[]) => `p50 ${Math.round(pct(xs, 0.5))} ms · p95 ${Math.round(pct(xs, 0.95))} ms · max ${Math.round(Math.max(...xs))} ms (n=${xs.length})`;

// Each query is its own visitor (an address of its own, through the proxy header the server trusts), as the people
// it stands for are: one address would soon be rate-limited (30 follow-ups a minute), and a 429 is fast.
const visitors = new Map<string, string>();
const visitor = (q: string) => visitors.get(q) ?? (visitors.set(q, `10.${(visitors.size >> 16) & 255}.${(visitors.size >> 8) & 255}.${visitors.size & 255}`), visitors.get(q)!);
async function timed(path: string, q: string): Promise<{ ms: number; server: string; body: unknown }> {
  const t = performance.now();
  const r = await fetch(`${BASE}${path}`, { headers: { "x-forwarded-for": visitor(q) } });
  if (r.status === 429) throw new Error(`rate-limited: ${path}`);
  const body = await r.json().catch(() => null);
  return { ms: performance.now() - t, server: r.headers.get("server-timing") ?? "", body };
}
const follow = (q: string) => timed(`/api/search/follow?q=${encodeURIComponent(q)}`, q);
// At the page's own limit (SEARCH_PAGE_LIMIT), as /search asks: its follow-ups read the same kept answer.
const answer = (q: string) => timed(`/api/search?q=${encodeURIComponent(q)}&answer=1&limit=25`, q);

const pool = await teams();
console.log(`teams: ${pool.length}`);
const order = pool.map((t) => [rnd(), t] as const).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
let next = 0;
// Each team once: past the pool, a query could repeat one the server already made, measured as cold.
const fresh = () => { if (next >= order.length) throw new Error(`only ${order.length} teams to ask about: use a smaller --n`); return order[next++]; };
const shapes = [(t: number) => `${t}`, (t: number) => `${t} record`, (t: number) => `has ${t} been to worlds?`, (t: number) => `${t} last match`];
const q = (i: number) => shapes[i % shapes.length](fresh());

// The answer API, cold then warm (the same queries again).
const cold: number[] = [], warm: number[] = [], qs: string[] = [];
for (let i = 0; i < N; i++) { const x = q(i); qs.push(x); cold.push((await answer(x)).ms); }
for (const x of qs) warm.push((await answer(x)).ms);
console.log(`answer cold     ${fmt(cold)}`);
console.log(`answer warm     ${fmt(warm)}`);

// People also ask alone: a new query's answer first (as the page does), then its follow-ups.
const alone: number[] = [];
for (let i = 0; i < N; i++) {
  const x = q(i);
  await answer(x);
  alone.push((await follow(x)).ms);
  if (DUMP) { const f = await whole(x); dumped.push({ q: x, ask: f.ask.map((y) => `${y.q} = ${y.preview}`), related: f.related.map((y) => `${y.q} = ${y.preview}`), highlights: f.highlights ? `${f.highlights.q} = ${f.highlights.preview}` : null }); }
}
console.log(`follow alone    ${fmt(alone)}`);

// Four at once: four new queries' follow-ups asked together, and a cached answer asked meanwhile.
const four: number[] = [], beside: number[] = [];
const cachedQ = qs[0];
for (let r = 0; r < Math.max(2, Math.round(N / 4)); r++) {
  const xs = [0, 1, 2, 3].map((i) => q(i));
  await Promise.all(xs.map(answer));
  const side = (async () => { await new Promise((ok) => setTimeout(ok, 150)); beside.push((await answer(cachedQ)).ms); })();
  const got = await Promise.all(xs.map(follow));
  await side;
  four.push(...got.map((g) => g.ms));
}
console.log(`follow 4 at once ${fmt(four)}`);
console.log(`cached answer meanwhile ${fmt(beside)}`);

// Off-topic: the Sorry page's answer and follow-ups (each query new to the server).
const off = ["weather in paris", "best pizza near me", "how tall is mount everest", "stock price of apple", "learn to play guitar", "cheap flights to tokyo", "what time is it in london", "recipe for banana bread",
  "who painted the mona lisa", "how to tie a tie", "capital of australia", "movie times tonight", "how far is the moon", "best running shoes", "how to bake sourdough", "symptoms of a cold",
  "how do airplanes fly", "lyrics to a song", "news today", "how to learn spanish", "price of gold", "how to fix a flat tire", "biggest ocean on earth", "how to grow tomatoes"];
const offA: number[] = [], offF: number[] = [];
for (let i = 0; i < Math.min(8, N); i++) {
  const w = off[((SEED - 1) * 8 + i) % off.length];
  offA.push((await answer(w)).ms);
  offF.push((await follow(w)).ms);
}
console.log(`sorry answer    ${fmt(offA)}`);
console.log(`sorry follow    ${fmt(offF)}`);

if (DUMP) {
  for (let i = 0; i < Math.min(8, N); i++) {
    const w = off[((SEED - 1) * 8 + i) % off.length];
    const f = await whole(w);
    dumped.push({ q: w, ask: f.ask.map((y) => `${y.q} = ${y.preview}`), related: f.related.map((y) => `${y.q} = ${y.preview}`) });
  }
  (await import("node:fs")).writeFileSync(DUMP, dumped.map((x) => JSON.stringify(x)).join("\n") + "\n");
}
