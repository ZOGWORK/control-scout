// The sign-off's load staircase (scripts/search-signoff/README.md): the live search API at 25, then 50, then 100
// virtual users, one step after another, each asking the sign-off's own questions (Sets A, B and C, picked at random,
// as visitors would; CACHE=cold below for uncached answers only). Targets: 25 and 50 VU p95 under 2 s, 100 VU p95
// under 3 s at 15+ requests a second, no failed requests.
//
//   k6 run scripts/search-signoff/k6-staircase.js
//   k6 run -e BASE=http://localhost:8787 -e HOLD=60s scripts/search-signoff/k6-staircase.js
//   k6 run -e CACHE=cold scripts/search-signoff/k6-staircase.js     every request misses the 60 s answer cache
//
// The answer cache (server/app.ts keptAnswer) keys on the query, the limit and ?prefer. With CACHE=cold each request
// carries a ?prefer of a team number no team has (six digits), so it answers the same but is never a cached answer:
// the cost of a new search. Run both and report them side by side.
import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE || "https://controlscout.org";
const HOLD = __ENV.HOLD || "2m";
const COLD = __ENV.CACHE === "cold";
const secs = (d) => (d.endsWith("m") ? 60 * parseFloat(d) : parseFloat(d));
const QUERIES = new SharedArray("queries", () => ["A", "B", "C"].flatMap((s) => JSON.parse(open(`./sets/${s}.json`)).map((x) => x.q)));

const step = (vus, i) => ({ executor: "constant-vus", vus, duration: HOLD, startTime: `${i * (secs(HOLD) + 10)}s`, gracefulStop: "10s", tags: { step: `vu${vus}` } });
export const options = {
  scenarios: { vu25: step(25, 0), vu50: step(50, 1), vu100: step(100, 2) },
  thresholds: {
    "http_req_duration{step:vu25}": ["p(95)<2000"],
    "http_req_duration{step:vu50}": ["p(95)<2000"],
    "http_req_duration{step:vu100}": ["p(95)<3000"],
    // k6's rate is over the whole run, so the 100 VU step's own rate is worked out in handleSummary below.
    "http_reqs{step:vu25}": ["count>0"], "http_reqs{step:vu50}": ["count>0"], "http_reqs{step:vu100}": ["count>0"],
    "http_req_failed{step:vu25}": ["rate==0"], "http_req_failed{step:vu50}": ["rate==0"], "http_req_failed{step:vu100}": ["rate==0"],
    http_req_failed: ["rate==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};

export default function () {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const cold = COLD ? `&prefer=team:${900000 + Math.floor(Math.random() * 99999)}` : "";
  const r = http.get(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=40&answer=1${cold}`, { headers: { "user-agent": "cs-signoff-k6" }, timeout: "30s" });
  check(r, { "status 200": (x) => x.status === 200 });
}

/** One line per step: p95, requests a second over that step's hold, failures, each against its target. */
export function handleSummary(data) {
  const m = (k) => data.metrics[k]?.values ?? {};
  const lines = [`Staircase against ${BASE}, ${HOLD} per step, ${COLD ? "every answer uncached" : "answer cache as visitors get it"}`];
  let ok = true;
  for (const [vus, p95max] of [[25, 2000], [50, 2000], [100, 3000]]) {
    const d = m(`http_req_duration{step:vu${vus}}`), n = m(`http_reqs{step:vu${vus}}`).count ?? 0, f = m(`http_req_failed{step:vu${vus}}`).rate ?? 0;
    const rps = n / secs(HOLD), pass = d["p(95)"] < p95max && f === 0 && (vus !== 100 || rps >= 15);
    ok = ok && pass;
    lines.push(`${vus} VU: p95 ${Math.round(d["p(95)"])} ms (target <${p95max}), median ${Math.round(d.med)} ms, ${rps.toFixed(1)} req/s${vus === 100 ? " (target >=15)" : ""}, ${(100 * f).toFixed(2)}% failed, ${n} requests: ${pass ? "PASS" : "FAIL"}`);
  }
  lines.push(ok ? "All targets met." : "Targets NOT met.");
  return { stdout: lines.join("\n") + "\n", [`k6-summary-${COLD ? "cold" : "warm"}.json`]: JSON.stringify(data, null, 1) };
}
