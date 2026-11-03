// Failed searches → GitHub issues (server/searchFailures.ts), against the real app on an in-memory database. GitHub
// is never called: setGithubFetch swaps in a fake that records requests and answers like the REST API. The FTC One
// Search redundancy brief's §12 and acceptance cases 23–30.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { sha256 } from "./auth/session";
import { rebuildSearch } from "./stats/job";
import { resetReportLimits, setGithubFetch } from "./errorReports";
import {
  counters, failureBody, failureOf, failureTitle, flushSearchFailures, githubPausedUntil, keyHash, noteSearch, recheck, redact, reportKey,
  NEW_PER_DAY, resetSearchFailures, settle, SETTLE_MS, syncOne, syncSearchFailures, type SearchTrace,
} from "./searchFailures";
import type { SearchAnswer } from "../src/shared/api";

let server: Server;
let base = "";
const saved = { token: process.env.GITHUB_REPORT_TOKEN, owners: process.env.OWNER_EMAILS };
const TOKEN = "github_pat_TEST_ONLY_not_a_real_token_abc123";

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let nextIssue = 500;
type FakeIssue = { state: string; state_reason?: string | null; body?: string; title?: string; labels?: string[] };
let issues: Record<number, FakeIssue> = {};
let failGithub: number | null = null;
let throwGithub = false;
let headers: Record<string, string> = {};

const fakeGithub = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  expect(u.origin).toBe("https://api.github.com");
  const path = u.pathname.replace("/repos/ZOGWORK/control-scout", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, path, body });
  if (throwGithub) throw new TypeError("fetch failed");
  if (failGithub) return new Response("{}", { status: failGithub, headers });
  if (path === "/search/issues") {
    const h = /"([0-9a-f]{24})"/.exec(u.searchParams.get("q") ?? "")?.[1] ?? "";
    return Response.json({ items: Object.entries(issues).filter(([, s]) => s.body?.includes(h)).map(([n, s]) => ({ number: +n, ...s })) });
  }
  if (method === "POST" && path === "/issues") {
    const n = nextIssue++;
    issues[n] = { state: "open", body: body.body, title: body.title, labels: body.labels };
    return Response.json({ number: n }, { status: 201 });
  }
  const m = /^\/issues\/(\d+)(\/comments)?$/.exec(path);
  const i = m ? issues[+m[1]] : undefined;
  if (m && !i) return new Response("{}", { status: 404 });
  if (m && !m[2] && method === "GET") return Response.json({ number: +m[1], ...i });
  if (m && !m[2] && method === "PATCH") { Object.assign(i!, body, body.state === "open" ? { state_reason: null } : {}); return Response.json({ number: +m[1], ...i }); }
  if (m && m[2] && method === "POST") return Response.json({ id: 1 }, { status: 201 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const S = 2025;
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO team_seasons (season, team) VALUES (?, 4215)", [S]);
  await rebuildSearch();
  setGithubFetch(fakeGithub);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  setGithubFetch(null);
  server?.close();
  for (const [k, v] of [["GITHUB_REPORT_TOKEN", saved.token], ["OWNER_EMAILS", saved.owners]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
beforeEach(async () => {
  process.env.GITHUB_REPORT_TOKEN = TOKEN;
  delete process.env.OWNER_EMAILS;
  calls = []; nextIssue = 500; issues = {}; failGithub = null; throwGithub = false; headers = {};
  resetSearchFailures();
  resetReportLimits();
  await run("DELETE FROM search_failures");
});

// --- Answers as /api/search gives them ---------------------------------------------------------------------------
const base0: SearchAnswer = { q: "", hits: [], pages: [], step: "deterministic", weak: false };
const team = { kind: "team", ref: "4215", title: "Hypnotic Robotics", subtitle: "", href: "/teams/4215" } as unknown as SearchAnswer["hits"][number];
const noMatch = (q: string): SearchAnswer => ({ ...base0, q, step: "recovery", weak: true, understood: { kind: "names", label: `No team, event or match matched "${q}"` } });
const fallback = (q: string, left: string): SearchAnswer => ({ ...base0, q, hits: [team], understood: { kind: "team", label: `Hypnotic Robotics (4215) · "${left}" isn't answered directly yet: the rest is on their page` } });
const answered = (q: string): SearchAnswer => ({ ...base0, q, hits: [team], card: { kind: "info", title: "Location", team: { number: 4215, name: "Hypnotic Robotics" }, lines: [{ text: "Oradell, NJ, USA" }] }, understood: { kind: "question", label: "Hypnotic Robotics (4215) · Location" } });

let clock = Date.parse("2026-11-03T12:00:00Z");
/** One visitor's search, settled (no follow-up within SETTLE_MS). */
const searched = (q: string, a: SearchAnswer, client = `198.51.100.${Math.floor(Math.random() * 250)}`, trace?: SearchTrace) => {
  clock += 1000;
  noteSearch(q, a, client, trace, clock);
  clock += SETTLE_MS;
  settle(clock);
};
const rows = () => all<{ key: string; count: number; result_type: string; intent: string | null; examples: string; issue_number: number | null; issue_state: string | null; reported_count: number }>("SELECT * FROM search_failures ORDER BY key");
const writes = () => calls.filter((c) => c.method !== "GET");

/** The automated GitHub actions allowed (brief §12.5), and nothing else. */
function onlyAllowedActions() {
  for (const c of writes()) {
    const create = c.method === "POST" && c.path === "/issues";
    const comment = c.method === "POST" && /^\/issues\/\d+\/comments$/.test(c.path);
    const update = c.method === "PATCH" && /^\/issues\/\d+$/.test(c.path) && Object.keys(c.body).every((k) => k === "body" || k === "state") && (c.body.state === undefined || c.body.state === "open");
    expect(create || comment || update, `${c.method} ${c.path} ${JSON.stringify(c.body).slice(0, 80)}`).toBe(true);
    expect(JSON.stringify(c.body)).not.toMatch(/assignee|milestone|"closed"|in-progress/);
  }
}

describe("what counts as a failed search (§12.1)", () => {
  it("each failure kind, and an answer is never one", () => {
    expect(failureOf("xyzzyq", noMatch("xyzzyq"))?.type).toBe("no-match");
    expect(failureOf("4215 opr rn", fallback("4215 opr rn", "opr rn"))).toMatchObject({ type: "team-fallback", intent: "opr" });
    expect(failureOf("4215 where from", fallback("4215 where from", "where from"))).toMatchObject({ type: "team-fallback", intent: "location" });
    expect(failureOf("4215 opr", { ...base0, hits: [team], weak: true, understood: { kind: "team", label: "Hypnotic Robotics (4215)" } })?.type).toBe("weak");
    expect(failureOf("4215 opr", { ...base0, hits: [team], understood: { kind: "names", label: "Names matching 4215 opr" } })?.type).toBe("name-only");
    expect(failureOf("meets in xyz", { ...base0, understood: { kind: "events", label: "Meets in xyz" } })?.type).toBe("empty");
    const amb: SearchTrace = { layers: ["0", "1", "2"], won: null, team: "4215", intents: ["best"], scope: [], filler: [], ambiguous: ["leaderboard", "awards"] };
    expect(failureOf("4215 best", { ...base0, hits: [team] }, amb)).toMatchObject({ type: "ambiguous", intent: "leaderboard / awards" });
    // Answers: a card, a stat, a team page asked for by name only, an honest fallback with no intent word.
    expect(failureOf("where is 4215 from", answered("where is 4215 from"))).toBeNull();
    expect(failureOf("4215", { ...base0, hits: [team], understood: { kind: "team", label: "Hypnotic Robotics (4215)" } })).toBeNull();
    expect(failureOf("4215 zzz", fallback("4215 zzz", "zzz"))).toBeNull();
  });
});

describe("normalizing, aggregating and redacting (§12.2, §12.3)", () => {
  it("filler variants of one failing query share a key; distinct queries don't", () => {
    expect(reportKey("4215 OPR rn")).toBe("4215 opr");
    expect(reportKey("#4215 opr right now?")).toBe("4215 opr");
    expect(reportKey("please 4215 opr currently")).toBe("4215 opr");
    expect(reportKey("4215 from where")).not.toBe(reportKey("4215 where from"));
    expect(reportKey("4215 opr")).not.toBe(reportKey("4215 rating"));
    // Never an intent or scope word: next, last, this season stay.
    expect(reportKey("4215 next match rn")).toBe("4215 next match");
    expect(reportKey("rn")).toBe("rn");
  });
  it("redacts emails, phone numbers and tokens, and keeps team numbers (case 28)", () => {
    expect(redact("4215 coach jane.doe@example.com")).toBe("4215 coach [email]");
    expect(redact("call 201-555-0123 about 4215")).toBe("call [phone] about 4215");
    expect(redact("(201) 555 0123")).toBe("[phone]");
    expect(redact("2015550123")).toBe("[phone]");
    expect(redact(`key ${TOKEN}`)).toBe("key [token]");
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("[token]");
    expect(redact("4215 vs 23268 vs 9999")).toBe("4215 vs 23268 vs 9999");
    expect(redact("4215 9999 12345")).toBe("4215 9999 12345");
  });
});

describe("settling (the dropdown searches while typing)", () => {
  it("counts only the query the visitor stopped at, and a retry once", async () => {
    const ip = "203.0.113.5";
    for (const q of ["4215 o", "4215 op", "4215 opr r", "4215 opr rn"]) { clock += 1200; noteSearch(q, fallback(q, q.slice(5)), ip, null, clock); }
    clock += 300; noteSearch("4215 opr rn", fallback("4215 opr rn", "opr rn"), ip, null, clock); // searchOnline's second try
    clock += SETTLE_MS; settle(clock);
    await flushSearchFailures(clock);
    expect((await rows()).map((r) => [r.key, r.count])).toEqual([["4215 opr", 1]]);
  });
  it("a query typed past a failure that then answers logs nothing", async () => {
    const ip = "203.0.113.6";
    clock += 1000; noteSearch("where is 4215", fallback("where is 4215", "where is"), ip, null, clock);
    clock += 1500; noteSearch("where is 4215 from", answered("where is 4215 from"), ip, null, clock);
    clock += SETTLE_MS; settle(clock);
    expect(await flushSearchFailures(clock)).toBe(0);
  });
});

describe("GitHub issues (cases 23–30)", () => {
  it("23: a no-match creates exactly one issue: title, body sections and labels", async () => {
    searched("Xyzzyq", noMatch("xyzzyq"));
    await flushSearchFailures(clock);
    expect(await syncSearchFailures()).toMatchObject({ synced: 1 });
    const made = calls.filter((c) => c.method === "POST" && c.path === "/issues");
    expect(made).toHaveLength(1);
    expect(made[0].body.title).toBe("Failed search: xyzzyq");
    expect(made[0].body.labels).toEqual(["failed-search", "result:no-match"]);
    const body = issues[500].body!;
    for (const part of ["**Result type:** no-match", "**Count:** 1", "**First seen:**", "**Last seen:**", "**Reproduce:** https://controlscout.org/search?q=xyzzyq",
      "**Re-check (owner):** https://controlscout.org/api/reports/search-failures/500/recheck", `**Key:** \`${keyHash("xyzzyq")}\``,
      "### Query as typed", "Xyzzyq", "### Normalized query", "### Interpreted reading", "Layer that won:   none", "### Status", "Close only after checking live"]) expect(body).toContain(part);
    expect((await rows())[0]).toMatchObject({ issue_number: 500, issue_state: "open", reported_count: 1 });
    onlyAllowedActions();
  });

  it("24: a team plus an intent word that falls back to the team page is filed as a fallback failure", async () => {
    searched("4215 opr rn", fallback("4215 opr rn", "opr rn"));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    expect(issues[500]).toMatchObject({ title: "Failed search: 4215 opr", labels: ["failed-search", "result:team-fallback", "intent:opr"] });
    expect(issues[500].body).toContain("Team:             4215");
    expect(issues[500].body).toContain("Intent keywords:  opr");
    expect(issues[500].body).toContain("Filler dropped:   rn");
  });

  it("25: the same failure three times is one issue with count 3 and no comment per repeat", async () => {
    for (const q of ["4215 opr rn", "4215 opr right now", "4215 opr rn"]) searched(q, fallback(q, q.slice(5)));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    searched("4215 OPR rn", fallback("4215 OPR rn", "OPR rn"));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    expect(calls.filter((c) => c.method === "POST" && c.path === "/issues")).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/comments"))).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ count: 4, reported_count: 4 });
    expect(issues[500].body).toContain("**Count:** 4");
    // The verbatim variants are kept, each once (a new one goes first).
    expect(JSON.parse((await rows())[0].examples)).toEqual(["4215 OPR rn", "4215 opr right now", "4215 opr rn"]);
    // A sync with nothing new writes nothing.
    calls = [];
    await syncSearchFailures();
    expect(writes()).toHaveLength(0);
    onlyAllowedActions();
  });

  it("26: a passing query creates no issue", async () => {
    searched("where is 4215 from", answered("where is 4215 from"));
    expect(await flushSearchFailures(clock)).toBe(0);
    await syncSearchFailures();
    expect(calls).toHaveLength(0);
  });

  it("27: a re-check posts a comment either way and never closes the issue", async () => {
    searched("4215 opr rn", fallback("4215 opr rn", "opr rn"));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    calls = [];
    expect(await recheck(500, async (q) => fallback(q, "opr rn"))).toMatchObject({ answered: false });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/issues/500/comments" });
    expect(calls.at(-1)!.body.body).toContain("still fails");
    expect((await rows())[0].count).toBe(2);
    expect(await recheck(500, async (q) => answered(q))).toMatchObject({ answered: true });
    expect(calls.at(-1)!.body.body).toContain("now returns a direct answer");
    expect(calls.at(-1)!.body.body).toContain("Not closed by this check");
    expect(issues[500].state).toBe("open");
    onlyAllowedActions();
  });

  it("28: nothing in an issue links back to a person, and personal data is redacted", async () => {
    searched("4215 school jane@example.com 201-555-0123", fallback("x", "school"), "192.0.2.77");
    searched(`4215 opr key ${TOKEN}`, fallback("x", "opr key"), "192.0.2.78");
    searched("jane@example.com", noMatch("x"), "192.0.2.79"); // all personal: skipped, counted
    searched(`hey ${TOKEN}`, noMatch("x"), "192.0.2.80"); // a token and filler only: skipped too
    await flushSearchFailures(clock);
    await syncSearchFailures();
    expect(counters.skipped).toBe(2);
    const sent = JSON.stringify(writes().map((c) => c.body));
    expect(sent).not.toContain("jane@example.com");
    expect(sent).not.toContain("555-0123");
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toMatch(/192\.0\.2\.|198\.51\.100\.|203\.0\.113\./);
    expect(JSON.stringify(await rows())).not.toMatch(/jane@|192\.0\.2\.|github_pat/);
    expect(sent).toContain("[email]");
    expect(sent).toContain("[token]");
  });

  it("29: with GitHub down, search still answers, and the failure is counted for later", async () => {
    throwGithub = true;
    const res = await fetch(`${base}/api/search?answer=1&q=xyzzyq`);
    expect(res.status).toBe(200);
    expect((await res.json()).step).toBe("recovery");
    failGithub = 503; throwGithub = false;
    const res2 = await fetch(`${base}/api/search?answer=1&q=4215`);
    expect(res2.status).toBe(200);
    expect((await res2.json()).hits[0]).toMatchObject({ kind: "team", ref: "4215" });
    await new Promise((r) => setTimeout(r, 20)); // the route notes it after answering
    clock = Date.now() + SETTLE_MS * 2;
    await flushSearchFailures(clock);
    expect((await rows()).map((r) => r.key)).toEqual(["xyzzyq"]);
    await syncSearchFailures();
    expect(counters.unfiled).toBe(1);
    // GitHub back: the next sync files it.
    failGithub = null;
    await syncSearchFailures();
    expect((await rows())[0].issue_number).toBe(500);
  });

  it("30: the open failed-search list holds each failing query once; dismissed stay closed; a fixed one that fails again reopens", async () => {
    for (const q of ["xyzzyq", "qqqq zzzz", "4215 opr rn"]) searched(q, q.startsWith("4215") ? fallback(q, "opr rn") : noMatch(q));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    expect(Object.keys(issues)).toHaveLength(3);
    // The owner closes one as fixed and dismisses another.
    const n = (k: string) => Number(Object.entries(issues).find(([, i]) => i.title === `Failed search: ${k}`)![0]);
    Object.assign(issues[n("4215 opr")], { state: "closed", state_reason: "completed" });
    Object.assign(issues[n("qqqq zzzz")], { state: "closed", state_reason: "not_planned" });
    for (const q of ["xyzzyq", "qqqq zzzz", "4215 opr rn"]) searched(q, q.startsWith("4215") ? fallback(q, "opr rn") : noMatch(q));
    await flushSearchFailures(clock);
    calls = [];
    await syncSearchFailures();
    expect(calls.filter((c) => c.method === "POST" && c.path === "/issues")).toHaveLength(0);
    expect(issues[n("4215 opr")].state).toBe("open");
    expect(calls.find((c) => c.path === `/issues/${n("4215 opr")}/comments`)!.body.body).toContain("Regression");
    expect(issues[n("qqqq zzzz")].state).toBe("closed");
    expect(writes().some((c) => c.path.startsWith(`/issues/${n("qqqq zzzz")}`))).toBe(false);
    const open = Object.values(issues).filter((i) => i.state === "open" && i.labels?.includes("failed-search")).map((i) => i.title);
    expect(open.sort()).toEqual(["Failed search: 4215 opr", "Failed search: xyzzyq"]);
    onlyAllowedActions();
  });
});

describe("never a duplicate, never hammering GitHub (§12.3, §12.6)", () => {
  it("a lost table finds the issue on GitHub by its key instead of opening another", async () => {
    searched("xyzzyq", noMatch("xyzzyq"));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    await run("DELETE FROM search_failures");
    searched("xyzzyq", noMatch("xyzzyq"));
    await flushSearchFailures(clock);
    calls = [];
    expect((await syncOne("xyzzyq")).outcome).toBe("adopted");
    expect(calls.filter((c) => c.method === "POST" && c.path === "/issues")).toHaveLength(0);
    expect((await rows())[0].issue_number).toBe(500);
  });
  it("backs off when rate-limited, and caps writes per sync", async () => {
    for (let i = 0; i < 30; i++) searched(`nothing here ${i}`, noMatch("x"), `203.0.113.${i}`);
    await flushSearchFailures(clock);
    await syncSearchFailures();
    expect(writes().length).toBeLessThanOrEqual(20);
    failGithub = 403; headers = { "retry-after": "120" };
    calls = [];
    await syncSearchFailures();
    expect(calls).toHaveLength(1);
    expect(githubPausedUntil()).toBeGreaterThan(Date.now() + 100_000);
    calls = [];
    await syncSearchFailures();
    expect(calls).toHaveLength(0);
  });
  it("opens at most NEW_PER_DAY issues a day, the most-repeated first", async () => {
    for (let i = 0; i < 45; i++) searched(`junk ${i}`, noMatch("x"), `203.0.113.${i}`);
    for (let k = 0; k < 3; k++) searched("junk 44", noMatch("x"), `192.0.2.${k}`);
    await flushSearchFailures(clock);
    for (let k = 0; k < 5; k++) await syncSearchFailures();
    const made = calls.filter((c) => c.method === "POST" && c.path === "/issues");
    expect(made).toHaveLength(NEW_PER_DAY);
    expect(made[0].body.title).toBe("Failed search: junk 44");
    expect((await rows()).filter((r) => r.issue_number == null)).toHaveLength(45 - NEW_PER_DAY);
  });
  it("caps what one visitor can log in an hour", async () => {
    for (let i = 0; i < 40; i++) searched(`gibberish ${i}`, noMatch("x"), "203.0.113.200");
    await flushSearchFailures(clock);
    expect((await rows()).length).toBe(30);
    expect(counters.limited).toBe(10);
  });
  it("titles are capped with an ellipsis, the full query in the body, and nothing in them mentions or links", () => {
    const long = `${"very long query words ".repeat(6)}end`;
    expect(failureTitle(long)).toHaveLength("Failed search: ".length + 80);
    expect(failureTitle(long).endsWith("…")).toBe(true);
    expect(failureTitle("@octocat #12")).not.toMatch(/@octocat|#12/);
    const body = failureBody({ key: long, hash: "h", result_type: "no-match", intent: null, reading: JSON.stringify({ layers: [], won: null, team: null, intents: [], scope: [], filler: [] }), label: "", examples: JSON.stringify([long]), count: 1, first_seen: "a", last_seen: "b", issue_number: 1, issue_state: "open", reported_count: 0, filing_at: null });
    expect(body).toContain(long);
  });
});

describe("the owner's re-check page", () => {
  async function signIn(email: string): Promise<string> {
    const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
    const t = `tok-${email}-${Math.random()}`;
    await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
    return `cs_session=${t}`;
  }
  it("is the owner's only, same-site only, and comments without closing", async () => {
    searched("xyzzyq", noMatch("xyzzyq"));
    await flushSearchFailures(clock);
    await syncSearchFailures();
    const url = `${base}/api/reports/search-failures/500/recheck`;
    expect((await fetch(url)).status).toBe(404);
    process.env.OWNER_EMAILS = "owner@example.com";
    const scout = await signIn(`scout${Math.random()}@example.com`);
    expect((await fetch(url, { headers: { Cookie: scout } })).status).toBe(404);
    const owner = await signIn("owner@example.com");
    const page = await fetch(url, { headers: { Cookie: owner } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("never closes it");
    expect((await fetch(url, { method: "POST", headers: { Cookie: owner, Origin: "https://evil.example" } })).status).toBe(403);
    calls = [];
    const done = await fetch(url, { method: "POST", headers: { Cookie: owner, Origin: base } });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Still fails");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([expect.objectContaining({ method: "POST", path: "/issues/500/comments" })]);
    expect(issues[500].state).toBe("open");
  });
});
