// The owner console's Discord chat caps (server/portal/discordLimits.ts, bot/quota.ts): every server the bot kept
// something for, the cap it has and what it has used this UTC hour and day.

/** One server, as the console's Discord bot panel lists it. */
export interface OwnerDiscordServer {
  /** The Discord server's id (a snowflake). The bot stores no names. */
  guild: string;
  /** Its cap: a positive count an hour and a day, or null for no cap in that window. */
  perHour: number | null;
  perDay: number | null;
  /** False: the default, which is no cap. True: the server has a row of its own. */
  custom: boolean;
  /** Chats counted in the current UTC hour and day (bot/quota.ts). */
  usedHour: number;
  usedDay: number;
  /** Teams followed in the server (bot/follows.ts). */
  follows: number;
  /** When someone there last asked the bot something (bot/memory.ts); null: never. */
  lastAsk: string | null;
  /** Who set the server's own cap last, and when; null while it has the default. */
  updatedBy: string | null;
  updatedAt: string | null;
}

/** GET /api/owner/discord/limits: what the Discord bot panel shows. */
export interface OwnerDiscordLimits {
  servers: OwnerDiscordServer[];
  /** What a server without a row of its own gets: no cap in either window. */
  defaultLimit: { perHour: number | null; perDay: number | null };
}
