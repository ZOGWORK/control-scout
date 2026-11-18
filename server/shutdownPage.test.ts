// The page an outsider sees while the site is shut (server/shutdownGate.ts gatePage): the two lines and the sign-in
// card, in the new look: no yellow, no glow, no tape, no grid, the mark in white, always dark.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ email: true, google: false, controlPoint: true }));
vi.mock("./auth/routes.js", () => ({ authProviders: () => providers }));

const { GATE_CSP, GATE_SCRIPT, GATE_STYLE, gatePage } = await import("./shutdownGate");

beforeEach(() => { providers.email = true; providers.google = false; providers.controlPoint = true; });

describe("gatePage", () => {
  it("has the two lines and the sign-in card, and nothing else to read", () => {
    const html = gatePage(false);
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
    const html = gatePage(false);
    expect(html).not.toMatch(/#ffc700|#ffd633|#eab308|accent/i);
    expect(html).not.toMatch(/box-shadow|drop-shadow|text-shadow/);
    expect(html).not.toMatch(/\.(tape|grid|breath|eyebrow|dot|amb)\b|class="(tape|grid|breath|eyebrow|dot|amb)"|@keyframes|animation/);
    expect(GATE_STYLE).not.toMatch(/\b1px,transparent 1px|background-size/); // no grid lines (1px stops, tiled)
  });

  it("shows the mark in white, flat", () => {
    const html = gatePage(false);
    expect(html).toContain('src="/mark-white.webp"');
    expect(html).not.toContain('src="/mark.webp"');
    expect(html).not.toContain("logo-56.webp");
  });

  it("runs only the sign-in script, allowed by its hash in the CSP (no theme script: the page is always dark)", () => {
    const html = gatePage(false);
    expect(html).toContain(`<script>${GATE_SCRIPT}</script>`);
    expect(GATE_CSP).toContain(`'sha256-${createHash("sha256").update(GATE_SCRIPT, "utf8").digest("base64")}'`);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('id="email-form"');
    expect(html).toContain('id="code-form" method="post" hidden');
  });

  it("follows the providers like the live page, and the closed-signups note", () => {
    providers.email = false;
    const noEmail = gatePage(false);
    expect(noEmail).not.toContain("Send code");
    expect(noEmail).not.toContain(">OR<");
    expect(noEmail).not.toContain("<script>");
    providers.email = true; providers.controlPoint = false;
    expect(gatePage(false)).not.toContain(">OR<");
    expect(gatePage(true)).toMatch(/class="note"/);
    expect(gatePage(false)).not.toMatch(/class="note"/);
  });

  it("allows nothing else to run", () => {
    expect(GATE_CSP.match(/'sha256-/g)).toHaveLength(1);
    expect(GATE_CSP).toContain("img-src 'self'");
  });
});
