// The Control Scout Discord bot's invite link (bot/README.md), for the FAQ and the site footer.

/**
 * The bot's application (client) ID from the Discord developer portal (General Information →
 * Application ID). Public by design: it's in every invite link. Set to null to hide the FAQ answer and
 * the footer link (e.g. while the bot is offline), so nobody sees an invite that doesn't work.
 */
export const DISCORD_CLIENT_ID: string | null = "1562258217873047562";

/** The bot's only permissions: Send Messages (2048) + Embed Links (16384) + Use Application Commands (2^31). */
export const DISCORD_PERMISSIONS = 2048 + 16384 + 2 ** 31;

/** The OAuth2 invite: scopes bot + applications.commands, the minimal permissions; null without a client ID. */
export function discordInviteUrl(clientId: string | null = DISCORD_CLIENT_ID): string | null {
  if (!clientId || !/^\d{15,22}$/.test(clientId)) return null;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=${DISCORD_PERMISSIONS}`;
}

/** Every bot command in words: the bot's /help and the site's "Control Scout in Discord" card read this list. */
export const BOT_COMMANDS: { usage: string; what: string; admin?: true }[] = [
  { usage: "/team number:", what: "A team's season: record, OPR, world ranking and its next event." },
  { usage: "/predict event: match:", what: "Win odds and predicted score for a qual match; once played, how the call went." },
  { usage: "/event code:", what: "An event's status, matches played, top 5 by OPR and the winning alliance." },
  { usage: "/rankings", what: "The world top 10 by rating, with movement since last week." },
  { usage: "/follow team: channel:", what: "Posts in a channel for a team: the evening before an event, its schedule, 15 minutes before each match and its result, and a recap each day.", admin: true },
  { usage: "/unfollow team:", what: "Stop those posts for a team.", admin: true },
  { usage: "/following", what: "The teams this server follows, and where each one posts." },
  { usage: "/help", what: "This list." },
];
