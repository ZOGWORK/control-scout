// The sign-in code email, in the v8 site's look (no gold anywhere): the near-black page, the warm wash across the top
// (orange, rose, purple: the site's live wash) with its grain, a faint field of tiles and a ribbon of particle dots,
// the white mark, a rounded card with hairline lines, the code big in mono on a panel with a soft mint glow, and mint
// as the accent. It reads as a short note from a person ("Hey Sam, here's your code"), not a system notice.
//
// Email-client rules it keeps: table layout and inline styles only (Gmail's apps drop most <style>); the wash, the
// code panel's glow and the glow at the foot are hosted JPEGs (public/email/, drawn by scripts/email-art.ts) set as
// cell backgrounds over a solid colour, so Outlook and image-blocking clients get the same layout in flat colours; the
// mark is a PNG (WebP doesn't show in Outlook) with alt text, and the name sits beside it in text. The email is dark in
// every client (color-scheme dark): Apple Mail shows it as drawn in Light and Dark. Clients that recolour everything
// themselves (Gmail's apps in dark mode) still get solid, high-contrast text: nothing important is grey on grey.
//
// The code is one run of text, so selecting it copies "483625" (separate tiles copied as six cells). The plain-text
// part, the subject and the preheader carry the same code, so it shows in a notification and code autofill reads it.

/** The v8 dark tokens (src/index.css html[data-v8]) and the live wash (Sunset, src/shared/wash.ts WASH_PRESETS). */
const C = {
  page: "#0a0a0b", card: "#0e0e10", panel: "#141416", line: "#232328", text: "#f4f4f5", body: "#d4d4d8", muted: "#a1a1aa",
  washA: "#d0784a", washB: "#c2557a", washC: "#7c4fa8",
  /** The header where its image doesn't load (Outlook, images off): the card itself, so no hard band ends under it. */
  washFlat: "#0e0e10",
  /** Mint, the accent (the site's success green; a step lighter for small text on the dark card). */
  mint: "#34d399", mintText: "#6ee7b7", mintSoft: "#0f2a21", mintLine: "#1d4a3a",
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
    `Pop it into the sign-in box and you're in. It works for ${minutes} minutes, and one account covers Control Scout and Control Point.`,
    "",
    "Didn't ask for this? Just ignore it. Nobody can sign in without the code, and it runs out on its own.",
    "",
    "Happy scouting,",
    `${SIGNER}, Control Scout`,
    "",
    `Control Scout · free FTC scouting and predictions · ${host}`,
  ].join("\n");

  const e = esc;
  const art = (file: string) => e(`${site}/email/${file}`);
  const table = `role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`;
  const inline = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;
  /** A cell's attributes with a hosted image behind it, over a solid colour (Outlook and image-off clients show only
   *  the colour). The style attribute is left open for the caller to add to. */
  const bg = (file: string, colour: string, size: string, pos: string) =>
    `background="${art(file)}" bgcolor="${colour}" style="background-color:${colour};background-image:url('${art(file)}');background-size:${size};background-position:${pos};background-repeat:no-repeat`;
  // Letter-spacing spreads the digits without adding characters; the left padding balances the space after the last one.
  const codeCell = `<td class="cs-code" data-code="${e(code)}" align="center" style="padding:0 0 0 12px;font-family:${MONO};font-size:46px;line-height:56px;font-weight:700;letter-spacing:12px;color:#ffffff;-webkit-user-select:all;user-select:all;mso-line-height-rule:exactly">${e(code)}</td>`;
  // The three wash colours as a thin rule: the site's gradient, in plain cells every client draws.
  const washRule = ([C.washA, C.washB, C.washC] as const)
    .map((c, i) => `<td width="${i === 1 ? 34 : 33}%" height="3" style="height:3px;background:${c};font-size:0;line-height:0">&nbsp;</td>`).join("");
  // The sign-off's mark is decoration (the name is beside it), so it has empty alt text.
  const mark = (size: number, centred = false) => `<img src="${art("mark-white.png")}" width="${size}" height="${size}" alt="${centred ? "" : "Control Scout"}" style="display:block;${centred ? "margin:0 auto;" : ""}width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;color:${C.text};font-family:${FONT};font-size:9px">`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${e(subject)}</title>
<style>:root{color-scheme:dark;supported-color-schemes:dark}
@media (max-width:480px){.cs-pad{padding-left:24px!important;padding-right:24px!important}.cs-code{font-size:36px!important;line-height:46px!important;letter-spacing:8px!important;padding-left:8px!important}.cs-hey{font-size:30px!important}.cs-gap{padding-top:64px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${e(preheader)}${"&#8199;&#847;".repeat(40)}</div>
<table ${table} bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:32px 12px 36px">
  <table ${table} bgcolor="${C.card}" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:24px;overflow:hidden;border-collapse:separate">
    <tr><td data-wash valign="top" ${bg("code-wash.jpg", C.washFlat, "cover", "center top")};border-radius:23px 23px 0 0">
      <table ${table}><tr><td class="cs-pad" style="padding:28px 40px 0">
        <table ${inline}><tr>
          <td width="24" style="width:24px;line-height:0;vertical-align:middle">${mark(24)}</td>
          <td style="padding-left:10px;vertical-align:middle;font-family:${DISPLAY};font-size:15px;line-height:20px;font-weight:700;letter-spacing:-0.1px;color:#ffffff">Control Scout</td>
        </tr></table>
      </td></tr>
      <tr><td class="cs-pad cs-gap" style="padding:84px 40px 8px">
        <h1 class="cs-hey" style="margin:0;font-family:${DISPLAY};font-size:36px;line-height:1.12;font-weight:700;letter-spacing:-0.8px;color:#ffffff">${e(hey)},</h1>
        <p style="margin:12px 0 0;font-family:${FONT};font-size:17px;line-height:1.55;color:${C.body}">here&#39;s your code to sign in.</p>
      </td></tr></table>
    </td></tr>
    <tr><td class="cs-pad" style="padding:28px 40px 0">
      <table ${table} style="border:1px solid ${C.line};border-radius:18px;overflow:hidden;border-collapse:separate">
        <tr><td data-panel ${bg("code-panel.jpg", C.panel, "cover", "center center")};border-radius:17px 17px 0 0">
          <table ${table}>
            <tr><td align="center" style="padding:26px 16px 6px;font-family:${FONT};font-size:11px;line-height:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.muted}">Your sign-in code</td></tr>
            <tr><td align="center" style="padding:8px 12px 2px"><table ${inline}><tr>${codeCell}</tr></table></td></tr>
            <tr><td align="center" style="padding:16px 16px 26px">
              <table ${inline}><tr><td style="padding:6px 14px;border-radius:999px;background:${C.mintSoft};border:1px solid ${C.mintLine};font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${C.mintText}"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${C.mint};vertical-align:middle;margin:-2px 7px 0 0"></span>Works for ${minutes} minutes</td></tr></table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="font-size:0;line-height:0"><table ${table} style="border-collapse:collapse"><tr>${washRule}</tr></table></td></tr>
      </table>
    </td></tr>
    <tr><td class="cs-pad" style="padding:32px 40px 0;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.body}">
      <p style="margin:0">Pop it into the sign-in box and you&#39;re in. One account covers Control Scout and Control Point, so you&#39;re set on both.</p>
      <table ${inline} style="margin-top:26px"><tr>
        <td width="40" style="width:40px;vertical-align:middle">
          <table ${inline}><tr><td width="40" height="40" align="center" valign="middle" bgcolor="${C.washB}" style="width:40px;height:40px;border-radius:20px;background-color:${C.washB};background-image:linear-gradient(135deg,${C.washA},${C.washB} 50%,${C.washC})">${mark(20, true)}</td></tr></table>
        </td>
        <td style="padding-left:14px;vertical-align:middle;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted}">Happy scouting,<br><span style="font-family:${DISPLAY};font-size:16px;line-height:22px;font-weight:700;color:${C.text}">${e(SIGNER)}</span><span style="color:${C.muted}"> &middot; Control Scout</span></td>
      </tr></table>
    </td></tr>
    <tr><td data-glow ${bg("code-glow.jpg", C.card, "100% 100%", "center bottom")};border-radius:0 0 23px 23px">
      <table ${table}><tr><td class="cs-pad" style="padding:32px 40px 76px">
        <table ${table} style="border-top:1px solid ${C.line}"><tr><td style="padding-top:20px;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted}">
          <strong style="color:${C.body};font-weight:600">Didn&#39;t ask for this?</strong> Just ignore it. Nobody can sign in without the code, and it runs out on its own.
        </td></tr></table>
      </td></tr></table>
    </td></tr>
  </table>
  <table ${inline} style="margin-top:22px">
    <tr><td align="center" style="font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">Control Scout &middot; free FTC scouting and predictions</td></tr>
    <tr><td align="center" style="padding-top:4px;font-family:${FONT};font-size:12px;line-height:18px"><a href="${e(site)}" style="color:${C.mintText};text-decoration:none;font-weight:600">${e(host)}</a></td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
