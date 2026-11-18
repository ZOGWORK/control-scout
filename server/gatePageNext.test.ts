// The new shutdown page (server/gatePageNext.ts), a preview at /preview/shutdown: the same two lines and the same
// sign-in flow as the live gate page, in the new look: no yellow, no glow, no tape, no grid, the mark in white.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ email: true, google: false, controlPoint: true }));
vi.mock("./auth/routes.js", () => ({ authProviders: () => providers }));

const { gatePageNext, GATE_NEXT_STYLE } = await import("./gatePageNext");
const { GATE_CSP, GATE_SCRIPT, gatePage } = await import("./shutdownGate");

beforeEach(() => { providers.email = true; providers.google = false; providers.controlPoint = true; });

describe("gatePageNext", () => {
  it("has the two lines and the sign-in card, and nothing else to read", () => {
    const html = gatePageNext(false);
    const text = html.replace(/^[\s\S]*<\/head>/, "").replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toContain("Control Scout is under construction. We'll be back in a couple of days.");
    expect(text).toContain("Have an account? Sign in to keep using Control Scout.");
    expect(html).toContain('placeholder="you@example.com"');
    expect(html).toMatch(/<button type="submit">Send code<\/button>/);
    expect(html).toContain(">OR<");
    expect(html).toContain('href="/api/auth/control-point/start?back=%2F">Sign in with Control Point</a>');
    expect(text).not.toMatch(/under construction.*under construction/i); // no eyebrow pill repeating it
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("uses no yellow, glow, tape, grid or animation anywhere", () => {
    const html = gatePageNext(false);
    expect(html).not.toMatch(/#ffc700|#ffd633|#eab308|accent/i);
    expect(html).not.toMatch(/box-shadow|drop-shadow|text-shadow/);
    expect(html).not.toMatch(/\.(tape|grid|breath|eyebrow|dot|amb)\b|class="(tape|grid|breath|eyebrow|dot|amb)"|@keyframes|animation/);
    expect(GATE_NEXT_STYLE).not.toMatch(/linear-gradient\([^)]*90deg/); // no grid lines
  });

  it("shows the mark in white, flat", () => {
    const html = gatePageNext(false);
    expect(html).toContain('src="/mark-white.webp"');
    expect(html).not.toContain('src="/mark.webp"');
    expect(html).not.toContain("logo-56.webp");
  });

  it("keeps the live page's sign-in flow: the same script, allowed by the same CSP", () => {
    const html = gatePageNext(false);
    expect(html).toContain(`<script>${GATE_SCRIPT}</script>`);
    expect(GATE_CSP).toContain(`'sha256-${createHash("sha256").update(GATE_SCRIPT, "utf8").digest("base64")}'`);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('id="email-form"');
    expect(html).toContain('id="code-form" method="post" hidden');
  });

  it("follows the providers like the live page, and the closed-signups note", () => {
    providers.email = false;
    const noEmail = gatePageNext(false);
    expect(noEmail).not.toContain("Send code");
    expect(noEmail).not.toContain(">OR<");
    expect(noEmail).not.toContain("<script>");
    providers.email = true; providers.controlPoint = false;
    expect(gatePageNext(false)).not.toContain(">OR<");
    expect(gatePageNext(true)).toMatch(/class="note"/);
    expect(gatePageNext(false)).not.toMatch(/class="note"/);
  });

  it("leaves the live gate page as it is until it's approved", () => {
    expect(gatePage(false)).toContain('src="/mark.webp"');
  });
});
