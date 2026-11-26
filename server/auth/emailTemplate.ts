// The sign-in code email, in the v8 site's look: the near-black page, the warm wash across the top (orange, rose,
// purple: the site's live wash), the white mark, a rounded card with hairline lines, and the code big in mono.
// It reads as a short note from a person ("Hey Sam, here's your code"), not a system notice.
//
// Email-client rules it keeps: table layout and inline styles only (Gmail's apps drop most <style>); the wash and the
// glow at the bottom are hosted JPEGs (public/email/, drawn by scripts/email-art.ts) set as cell backgrounds over a
// solid colour, so Outlook and image-blocking clients get the same layout in flat colours; the mark is a PNG (WebP
// doesn't show in Outlook) with alt text, and the name sits beside it in text. The email is dark in every client
// (color-scheme dark): Apple Mail shows it as drawn in Light and Dark. Clients that recolour everything themselves
// (Gmail's apps in dark mode) still get solid, high-contrast text: nothing important is grey on grey.
//
// The code is one run of text, so selecting it copies "483625" (separate tiles copied as six cells). The plain-text
// part, the subject and the preheader carry the same code, so it shows in a notification and code autofill reads it.

/** The v8 dark tokens (src/index.css html[data-v8]) and the live wash (Sunset, src/shared/wash.ts WASH_PRESETS). */
const C = {
  page: "#0a0a0b", card: "#0e0e10", panel: "#141416", line: "#232328", text: "#f4f4f5", body: "#d4d4d8", muted: "#a1a1aa",
  accent: "#a3b6e0", washA: "#d0784a", washB: "#c2557a", washC: "#7c4fa8",
  /** The header where its image doesn't load (Outlook, images off): the card itself, so no hard band ends under it. */
  washFlat: "#0e0e10",
  chip: "#1d1a24", chipLine: "#2e2838", chipText: "#e9d5ff",
};
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";
/** Who the note is from. */
export const SIGNER = "Sushil";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The name to greet: the first word of the account's name, or null (greet "there"). A word that reads like a link,
 *  an address or markup, or is too long to be a first name, isn't used: the name is typed by whoever owns the
 *  account, and a sign-in email shouldn't carry a URL from it. */
export function greetingName(displayName: string | null | undefined): string | null {
  const first = String(displayName ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().split(/\s+/)[0] ?? "";
  if (!first || /[/:@.<>&"]/.test(first) || first.length > 24) return null;
  return first;
}

export function codeEmail(code: string, opts: { minutes?: number; siteUrl?: string; name?: string | null } = {}): { subject: string; text: string; html: string } {
  const minutes = opts.minutes ?? 10;
  const site = (opts.siteUrl ?? "https://controlscout.org").replace(/\/$/, "");
  const host = site.replace(/^https?:\/\//, "");
  const hey = `Hey ${greetingName(opts.name) ?? "there"}`;
  const subject = `${code} is your Control Scout code`;
  const preheader = `${hey}, your sign-in code is ${code}. It works for ${minutes} minutes.`;
  const text = [
    `${hey},`,
    "",
    `Here's your Control Scout sign-in code: ${code}`,
    "",
    `Type it into the sign-in box and you're in. It works for ${minutes} minutes, and one account covers Control Scout and Control Point.`,
    "",
    "Didn't ask for this? Just ignore it: nobody can sign in without the code, and it runs out on its own.",
    "",
    "Happy scouting,",
    `${SIGNER}, Control Scout`,
    "",
    `Control Scout · FTC match predictions · ${host}`,
  ].join("\n");

  const e = esc;
  const art = (file: string) => e(`${site}/email/${file}`);
  // Letter-spacing spreads the digits without adding characters; the left padding balances the space after the last one.
  const codeCell = `<td class="cs-code" data-code="${e(code)}" align="center" style="padding:2px 0 0 10px;font-family:${MONO};font-size:40px;line-height:48px;font-weight:700;letter-spacing:10px;color:${C.text};-webkit-user-select:all;user-select:all;mso-line-height-rule:exactly">${e(code)}</td>`;
  // The three wash colours as a thin rule along the panel's foot: the site's gradient, in plain cells every client draws.
  const washRule = ([C.washA, C.washB, C.washC] as const)
    .map((c, i) => `<td width="${i === 1 ? 34 : 33}%" height="3" style="height:3px;background:${c};font-size:0;line-height:0">&nbsp;</td>`).join("");
  const dot = (c: string) => `<span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${c};vertical-align:middle;margin-right:4px"></span>`;
  const table = `role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${e(subject)}</title>
<style>:root{color-scheme:dark;supported-color-schemes:dark}
@media (max-width:480px){.cs-pad{padding-left:22px!important;padding-right:22px!important}.cs-code{font-size:34px!important;letter-spacing:7px!important;padding-left:7px!important}.cs-hey{font-size:26px!important}.cs-gap{padding-top:52px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${e(preheader)}${"&#8199;&#847;".repeat(40)}</div>
<table ${table} bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:28px 10px 32px">
  <table ${table} bgcolor="${C.card}" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:20px;overflow:hidden;border-collapse:separate">
    <tr><td data-wash background="${art("code-wash.jpg")}" bgcolor="${C.washFlat}" valign="top" style="background-color:${C.washFlat};background-image:url('${art("code-wash.jpg")}');background-size:100% 100%;background-position:center top;background-repeat:no-repeat;border-radius:19px 19px 0 0">
      <table ${table}><tr><td class="cs-pad" style="padding:24px 32px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="26" style="width:26px;line-height:0;vertical-align:middle"><img src="${art("mark-white.png")}" width="26" height="26" alt="Control Scout" style="display:block;width:26px;height:26px;border:0;outline:none;text-decoration:none;color:${C.text};font-family:${FONT};font-size:10px"></td>
          <td style="padding-left:10px;vertical-align:middle;font-family:${DISPLAY};font-size:16px;line-height:20px;font-weight:700;letter-spacing:-0.2px;color:#ffffff">Control Scout</td>
        </tr></table>
      </td></tr>
      <tr><td class="cs-pad cs-gap" style="padding:64px 32px 4px">
        <h1 class="cs-hey" style="margin:0;font-family:${DISPLAY};font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-0.5px;color:#ffffff">${e(hey)},</h1>
        <p style="margin:8px 0 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.body}">here's your code to sign in to Control Scout.</p>
      </td></tr></table>
    </td></tr>
    <tr><td class="cs-pad" style="padding:22px 32px 0">
      <table ${table} bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.line};border-radius:16px;overflow:hidden;border-collapse:separate">
        <tr><td align="center" style="padding:20px 16px 2px;font-family:${FONT};font-size:11px;line-height:14px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.muted}">${dot(C.washA)}${dot(C.washB)}${dot(C.washC)}&nbsp;Your sign-in code</td></tr>
        <tr><td align="center" style="padding:6px 12px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${codeCell}</tr></table></td></tr>
        <tr><td align="center" style="padding:12px 16px 20px;font-family:${FONT}">
          <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${C.chip};border:1px solid ${C.chipLine};color:${C.chipText};font-size:12px;line-height:16px;font-weight:600">Works for ${minutes} minutes</span>
        </td></tr>
        <tr><td style="font-size:0;line-height:0"><table ${table} style="border-collapse:collapse"><tr>${washRule}</tr></table></td></tr>
      </table>
    </td></tr>
    <tr><td class="cs-pad" style="padding:24px 32px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.body}">
      <p style="margin:0">Type it into the sign-in box and you're in. One account covers Control Scout and Control Point, so you're signed in to both.</p>
      <p style="margin:18px 0 0">Happy scouting,<br><span style="font-family:${DISPLAY};font-size:17px;line-height:26px;font-weight:700;color:${C.text}">${e(SIGNER)}</span><span style="color:${C.muted}"> &middot; Control Scout</span></p>
    </td></tr>
    <tr><td data-glow background="${art("code-glow.jpg")}" bgcolor="${C.card}" style="background-color:${C.card};background-image:url('${art("code-glow.jpg")}');background-size:100% 100%;background-position:center bottom;background-repeat:no-repeat;border-radius:0 0 19px 19px">
      <table ${table}><tr><td class="cs-pad" style="padding:24px 32px 72px">
        <table ${table} style="border-top:1px solid ${C.line}"><tr><td style="padding-top:16px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted}">
          <strong style="color:${C.body};font-weight:600">Didn't ask for this?</strong> Just ignore it: nobody can sign in without the code, and it runs out on its own.
        </td></tr></table>
      </td></tr></table>
    </td></tr>
  </table>
  <p style="margin:18px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">Control Scout &middot; FTC match predictions &middot; <a href="${e(site)}" style="color:${C.accent};text-decoration:none">${e(host)}</a></p>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
