// POST /api/contact against the real app on an in-memory database: validation,
// storage, the email to CONTACT_TO (mailer mocked), the honeypot, the per-IP
// limit, and that CONTACT_TO never reaches the browser.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { setMailer } from "./auth/email";
import { CONTACT_RATE, resetContactLimits, trackedContactIps } from "./contact";

let server: Server;
let base = "";
let mails: { to: string; subject: string; text: string; html: string; replyTo?: string }[] = [];
let failSend = false;
const saved = process.env.CONTACT_TO;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  setMailer(async (to, subject, text, html, opts) => {
    if (failSend) throw new Error("email provider error 500");
    mails.push({ to, subject, text, html, replyTo: opts?.replyTo });
  });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  setMailer(null);
  server?.close();
  if (saved === undefined) delete process.env.CONTACT_TO; else process.env.CONTACT_TO = saved;
});
beforeEach(async () => {
  process.env.CONTACT_TO = "team@controlscout.test";
  mails = [];
  failSend = false;
  resetContactLimits();
  await run("DELETE FROM contact_messages");
});

const post = async (body: unknown, type = "application/json") => {
  const res = await fetch(`${base}/api/contact`, { method: "POST", headers: { "Content-Type": type }, body: type === "application/json" ? JSON.stringify(body) : String(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
const good = { name: "Ada", email: "Coach@Example.com", topic: "data", message: "Team 4215's name is spelled wrong on its page." };
const rows = () => all<{ topic: string; name: string | null; email: string; message: string; emailed: number }>("SELECT topic, name, email, message, emailed FROM contact_messages ORDER BY id");

describe("POST /api/contact", () => {
  it("stores the message and emails it to CONTACT_TO with Reply-To set to the sender", async () => {
    const r = await post(good);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    expect(await rows()).toEqual([{ topic: "data", name: "Ada", email: "coach@example.com", message: good.message, emailed: 1 }]);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("team@controlscout.test");
    expect(mails[0].replyTo).toBe("coach@example.com");
    expect(mails[0].subject).toMatch(/^\[Control Scout\] Data correction: Team 4215/);
    expect(mails[0].text).toContain(good.message);
    expect(JSON.stringify(r.json)).not.toContain("team@controlscout.test"); // the address never goes back to the browser
  });

  it("escapes the message in the HTML email", async () => {
    await post({ ...good, message: "<script>alert(1)</script> is in the event name" });
    expect(mails[0].html).toContain("&lt;script&gt;");
    expect(mails[0].html).not.toContain("<script>");
  });

  it("rejects bad fields with a reason for each, storing and sending nothing", async () => {
    const r = await post({ name: "x".repeat(101), email: "not-an-email", topic: "spam", message: "short" });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.fields).sort()).toEqual(["email", "message", "name", "topic"]);
    expect((await post({ ...good, email: "" })).json.fields.email).toMatch(/email/i);
    expect((await post({ ...good, message: "y".repeat(5001) })).json.fields.message).toMatch(/under/);
    expect(await rows()).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it("name is optional", async () => {
    expect((await post({ ...good, name: "" })).status).toBe(200);
    expect((await rows())[0].name).toBeNull();
  });

  it("only accepts JSON", async () => {
    expect((await post("email=a@b.co&message=hello+there+friend", "application/x-www-form-urlencoded")).status).toBe(415);
  });

  it("honeypot filled: looks like success, but nothing is stored or sent", async () => {
    const r = await post({ ...good, website: "http://spam.example" });
    expect(r.status).toBe(200);
    expect(await rows()).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it("without CONTACT_TO the message is still stored, and not emailed", async () => {
    delete process.env.CONTACT_TO;
    expect((await post(good)).status).toBe(200);
    expect((await rows())[0].emailed).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it("a failed email still keeps the message (emailed = 0) and tells the sender it arrived", async () => {
    failSend = true;
    expect((await post(good)).status).toBe(200);
    expect((await rows())[0].emailed).toBe(0);
  });

  it("limits each IP to a few messages an hour; rejected forms don't use up the allowance", async () => {
    await post({ ...good, email: "bad" }); // invalid: not counted
    for (let i = 0; i < CONTACT_RATE.max; i++) expect((await post(good)).status).toBe(200);
    const r = await post(good);
    expect(r.status).toBe(429);
    expect(r.json.error).toMatch(/try again later/i);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await rows()).toHaveLength(CONTACT_RATE.max);
  });

  it("rejected forms add nothing to the limiter, so they can't grow its memory", async () => {
    for (let i = 0; i < 3; i++) await post({ ...good, email: "bad" });
    expect(trackedContactIps()).toBe(0);
    await post(good);
    expect(trackedContactIps()).toBe(1);
  });
});
