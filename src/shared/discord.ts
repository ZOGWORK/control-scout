// The Control Scout Discord bot's invite link (bot/README.md), for the FAQ and the site footer.

/**
 * PLACEHOLDER: the bot's application (client) ID from the Discord developer portal (General
 * Information → Application ID). Not public until the application exists; while it's null the FAQ
 * answer and the footer link stay hidden, so nobody sees an invite that doesn't work.
 */
export const DISCORD_CLIENT_ID: string | null = null;

/** The bot's only permissions: Send Messages (2048) + Embed Links (16384) + Use Application Commands (2^31). */
export const DISCORD_PERMISSIONS = 2048 + 16384 + 2 ** 31;

/** The OAuth2 invite: scopes bot + applications.commands, the minimal permissions; null without a client ID. */
export function discordInviteUrl(clientId: string | null = DISCORD_CLIENT_ID): string | null {
  if (!clientId || !/^\d{15,22}$/.test(clientId)) return null;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=${DISCORD_PERMISSIONS}`;
}
