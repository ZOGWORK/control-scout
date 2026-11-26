// The sign-in code email: a dark card in the site's own colours. Its one accent is the site's wash (the owner's
// Appearance setting, server/wash.ts liveWash), read when the email is sent: a soft glow behind the greeting, the mark's
// tile, and the tint around the code. Change the wash and every email sent after it follows; one already sent keeps
// its colours. Type is IBM Plex Sans and Plex Mono where the client loads web fonts (Apple Mail, iOS), Helvetica
// Neue / Arial and Menlo / Consolas elsewhere.
//
// Email-client rules it keeps: table layout and inline styles only (Gmail's apps drop most <style>). Gradients are CSS
// on cells that also carry a solid colour, so a client that drops gradients (Outlook, some Gmail views) shows the same
// layout flat: the glow becomes the card, the tile and the code panel keep a solid tint. The mark is the one image, a
// PNG with alt text, and the name sits beside it in text. The email is dark in every client (color-scheme dark).
//
// The code is one run of text, so selecting it copies "483625" (separate tiles copied as six cells). The plain-text
// part, the subject and the preheader carry the same code, so it shows in a notification and code autofill reads it.
import { DEFAULT_WASH, type WashSettings } from "../../src/shared/wash.js";

/** The v8 dark tokens (src/index.css html[data-v8]). */
const C = { page: "#0a0a0b", card: "#0e0e10", line: "#1f1f24", text: "#f4f4f5", body: "#c9c9d1", muted: "#8e8e98" };
const FONT = "'IBM Plex Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";
const FONTS_URL = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "#rrggbb" at an opacity, as rgba(). A colour that isn't #rrggbb falls back to the default wash's middle colour. */
export function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex) ?? /^#([0-9a-f]{6})$/i.exec(DEFAULT_WASH.b)!;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The name to greet: the first word of the account's name, or null (greet "there"). A word that reads like a link,
 *  an address or markup, or is too long to be a first name, isn't used: the name is typed by whoever owns the
 *  account, and a sign-in email shouldn't carry a URL from it. */
export function greetingName(displayName: string | null | undefined): string | null {
  const first = String(displayName ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().split(/\s+/)[0] ?? "";
  if (!first || /[/:@.<>&"]/.test(first) || first.length > 24) return null;
  return first;
}

export function codeEmail(code: string, opts: { minutes?: number; siteUrl?: string; name?: string | null; wash?: WashSettings } = {}): { subject: string; text: string; html: string } {
  const minutes = opts.minutes ?? 10;
  const site = (opts.siteUrl ?? "https://controlscout.org").replace(/\/$/, "");
  const host = site.replace(/^https?:\/\//, "");
  // Only #rrggbb reaches the markup: anything else falls back to the default wash's colour in that place.
  const hex = (v: string | undefined, d: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const w = { a: hex(opts.wash?.a, DEFAULT_WASH.a), b: hex(opts.wash?.b, DEFAULT_WASH.b), c: hex(opts.wash?.c, DEFAULT_WASH.c) };
  const hey = `Hey ${greetingName(opts.name) ?? "there"}`;
  const subject = `${code} is your Control Scout code`;
  const preheader = `${hey}, your sign-in code is ${code}. It expires in ${minutes} minutes.`;
  const text = [
    `${hey},`,
    "",
    `Here's your Control Scout sign-in code: ${code}`,
    "",
    `It expires in ${minutes} minutes.`,
    "",
    "Didn't ask for this? You can ignore this email. Nobody can sign in without the code.",
    "",
    `Control Scout · ${host}`,
  ].join("\n");

  const e = esc;
  const table = `role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`;
  // The glow: the wash's three colours across, fading down into the card. Flat (no gradients): just the card.
  const glow = `background-color:${C.card};background-image:linear-gradient(180deg,${rgba(C.card, 0)} 0%,${C.card} 100%),linear-gradient(90deg,${rgba(w.a, 0.42)} 0%,${rgba(w.b, 0.42)} 50%,${rgba(w.c, 0.42)} 100%)`;
  const tile = `background-color:${w.b};background-image:linear-gradient(135deg,${w.a} 0%,${w.c} 100%)`;
  const panel = `background-color:${C.page};background-image:linear-gradient(135deg,${rgba(w.a, 0.12)} 0%,${rgba(w.c, 0.1)} 100%);border:1px solid ${rgba(w.b, 0.45)}`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${e(subject)}</title>
<link href="${FONTS_URL}" rel="stylesheet">
<style>:root{color-scheme:dark;supported-color-schemes:dark}
@media (max-width:480px){.cs-pad{padding-left:24px!important;padding-right:24px!important}.cs-code{font-size:32px!important;letter-spacing:6px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${e(preheader)}${"&#8199;&#847;".repeat(40)}</div>
<table ${table} bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:40px 12px">
  <table ${table} bgcolor="${C.card}" style="max-width:480px;background:${C.card};border:1px solid ${C.line};border-radius:18px;border-collapse:separate;overflow:hidden">
    <tr><td data-glow class="cs-pad" bgcolor="${C.card}" style="${glow};border-radius:17px 17px 0 0;padding:28px 36px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td data-tile width="28" height="28" align="center" valign="middle" bgcolor="${w.b}" style="width:28px;height:28px;border-radius:8px;${tile}"><img src="${e(`${site}/email/mark-white.png`)}" width="16" height="16" alt="Control Scout" style="display:block;width:16px;height:16px;border:0;outline:none;text-decoration:none;color:${C.text};font-family:${FONT};font-size:9px"></td>
        <td style="padding-left:10px;vertical-align:middle;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;letter-spacing:0.1px;color:${C.text}">Control Scout</td>
      </tr></table>
      <p style="margin:44px 0 0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.2px;color:${C.text}">${e(hey)},</p>
      <p style="margin:4px 0 0;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body}">Here's your code to sign in to Control Scout.</p>
    </td></tr>
    <tr><td class="cs-pad" style="padding:20px 36px 0">
      <table ${table} style="border-collapse:separate"><tr><td data-panel bgcolor="${C.page}" style="${panel};border-radius:12px;padding:20px 24px 18px">
        <div class="cs-code" data-code="${e(code)}" style="font-family:${MONO};font-size:36px;line-height:44px;font-weight:600;letter-spacing:8px;color:${C.text};-webkit-user-select:all;user-select:all;mso-line-height-rule:exactly">${e(code)}</div>
        <div style="margin-top:6px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">Expires in ${minutes} minutes.</div>
      </td></tr></table>
    </td></tr>
    <tr><td class="cs-pad" style="padding:32px 36px 32px">
      <table ${table} style="border-top:1px solid ${C.line}"><tr><td style="padding-top:20px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">Didn't ask for this? You can ignore this email. Nobody can sign in without the code.</td></tr></table>
    </td></tr>
  </table>
  <p style="margin:20px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">Control Scout &middot; <a href="${e(site)}" style="color:${C.muted};text-decoration:underline">${e(host)}</a></p>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
