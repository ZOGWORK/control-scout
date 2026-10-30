// The email digest's welcome email (docs/digest.md): sent once, the first time an account turns the digest on, so the
// person knows what's coming and how to stop it. It says what each digest holds, lists the teams it will follow, and
// says how often ("a few times a week", never a day or time). Same look as the digest (template.ts layout).
//
// Once per account (digest_prefs.welcomed_at): turning the digest off and on again sends nothing more. A send that
// fails clears the mark, so the next turn-on tries again. The owner console can send one to the owner's own account
// at any time, to see it (`force`); that never changes the mark.
import { all, get, run } from "../db.js";
import { sendEmail } from "../auth/email.js";
import { cleanValue, EMPTY_STATE } from "../../src/shared/personal.js";
import { firstName, followedTeams, siteUrl, unsubscribeUrl } from "./job.js";
import { FONT, L, a, esc, h2, item, layout, moreLink, url, type Links } from "./template.js";

/** How many followed teams the welcome lists by name before "and N more". */
export const WELCOME_TEAMS = 10;

export interface WelcomeTeam { team: number; teamName: string | null }

const WHAT: [string, string][] = [
  ["Your teams' results", "Record, seed, playoff finish and OPR from every event they play."],
  ["Prediction check-in", "How our pre-match calls on their matches did, good run or bad."],
  ["Coming up", "Their next events, with a countdown."],
  ["Power rankings", "Where they land when the weekly top 25 comes out."],
];

const paragraph = (html: string) => `<tr><td style="padding:12px 32px 0;font-family:${FONT};font-size:16px;line-height:25px" class="cs-pad"><span class="cs-body" style="color:${L.body}">${html}</span></td></tr>`;

export function welcomeEmail(i: { links: Links; name: string | null; teams: WelcomeTeam[] }): { subject: string; text: string; html: string } {
  const site = i.links.site;
  const subject = "Welcome to the Control Scout email digest";
  const shown = i.teams.slice(0, WELCOME_TEAMS), more = i.teams.length - shown.length;
  const intro = "You're signed up for the Control Scout email digest. Here's what to expect.";
  const rows: string[] = [h2("What you'll get")];
  for (const [title, body] of WHAT) {
    rows.push(item(`<div class="cs-text" style="font-size:16px;line-height:24px;font-weight:700;color:${L.text}">${esc(title)}</div>
      <div class="cs-body" style="margin-top:2px;font-size:15px;line-height:22px;color:${L.body}">${esc(body)}</div>`));
  }
  rows.push(h2("How often"));
  rows.push(paragraph("A few times a week, and only when there's something new about your teams. A quiet stretch means no email."));
  if (shown.length) {
    rows.push(h2("The teams you follow", "The digest covers your team and the teams you track."));
    for (const t of shown) {
      rows.push(item(`<div style="font-size:16px;line-height:24px">${a(url(site, `/teams/${t.team}`), String(t.team))}${t.teamName ? `<span class="cs-muted" style="color:${L.muted}"> ${esc(t.teamName)}</span>` : ""}</div>`));
    }
    rows.push(moreLink(more > 0 ? `${more} more: change who you follow` : "Change who you follow", url(site, "/my-team")));
  } else {
    rows.push(h2("The teams you follow"));
    rows.push(paragraph(`You don't follow any teams yet, so there's nothing to send. ${a(url(site, "/my-team"), "Pick your team")} or track teams from their pages, and the digest starts with them.`));
  }
  const html = layout({
    subject, preheader: "What's in it, how often it comes, and the teams it follows.", links: i.links,
    title: "Welcome to your email digest", name: i.name, intro, rows,
    footer: "You can turn it off any time, in one click.",
    cta: { text: "See your teams", href: url(site, "/my-team") },
  });
  const text = [
    `Hi ${i.name ?? "there"},`, "", intro, "",
    "WHAT YOU'LL GET", "", ...WHAT.map(([t, b]) => `${t}: ${b}`), "",
    "HOW OFTEN", "", "A few times a week, and only when there's something new about your teams. A quiet stretch means no email.", "",
    "THE TEAMS YOU FOLLOW", "",
    ...(shown.length
      ? [...shown.map((t) => `${t.teamName ? `${t.team} ${t.teamName}` : t.team}  ${url(site, `/teams/${t.team}`)}`), ...(more > 0 ? [`and ${more} more`] : [])]
      : ["You don't follow any teams yet, so there's nothing to send. Pick your team or track teams from their pages."]),
    `Change who you follow: ${url(site, "/my-team")}`, "",
    "See you at the next event,", "The Control Scout team", "", "---",
    `You're getting this because you turned on the email digest for ${i.links.email}.`,
    `Unsubscribe: ${i.links.unsubscribe}`, `Manage email preferences: ${url(site, "/settings?section=notifications")}`,
  ].join("\n");
  return { subject, text, html };
}

const parse = <K extends "myTeam" | "tracked">(key: K, raw: unknown) => {
  if (typeof raw !== "string") return null;
  try { return cleanValue(key, JSON.parse(raw)); } catch { return null; }
};

export type WelcomeResult = "sent" | "skipped" | "failed";

/**
 * Send the account its welcome email: once (the first time it turns the digest on), or always with `force` (the owner
 * previewing it on their own account). Needs the digest on, an unbounced address and an unsubscribe link.
 */
export async function sendWelcome(userId: number, o: { force?: boolean } = {}): Promise<WelcomeResult> {
  const r = await get<any>(
    `SELECT d.enabled, d.token, d.bounced_at, d.welcomed_at, u.email, u.display_name,
       (SELECT value FROM user_state x WHERE x.user_id = d.user_id AND x.key = 'myTeam') my_team,
       (SELECT value FROM user_state x WHERE x.user_id = d.user_id AND x.key = 'tracked') tracked
     FROM digest_prefs d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?`, [userId]);
  if (!r || Number(r.enabled) !== 1 || r.bounced_at != null || !r.email) return "skipped";
  const at = new Date().toISOString();
  // Claimed before sending, so two quick toggles (or two servers) send one welcome.
  if (!o.force && (await run("UPDATE digest_prefs SET welcomed_at = ? WHERE user_id = ? AND welcomed_at IS NULL", [at, userId])) !== 1) return "skipped";
  try {
    const teams = followedTeams(parse("myTeam", r.my_team) ?? null, (parse("tracked", r.tracked) ?? EMPTY_STATE.tracked).teams);
    const names = teams.length
      ? new Map((await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${teams.map(() => "?").join(",")})`, teams))
        .map((t) => [Number(t.number), t.name?.trim() || null]))
      : new Map<number, string | null>();
    const unsub = unsubscribeUrl(String(r.token));
    const mail = welcomeEmail({
      links: { site: siteUrl(), unsubscribe: unsub, email: String(r.email) }, name: firstName(r.display_name),
      teams: teams.map((t) => ({ team: t, teamName: names.get(t) ?? null })),
    });
    await sendEmail(String(r.email), mail.subject, mail.text, mail.html, {
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    return "sent";
  } catch (e) {
    // Any failure after the claim (reading the teams, building or sending the email) leaves it unsent: clear the mark.
    if (!o.force) await run("UPDATE digest_prefs SET welcomed_at = NULL WHERE user_id = ? AND welcomed_at = ?", [userId, at]);
    console.warn(`[digest] welcome not sent to account ${userId}: ${(e as Error)?.message ?? e}`);
    return "failed";
  }
}
