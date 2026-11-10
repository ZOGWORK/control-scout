// The Resend mailer's failure path: the provider's reason reaches the log
// (trimmed, never the key or the address), and a failed send leaves no code.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { emailEnabled, emailSignInEnabled, setMailer, startEmailSignIn } from "./email";

const realFetch = globalThis.fetch;
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  process.env.RESEND_API_KEY = "re_test_key_not_real";
  setMailer(null); // the real Resend mailer, with fetch mocked below
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });
afterAll(() => { delete process.env.RESEND_API_KEY; });

function providerAnswers(status: number, body: string) {
  globalThis.fetch = vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}
const codes = async (email: string) => all<{ email: string }>("SELECT email FROM email_codes WHERE email = ?", [email]);

describe("email provider failures", () => {
  it("logs Resend's reason, and the code is removed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    providerAnswers(400, JSON.stringify({ statusCode: 400, message: "API key is invalid", name: "validation_error" }));
    expect(await startEmailSignIn("a@example.com")).toEqual({ ok: false, reason: "send-failed" });
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[email]"))!;
    expect(line).toBe("[email] sign-in code not sent: email provider error 400: API key is invalid");
    expect(line).not.toContain("re_test_key_not_real");
    expect(line).not.toContain("a@example.com");
    expect(await codes("a@example.com")).toEqual([]);
  });

  it("trims a long reason to 200 characters", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    providerAnswers(422, JSON.stringify({ message: "x".repeat(500) }));
    expect((await startEmailSignIn("b@example.com")).ok).toBe(false);
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[email]"))!;
    expect(line).toBe(`[email] sign-in code not sent: email provider error 422: ${"x".repeat(200)}`);
  });

  it("a body that isn't JSON still fails cleanly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    providerAnswers(502, "<html>bad gateway</html>");
    expect(await startEmailSignIn("c@example.com")).toEqual({ ok: false, reason: "send-failed" });
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain("[email] sign-in code not sent: email provider error 502");
    expect(await codes("c@example.com")).toEqual([]);
  });
});

describe("development log mailer (MAIL_DEV_LOG=1)", () => {
  afterEach(() => { delete process.env.MAIL_DEV_LOG; process.env.RESEND_API_KEY = "re_test_key_not_real"; });

  it("writes the code to the log and never calls the provider; the code stays valid", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.MAIL_DEV_LOG = "1";
    const fetched = vi.fn();
    globalThis.fetch = fetched as unknown as typeof fetch;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await startEmailSignIn("d@example.com")).toEqual({ ok: true });
    expect(fetched).not.toHaveBeenCalled();
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[mail] to d@example.com"))!;
    expect(line).toMatch(/\b\d{6}\b/);
    expect(await codes("d@example.com")).toEqual([{ email: "d@example.com" }]);
  });

  it("is ignored in production: no code is logged and sign-in stays off without a provider", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.MAIL_DEV_LOG = "1";
    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const fetched = vi.fn();
      globalThis.fetch = fetched as unknown as typeof fetch;
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(emailSignInEnabled()).toBe(false);
      expect(await startEmailSignIn("e@example.com")).toEqual({ ok: false, reason: "disabled" });
      expect(log.mock.calls.some((c) => String(c[0]).startsWith("[mail]"))).toBe(false);
    } finally { process.env.NODE_ENV = was; }
  });
});
