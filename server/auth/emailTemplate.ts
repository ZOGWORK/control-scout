// The sign-in code email, in the site's own look: graphite card, gold accent,
// the site's logo, and the code as one run of text so it selects and copies
// as "483625" (separate tiles copied as six cells with a blue block each).
// Table layout and inline styles only (what Gmail, Outlook and Apple Mail all
// render). The logo is the one image; if it's blocked the name still reads.
// The plain-text part carries the same code for clients (and code autofill)
// that read text.

const C = {
  page: "#0a0a0b", card: "#141416", line: "#26262b", text: "#f4f4f5", muted: "#a1a1aa", faint: "#71717a",
  gold: "#ffc700", goldSoft: "#2a2306", tile: "#1c1c20",
};
const FONT = "Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "'Space Grotesk',Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace";

export function codeEmail(code: string, opts: { minutes?: number; siteUrl?: string } = {}): { subject: string; text: string; html: string } {
  const minutes = opts.minutes ?? 10;
  const site = (opts.siteUrl ?? "https://controlscout.org").replace(/\/$/, "");
  const host = site.replace(/^https?:\/\//, "");
  const subject = `${code} is your Control Scout code`;
  const text = [
    `Your Control Scout sign-in code: ${code}`,
    "",
    `Enter it in the sign-in panel. It expires in ${minutes} minutes.`,
    "If you didn't ask for this, ignore this email: nobody can sign in without the code.",
    "",
    `Control Scout · FTC match predictions · ${host}`,
  ].join("\n");
  // Letter-spacing spreads the digits without adding characters; the extra
  // left padding balances the spacing after the last digit.
  const codeBox = `<td data-code="${code}" style="padding:14px 18px 14px 30px;background:${C.tile};border:1px solid ${C.line};border-bottom:2px solid ${C.gold};border-radius:12px;font-family:${MONO};font-size:32px;line-height:40px;font-weight:700;letter-spacing:12px;color:${C.text};-webkit-user-select:all;user-select:all">${code}</td>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your sign-in code is ${code}. It expires in ${minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:${C.card};border:1px solid ${C.line};border-radius:18px;overflow:hidden">
    <tr><td style="height:4px;background:${C.gold};font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:28px 24px 8px;font-family:${FONT}">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:32px;height:32px;line-height:0"><img src="${site}/logo.png" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;border-radius:8px"></td>
        <td style="padding-left:10px;font-family:${DISPLAY};font-size:17px;font-weight:700;letter-spacing:-0.2px;color:${C.text}">Control <span style="color:${C.gold}">Scout</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 24px 0;font-family:${FONT}">
      <h1 style="margin:0;font-family:${DISPLAY};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.3px;color:${C.text}">Your sign-in code</h1>
      <p style="margin:8px 0 0;font-size:14px;line-height:1.55;color:${C.muted}">Enter this code in the sign-in panel to finish signing in.</p>
    </td></tr>
    <tr><td align="center" style="padding:24px 12px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${codeBox}</tr></table>
    </td></tr>
    <tr><td align="center" style="padding:8px 24px 0;font-family:${FONT}">
      <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${C.goldSoft};color:${C.gold};font-size:12px;font-weight:600">Expires in ${minutes} minutes</span>
    </td></tr>
    <tr><td style="padding:24px 24px 28px;font-family:${FONT}">
      <p style="margin:0;padding-top:18px;border-top:1px solid ${C.line};font-size:12px;line-height:1.6;color:${C.faint}">Didn't ask for this? You can ignore this email: nobody can sign in without the code. One account works for Control Scout and Control Point.</p>
    </td></tr>
  </table>
  <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:${C.faint}">Control Scout · FTC match predictions · <a href="${site}" style="color:${C.muted};text-decoration:none">${host}</a></p>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}
