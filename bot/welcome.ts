// What a server sees the first time Control Scout is added: one short embed with the three things to do next, so an
// install becomes a follow (the bot's most useful, least discovered feature) instead of a bot nobody opens /help on.
// Sent once per join by bot/index.ts; no command and no stored state.
import type { APIEmbed } from "discord.js";
import { FOOTER, VOLT } from "./views.js";
import { ASK_CHANNEL } from "./ambient.js";

/** The welcome, in a server with no state yet: the same words whether the bot was just added or added back. */
export function welcomeEmbed(): APIEmbed {
  return {
    title: "Control Scout is here",
    description: [
      "I answer FTC questions from Control Scout's own data — records, OPR, rankings, events and match calls — and I can post a team's matches in a channel as they happen.",
      "",
      `**1. Follow your team.** \`/follow team:4215 channel:#scouting\` posts the evening before each event, the schedule, a reminder 15 minutes before each match, every result with whether the call was right, and a recap at the end of each day.`,
      `**2. Ask anything.** Mention me (\`@Control Scout who won decode\`), use \`/ask\`, or make a channel called \`#${ASK_CHANNEL}\` and just type your question there.`,
      "**3. Check what I can do.** `/help` lists every command; `/config` (Manage Server) says what is on here, live.",
      "",
      "I read only messages that mention me or reply to me — plus, if you make it, that one ask channel. Everything else in your server is none of my business.",
    ].join("\n"),
    color: VOLT,
    footer: FOOTER,
  };
}
