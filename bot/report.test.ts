// "Report this to ControlScout" (bot/report.ts): the phrase that asks for it, the issue it files, and what it says
// when it can't. Filing goes through the site's own GitHub client (server/errorReports.ts gh), so the token is the one
// the site already has: GITHUB_REPORT_TOKEN.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setGithubFetch } from "../server/errorReports";
import { REPORT_LABELS, REPORT_TITLE, fileReport, reportBody, wantsReport, type Filed, type Report } from "./report";

const report = (over: Partial<Report> = {}): Report => ({
  guild: "g1", channel: "c1", user: "u1", name: "Alex",
  message: "Report this to ControlScout",
  thread: [{ role: "user", text: "what is the cosine of 35 degrees" }, { role: "bruno", text: "Sorry — I can't answer that yet" }],
  logs: ["@mention question=WHAT IS THE COSINE OF 35 DEGREES step=recovery bruno=no 12ms", "[bot] chat failed: http 429"],
  ...over,
});

describe("the words that ask for a report", () => {
  it("takes an explicit request and nothing else", () => {
    for (const q of ["Report this to ControlScout", "report this to control scout", "@Control Scout report this to ControlScout please", "Report it to Control Scout."]) {
      expect(wantsReport(q), q).toBe(true);
    }
    // Not a report: the words about one, a question about reporting, the bot's own text.
    for (const q of ["how do I report this?", "please report this bug to the owner", "where is the report button", "reporting this to controlscout", "who won decode"]) {
      expect(wantsReport(q), q).toBe(false);
    }
  });
});

describe("the issue's body", () => {
  it("has the message, the thread before it, where it happened and the bot's log lines", () => {
    const body = reportBody(report(), Date.parse("2026-11-22T06:00:00Z"));
    expect(body).toContain("### The message that asked for it");
    expect(body).toContain("Report this to ControlScout");
    expect(body).toContain("### The thread before it");
    expect(body).toContain("**Person:** what is the cosine of 35 degrees");
    expect(body).toContain("**Control Scout:** Sorry — I can't answer that yet");
    expect(body).toContain("**Server:** `g1`");
    expect(body).toContain("**Channel:** `c1`");
    expect(body).toContain("**Asked by:** Alex (`u1`)");
    expect(body).toContain("### The bot's last log lines (2)");
    expect(body).toContain("[bot] chat failed: http 429");
    expect(body).toContain("2026-11-22T06:00:00.000Z");
    // Nothing secret ever rides along: the token isn't in what the bot writes.
    process.env.GITHUB_REPORT_TOKEN = "ghp_secret_value";
    expect(reportBody(report())).not.toContain("ghp_secret_value");
  });

  it("can't be used to ping a GitHub user or cross-reference an issue", () => {
    // The issue is filed under the bot's own GitHub identity: whatever a member typed, no @mention and no #123 may
    // reach anyone from it.
    const body = reportBody(report({ message: "Report this to ControlScout @octocat #12", name: "@here guy", thread: [{ role: "user", text: "ping @everyone about #999" }] }));
    expect(body).not.toMatch(/@octocat/);
    expect(body).not.toMatch(/@here/);
    expect(body).not.toMatch(/@everyone/);
    expect(body).not.toMatch(/#12\b/);
    expect(body).not.toMatch(/#999/);
    expect(body).toContain("@\u200Boctocat");
    expect(body).toContain("#\u200B999");
  });

  it("keeps a log line inside the fence, and says so when nothing was logged", () => {
    const body = reportBody(report({ logs: ["a ``` b"] }));
    expect(body).toContain("a ''' b");
    expect(body).not.toMatch(/```[\s\S]*```[\s\S]*```/);
    expect(reportBody(report({ logs: [] }))).toContain("(nothing logged yet)");
  });
});

describe("filing it", () => {
  const calls: { method: string; url: string; body?: any; auth?: string }[] = [];
  const saved = process.env.GITHUB_REPORT_TOKEN;
  beforeEach(() => {
    calls.length = 0;
    process.env.GITHUB_REPORT_TOKEN = "token-123";
    setGithubFetch((async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>)?.Authorization });
      return Response.json({ number: 2129, html_url: "https://github.com/ZOGWORK/control-scout/issues/2129" }, { status: 201 });
    }) as typeof fetch);
  });
  afterEach(() => { setGithubFetch(null); if (saved === undefined) delete process.env.GITHUB_REPORT_TOKEN; else process.env.GITHUB_REPORT_TOKEN = saved; });

  it("opens one issue titled \"Discord type issue\", through the site's GitHub path", async () => {
    const r = await fileReport(report());
    expect(r).toEqual({ ok: true, number: 2129, url: "https://github.com/ZOGWORK/control-scout/issues/2129" });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.github.com/repos/ZOGWORK/control-scout/issues");
    expect(calls[0].auth).toBe("Bearer token-123");
    expect(calls[0].body.title).toBe(REPORT_TITLE);
    expect(calls[0].body.title).toBe("Discord type issue");
    expect(calls[0].body.labels).toEqual(REPORT_LABELS);
    expect(calls[0].body.body).toContain("what is the cosine of 35 degrees");
    expect(calls[0].body.body).not.toContain("token-123");
  });

  it("says why when it can't: no token, or GitHub refusing", async () => {
    delete process.env.GITHUB_REPORT_TOKEN;
    expect(await fileReport(report())).toMatchObject({ ok: false });
    expect((await fileReport(report()) as { reason: string }).reason).toContain("GITHUB_REPORT_TOKEN");
    expect(calls).toHaveLength(0);

    process.env.GITHUB_REPORT_TOKEN = "token-123";
    setGithubFetch((async () => new Response("{}", { status: 403 })) as typeof fetch);
    expect(await fileReport(report())).toEqual({ ok: false, reason: "GitHub answered 403" });
  });

  it("never throws, whatever the network does", async () => {
    setGithubFetch((async () => { throw new Error("getaddrinfo ENOTFOUND api.github.com"); }) as typeof fetch);
    const r = await fileReport(report());
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("ENOTFOUND");
  });
});
