import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_STATE, checkSite, configFrom, duration, formatAlert, postDiscord, step, tick,
  type FetchLike, type MonitorState, type SiteResult,
} from "./uptime";

const SITE = "https://example.test";
const SHELL = '<!doctype html><html><head><title>Control Scout</title></head><body><div id="root"></div></body></html>';

type Answer = { status?: number; body?: string; type?: string } | "refuse" | "hang";

/** A fetch that answers per path, never touching the network. */
function fakeFetch(answers: { api: Answer; home: Answer }): FetchLike {
  return async (url, init) => {
    const a = url.endsWith("/api/health") ? answers.api : answers.home;
    if (a === "refuse") throw new TypeError("fetch failed: ECONNREFUSED");
    if (a === "hang") {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(a.body ?? "", { status: a.status ?? 200, headers: { "content-type": a.type ?? "text/plain" } });
  };
}

const API_UP: Answer = { status: 200, type: "application/json", body: JSON.stringify({ ok: true, ready: true, release: "abc" }) };
const HOME_UP: Answer = { status: 200, type: "text/html; charset=utf-8", body: SHELL };

describe("checkSite", () => {
  it("passes when the API is ready and the home page serves the shell", async () => {
    const r = await checkSite(fakeFetch({ api: API_UP, home: HOME_UP }), SITE);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => [c.name, c.ok, c.status])).toEqual([["api", true, 200], ["home", true, 200]]);
  });

  it("times out a hanging request", async () => {
    const r = await checkSite(fakeFetch({ api: "hang", home: HOME_UP }), SITE, { timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(r.checks[0]).toMatchObject({ ok: false, status: null, reason: expect.stringMatching(/^timed out/) });
    expect(r.checks[1].ok).toBe(true);
  });

  it("fails on a 5xx", async () => {
    const r = await checkSite(fakeFetch({ api: { status: 502, body: "Bad gateway" }, home: { status: 502 } }), SITE);
    expect(r.ok).toBe(false);
    expect(r.checks.map((c) => c.reason)).toEqual(["HTTP 502", "HTTP 502"]);
  });

  it("fails when the API answers but isn't ready", async () => {
    const r = await checkSite(fakeFetch({ api: { status: 200, type: "application/json", body: '{"ok":true,"ready":false}' }, home: HOME_UP }), SITE);
    expect(r.ok).toBe(false);
    expect(r.checks[0].reason).toMatch(/not ready/);
  });

  it("fails when /api/health isn't JSON", async () => {
    const r = await checkSite(fakeFetch({ api: { status: 200, type: "text/html", body: "<html>" }, home: HOME_UP }), SITE);
    expect(r.checks[0].reason).toBe("not JSON");
  });

  it("fails when the home page lacks the app shell", async () => {
    const r = await checkSite(fakeFetch({ api: API_UP, home: { status: 200, type: "text/html", body: "<html><body>Maintenance</body></html>" } }), SITE);
    expect(r.ok).toBe(false);
    expect(r.checks[1].reason).toBe("app shell missing");
  });

  it("fails when the home page isn't HTML", async () => {
    const r = await checkSite(fakeFetch({ api: API_UP, home: { status: 200, type: "application/json", body: '{"id":"root"}' } }), SITE);
    expect(r.checks[1].reason).toMatch(/^not HTML/);
  });

  it("reports a refused connection", async () => {
    const r = await checkSite(fakeFetch({ api: "refuse", home: "refuse" }), SITE);
    expect(r.checks[0]).toMatchObject({ ok: false, status: null, reason: expect.stringContaining("ECONNREFUSED") });
  });

  it("names the cause behind Node's bare 'fetch failed'", async () => {
    const f: FetchLike = async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); };
    const r = await checkSite(f, SITE);
    expect(r.checks[0].reason).toBe("connection failed (ECONNREFUSED)");
    const p = formatAlert({ kind: "down", since: r.at, result: r }, SITE);
    expect(p.embeds[0].fields[0].value).toMatch(/^FAILED · connection failed \(ECONNREFUSED\) · \d+ ms$/);
  });
});

// --- debounce ---------------------------------------------------------------------

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const res = (ok: boolean, at: number): SiteResult => ({
  ok, at,
  checks: [
    { name: "api", label: "API (/api/health)", url: `${SITE}/api/health`, ok, status: ok ? 200 : 503, latencyMs: 42, reason: ok ? undefined : "HTTP 503" },
    { name: "home", label: "Home page (/)", url: `${SITE}/`, ok: true, status: 200, latencyMs: 17 },
  ],
});

function run(seq: boolean[], opts = {}): Array<string | null> {
  let s: MonitorState = { ...INITIAL_STATE };
  return seq.map((ok, i) => {
    const out = step(s, res(ok, T0 + i * MIN), opts);
    s = out.state;
    return out.alert?.kind ?? null;
  });
}

describe("step (debounce)", () => {
  it("stays quiet while up", () => {
    expect(run([true, true, true])).toEqual([null, null, null]);
  });

  it("ignores one failed check (a blip or a deploy restart)", () => {
    expect(run([true, false, true, false, true])).toEqual([null, null, null, null, null]);
  });

  it("alerts on the second failure in a row", () => {
    expect(run([true, false, false])).toEqual([null, null, "down"]);
  });

  it("honours a custom threshold", () => {
    expect(run([false, false, false], { threshold: 3 })).toEqual([null, null, "down"]);
  });

  it("reminds at most every 30 min during a long outage", () => {
    const seq = Array.from({ length: 70 }, () => false); // 70 minutes down
    const alerts = run(seq).map((a, i) => (a ? `${i}:${a}` : null)).filter(Boolean);
    expect(alerts).toEqual(["1:down", "31:reminder", "61:reminder"]);
  });

  it("sends one recovery after an outage, then goes quiet", () => {
    expect(run([false, false, false, true, true])).toEqual([null, "down", null, "recovered", null]);
  });

  it("measures the outage from the first failure", () => {
    let s: MonitorState = { ...INITIAL_STATE };
    for (let i = 0; i < 5; i++) s = step(s, res(false, T0 + i * MIN)).state;
    const out = step(s, res(true, T0 + 5 * MIN));
    expect(out.alert).toMatchObject({ kind: "recovered", since: T0 });
    expect(out.state).toEqual(INITIAL_STATE);
  });

  it("no recovery message after a single unconfirmed failure", () => {
    expect(run([false, true])).toEqual([null, null]);
  });
});

// --- message ------------------------------------------------------------------------

describe("formatAlert", () => {
  it("down: names the failing check, its status and latency, and links the site", () => {
    const p = formatAlert({ kind: "down", since: T0, result: res(false, T0 + MIN) }, "https://controlscout.org");
    expect(p.content).toBe("**controlscout.org is down.** API (/api/health): HTTP 503, 42 ms. https://controlscout.org");
    expect(p.embeds[0]).toMatchObject({ title: "controlscout.org is down", url: "https://controlscout.org", color: 0xe5484d });
    expect(p.embeds[0].description).toContain(`<t:${T0 / 1000}:R>`);
    expect(p.embeds[0].fields).toEqual([
      { name: "API (/api/health)", value: "FAILED · HTTP 503 · 42 ms", inline: false },
      { name: "Home page (/)", value: "OK · HTTP 200 · 17 ms", inline: false },
    ]);
    expect(p.allowed_mentions).toEqual({ parse: [] });
  });

  it("reminder: says how long it has been down", () => {
    const p = formatAlert({ kind: "reminder", since: T0, result: res(false, T0 + 31 * MIN) }, "https://controlscout.org");
    expect(p.embeds[0].title).toBe("controlscout.org is still down (31 min)");
    expect(p.embeds[0].color).toBe(0xf5a524);
  });

  it("recovered: says it's back and for how long it was down", () => {
    const p = formatAlert({ kind: "recovered", since: T0, result: res(true, T0 + 65 * MIN) }, "https://controlscout.org");
    expect(p.content).toBe("**controlscout.org is back up** after about 1 h 5 min down. https://controlscout.org");
    expect(p.embeds[0].color).toBe(0x30a46c);
  });

  it("no response reads as such, and long reasons are cut", () => {
    const r = res(false, T0);
    r.checks[0] = { ...r.checks[0], status: null, reason: "x".repeat(5000) };
    const p = formatAlert({ kind: "down", since: T0, result: r }, SITE);
    expect(p.embeds[0].fields[0].value.length).toBeLessThanOrEqual(1000);
    expect(p.embeds[0].fields[0].value).toMatch(/^FAILED · x+…$/);
    expect(p.content.length).toBeLessThanOrEqual(1900);
  });

  it("duration", () => {
    expect([duration(0), duration(4 * MIN), duration(60 * MIN), duration(125 * MIN)]).toEqual(["0 min", "4 min", "1 h", "2 h 5 min"]);
  });
});

// --- Discord delivery (a local mock webhook server, never Discord) ------------------

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())).then(() => { server = undefined; }));

async function mockWebhook(status = 204): Promise<{ url: string; received: unknown[] }> {
  const received: unknown[] = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { received.push(JSON.parse(body)); res.statusCode = status; res.end(status >= 400 ? "nope" : ""); });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/hook`, received };
}

describe("postDiscord", () => {
  const payload = formatAlert({ kind: "down", since: T0, result: res(false, T0) }, SITE);

  it("no webhook configured: no request, one log line", async () => {
    const f = vi.fn<FetchLike>();
    const log = vi.fn();
    expect(await postDiscord(f, undefined, payload, log)).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^UPTIME_DISCORD_WEBHOOK is not set; not posting: \*\*example.test is down/);
  });

  it("posts the JSON payload to the webhook", async () => {
    const hook = await mockWebhook();
    expect(await postDiscord((u, i) => fetch(u, i), hook.url, payload, () => {})).toBe("sent");
    expect(hook.received).toEqual([payload]);
  });

  it("a rejected post is 'failed' and the log never shows the URL", async () => {
    const hook = await mockWebhook(429);
    const lines: string[] = [];
    expect(await postDiscord((u, i) => fetch(u, i), hook.url, payload, (l) => lines.push(l))).toBe("failed");
    expect(lines.join("\n")).toContain("HTTP 429");
    expect(lines.join("\n")).not.toContain(hook.url);
  });
});

// --- a whole tick ----------------------------------------------------------------------

describe("tick", () => {
  function memStore(initial?: MonitorState) {
    let s = initial;
    const puts: MonitorState[] = [];
    return { puts, get: async () => s, put: async (n: MonitorState) => { s = n; puts.push(n); } };
  }

  it("writes nothing while healthy", async () => {
    const store = memStore();
    await tick({ site: SITE }, { fetch: fakeFetch({ api: API_UP, home: HOME_UP }), store, log: () => {} });
    expect(store.puts).toEqual([]);
  });

  it("down then recovered, through the mock webhook", async () => {
    const hook = await mockWebhook();
    const store = memStore();
    let site = fakeFetch({ api: { status: 503, body: "" }, home: HOME_UP });
    const f: FetchLike = (u, i) => (u.startsWith(SITE) ? site(u, i) : fetch(u, i));
    const cfg = { site: SITE, webhookUrl: hook.url };
    const kinds: Array<string | null> = [];
    for (let i = 0; i < 3; i++) kinds.push((await tick(cfg, { fetch: f, store, log: () => {} })).alert?.kind ?? null);
    site = fakeFetch({ api: API_UP, home: HOME_UP });
    kinds.push((await tick(cfg, { fetch: f, store, log: () => {} })).alert?.kind ?? null);
    expect(kinds).toEqual([null, "down", null, "recovered"]);
    expect((hook.received as Array<{ embeds: Array<{ title: string }> }>).map((p) => p.embeds[0].title))
      .toEqual(["example.test is down", "example.test is back up"]);
  });

  it("a failed post keeps the old state, so the next tick retries", async () => {
    const hook = await mockWebhook(500);
    const store = memStore({ failures: 1, firstFailureAt: T0, down: false, lastAlertAt: null });
    const f: FetchLike = (u, i) => (u.startsWith(SITE) ? fakeFetch({ api: "refuse", home: "refuse" })(u, i) : fetch(u, i));
    const out = await tick({ site: SITE, webhookUrl: hook.url }, { fetch: f, store, log: () => {} });
    expect(out).toMatchObject({ alert: { kind: "down" }, delivery: "failed" });
    expect(store.puts).toEqual([]);
    expect((await store.get())?.down).toBe(false);
  });

  it("no webhook: still tracks state and logs instead of posting", async () => {
    const store = memStore({ failures: 1, firstFailureAt: T0, down: false, lastAlertAt: null });
    const lines: string[] = [];
    const out = await tick({ site: SITE }, { fetch: fakeFetch({ api: "refuse", home: HOME_UP }), store, log: (l) => lines.push(l) });
    expect(out.delivery).toBe("skipped");
    expect(store.puts.at(-1)?.down).toBe(true);
    expect(lines.some((l) => l.startsWith("UPTIME_DISCORD_WEBHOOK is not set"))).toBe(true);
  });
});

describe("configFrom", () => {
  it("defaults, and trims a trailing slash", () => {
    expect(configFrom({})).toEqual({ site: "https://controlscout.org", webhookUrl: undefined, threshold: 2, remindMs: 30 * MIN, timeoutMs: 10_000 });
    expect(configFrom({ SITE: "http://localhost:4061/", FAIL_THRESHOLD: "3", REMIND_MINUTES: "x", UPTIME_DISCORD_WEBHOOK: "" }))
      .toMatchObject({ site: "http://localhost:4061", threshold: 3, remindMs: 30 * MIN, webhookUrl: undefined });
  });
});
