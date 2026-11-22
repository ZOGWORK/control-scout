// "Report this to ControlScout": a member asks the bot, in a Discord message, to file a bug report — and it opens a
// GitHub issue itself with everything it can see: the message, the answer it replies to (the thread before it), where
// it happened, and the last lines of its own log. It files through the site's one GitHub path (server/errorReports.ts
// `gh`, GITHUB_REPORT_TOKEN, docs/error-reporting.md), so there is no second token and no second client.
//
// Nothing here may fail loudly: a report that can't be filed is said plainly in the channel and logged (the reason
// only, never the token or anything from the report), and the bot carries on.
import { gh, GITHUB_REPO, reportSlotsLeft, returnReportSlot, takeReportSlot } from "../server/errorReports.js";
import { env } from "../server/env.js";
import { RELEASE } from "../server/release.js";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";

/** The words that ask for a report: "report this to ControlScout", "Report this to Control Scout", any case, any
 *  spacing around Scout. Deliberately narrow: only an explicit request files an issue. */
export const REPORT_TRIGGER = /\breport\s+(?:this|that|it)\s+to\s+control\s*scout\b/i;

/** Whether a message asks for a report. `report this to Control Scout` and `report it to controlscout` both count. */
export const wantsReport = (q: string) => REPORT_TRIGGER.test(q);

/** The issue's title, as asked for: every report is a "Discord type issue". */
export const REPORT_TITLE = "Discord type issue";
/** The labels a report carries: the same the site's own error reports use (server/errorReports.ts). */
export const REPORT_LABELS = ["bug", "auto-reported"];

/** What the bot can see when it files: where it happened and who asked (Discord ids, never an email), the message
 *  that asked, the thread before it, and the bot's own recent log lines (no secret, no id: bot/handler.ts keeps them). */
export interface Report {
  guild: string | null;
  channel: string | null;
  user: string;
  name: string | null;
  message: string;
  thread: BrunoChatTurn[];
  logs: string[];
}

/** Reports one person, and one server, may file an hour: an issue is public and filed under the site's own token (and
 *  its GitHub rate limit, shared with the site's error reports), so the phrase can't be repeated into a flood. */
export const REPORT_LIMITS = { user: 3, guild: 8 };

/** Filed (its number and link), or why not — `limited`: this person or server has had its few already. */
export type Filed = { ok: true; number: number; url: string } | { ok: false; reason: string; limited?: boolean };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Discord text in an issue: it's filed under the bot's own GitHub identity, so a member can't use a report to ping a
 *  stranger or cross-reference an issue — an @mention and a #123 lose their trigger (a zero-width space) and nothing
 *  else about the text changes. */
const quiet = (s: string) => s.replace(/@(?=[\w-])/g, "@\u200B").replace(/#(?=\d)/g, "#\u200B");
/** A log line is text from the bot's own log: keep it inside the body's fence whatever it holds. */
const fenced = (s: string) => clip(s.replace(/```/g, "'''"), 300);

/** The issue's body: everything the bot saw, in the order someone fixing it needs it. */
export function reportBody(r: Report, now = Date.now()): string {
  const thread = r.thread.slice(-6);
  const lines = [
    "_Reported from Discord by Control Scout itself, at a member's request._",
    "",
    "### The message that asked for it",
    quiet(clip(r.message, 1500)),
    ...(thread.length ? ["", "### The thread before it", ...thread.map((t) => `- **${t.role === "user" ? "Person" : "Control Scout"}:** ${quiet(clip(t.text, 1200))}`)] : []),
    "",
    "### Where",
    `- **Server:** \`${r.guild ?? "unknown"}\``,
    `- **Channel:** \`${r.channel ?? "unknown"}\``,
    `- **Asked by:** ${quiet(clip(r.name ?? "a member", 100))} (\`${r.user}\`)`,
    "",
    `### The bot's last log lines (${r.logs.length})`,
    "```",
    ...(r.logs.length ? r.logs.map(fenced) : ["(nothing logged yet)"]),
    "```",
    "",
    `**Release:** \`${RELEASE ?? "development"}\` · **Reported:** ${new Date(now).toISOString()}`,
    "",
    `_Repo: ${GITHUB_REPO}_`,
  ];
  return lines.join("\n").slice(0, 60_000);
}

/** File one report as a GitHub issue, or say why not. Never throws: a failure is the caller's to say plainly. */
/** The startup line: whether "Report this to ControlScout" can file at all, so it can be confirmed from the journal
 *  without trying it (and without a test issue). Says whether the token is set, never what it is. */
export function reportSetup(): { on: boolean; line: string } {
  return env.githubReportToken
    ? { on: true, line: "report filing on: GITHUB_REPORT_TOKEN is set" }
    : { on: false, line: "report filing off: GITHUB_REPORT_TOKEN is not set (a report says it couldn't be filed)" };
}

export async function fileReport(r: Report, now = Date.now()): Promise<Filed> {
  const token = env.githubReportToken;
  if (!token) return { ok: false, reason: "reporting isn't set up (GITHUB_REPORT_TOKEN)" };
  // A few an hour per person and per server, through the site's own limiter (server/errorReports.ts): a report files a
  // public issue under the bot's identity, so one member can't flood the repository (or the token's shared limit).
  // Both are checked before either is spent, so a server at its cap doesn't use up its member's own few.
  const person = `discord:user:${r.user}`, server = r.guild ? `discord:guild:${r.guild}` : null;
  if (reportSlotsLeft(person, REPORT_LIMITS.user, now) <= 0) {
    return { ok: false, limited: true, reason: "too many reports from that person this hour" };
  }
  if (server && reportSlotsLeft(server, REPORT_LIMITS.guild, now) <= 0) {
    return { ok: false, limited: true, reason: "too many reports from that server this hour" };
  }
  takeReportSlot(person, REPORT_LIMITS.user, now);
  if (server) takeReportSlot(server, REPORT_LIMITS.guild, now);
  try {
    const issue = await gh<{ number: number; html_url?: string }>(token, "POST", "/issues", {
      title: REPORT_TITLE, body: reportBody(r, now), labels: REPORT_LABELS,
    });
    const number = Number(issue.number);
    return { ok: true, number, url: issue.html_url ?? `https://github.com/${GITHUB_REPO}/issues/${number}` };
  } catch (e) {
    // Nothing came back, so nothing was handed out: the slots go back, and the next try isn't locked out by failures.
    returnReportSlot(person);
    if (server) returnReportSlot(server);
    const status = (e as { status?: number })?.status;
    return { ok: false, reason: status ? `GitHub answered ${status}` : `${(e as Error)?.message ?? "no answer"}` };
  }
}
