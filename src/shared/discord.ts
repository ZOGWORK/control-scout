// The Control Scout Discord bot's invite link (bot/README.md), for the FAQ and the site footer.

/**
 * The bot's application (client) ID from the Discord developer portal (General Information →
 * Application ID). Public by design: it's in every invite link. Set to null to hide the FAQ answer and
 * the footer link (e.g. while the bot is offline), so nobody sees an invite that doesn't work.
 */
export const DISCORD_CLIENT_ID: string | null = "1562258217873047562";

/** The bot's only permissions: Send Messages (2048) + Embed Links (16384) + Use Application Commands (2^31) + Add
 *  Reactions (64), for the 👍 it puts on its answers, Read Message History (65536), which reading back its own
 *  answers needs: the one-time sweep that takes its stale 👎s off them (bot/cleanup.ts), and Create Public Threads
 *  (2^34) + Send Messages in Threads (2^38), where an answer in a server's ask channel goes (bot/ambient.ts). */
export const DISCORD_PERMISSIONS = 2048 + 16384 + 64 + 65536 + 2 ** 31 + 2 ** 34 + 2 ** 38;

/** The OAuth2 invite: scopes bot + applications.commands, the minimal permissions; null without a client ID. */
export function discordInviteUrl(clientId: string | null = DISCORD_CLIENT_ID): string | null {
  if (!clientId || !/^\d{15,22}$/.test(clientId)) return null;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=${DISCORD_PERMISSIONS}`;
}

/** Every bot command in words: the bot's /help and the site's "Control Scout in Discord" card read this list. */
export const BOT_COMMANDS: { usage: string; what: string; admin?: true }[] = [
  { usage: "/team number:", what: "A team's season: record, OPR, world ranking, its next event and the next match at it." },
  { usage: "/next team:", what: "A team's next match: the time, its alliance and the win odds, from its next event." },
  { usage: "/compare team: other:", what: "Two teams side by side: their records and OPR, and who wins the head-to-head." },
  { usage: "/predict event: match:", what: "Win odds and predicted score for a qual match; once played, how the call went." },
  { usage: "/event code:", what: "An event's status, matches played, top 5 by OPR and the winning alliance." },
  { usage: "/rankings", what: "The world top 10 by rating, with movement since last week." },
  { usage: "/ask question:", what: "Anything in plain words, answered as the website's search answers it. Its answer's buttons ask a follow-up or open the answer on the website." },
  { usage: "@Control Scout question", what: "Chat with Bruno AI: mention the bot with anything, and reply to his answer to keep talking. 👍 on an answer says it helped." },
  { usage: "/follow team: channel:", what: "Posts in a channel for a team: the evening before an event, its schedule, 15 minutes before each match and its result, and a recap each day.", admin: true },
  { usage: "/follow event: channel:", what: "Posts in a channel for a whole event instead: the evening before it starts, its schedule once posted, and a recap each day.", admin: true },
  { usage: "/unfollow team: event:", what: "Stop those posts for a team or an event.", admin: true },
  { usage: "/following", what: "The teams and events this server follows, and where each one posts." },
  { usage: "/settings", what: "How this server gets its posts: quiet hours in UTC, whether match reminders are on, and a role to ping on them.", admin: true },
  { usage: "/config", what: "What the bot is and can do here: the release it runs, which account it is and how many servers it is in, when it last reached Discord, the season, chat and this server's chat limit, report filing, follow posts and where its commands are registered. It also shapes this server's answers: channel: a channel where plain messages are answered with no mention, each question in its own thread, style: short, default or detailed, extras: false to drop the follow-up buttons, videos: false to leave match videos out, or reset: true.", admin: true },
  { usage: "/help", what: "This list." },
];
