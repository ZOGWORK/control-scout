// The Resend mailer's failure path: the provider's reason reaches the log
// (trimmed, never the key or the address), and a failed send leaves no code.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { setMailer, startEmailSignIn } from "./email";

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
