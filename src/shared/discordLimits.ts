// The owner console's Discord bot panel (server/portal/discordLimits.ts, bot/quota.ts): every server the bot kept
// something for, its name, the cap it has and what it has used this UTC hour and day; the bot's own numbers at a glance
// (bot/asks.ts, bot/reactions.ts); and the questions it couldn't answer, which are the phrasings the website's search
// box never sees.

/** One server, as the console's Discord bot panel lists it. */
export interface OwnerDiscordServer {
  /** The Discord server's id (a snowflake). */
  guild: string;
  /** The name Discord shows it (bot/guilds.ts); null: the bot hasn't seen it since names were kept. */
  name: string | null;
  /** Its cap: a positive count an hour and a day, or null for no cap in that window. */
  perHour: number | null;
  perDay: number | null;
  /** False: the default, which is no cap. True: the server has a row of its own. */
  custom: boolean;
  /** Chats counted in the current UTC hour and day (bot/quota.ts). */
  usedHour: number;
  usedDay: number;
  /** Teams and events followed in the server (bot/follows.ts). */
  follows: number;
  /** When someone there last asked the bot something (bot/memory.ts); null: never. */
  lastAsk: string | null;
  /** Who set the server's own cap last, and when; null while it has the default. */
  updatedBy: string | null;
  updatedAt: string | null;
}

/** The bot's own numbers at a glance: how much it is asked, how often Bruno answered, and how long it took. */
export interface OwnerDiscordUsage {
  /** Servers the bot knows. */
  servers: number;
  /** Questions asked today (UTC) and this week. */
  asksToday: number;
  asksWeek: number;
  /** Of the week's asks: the share answered at all, and the share Bruno's chat answered (0–100; null: no asks). */
  answeredPct: number | null;
  chatPct: number | null;
  /** The middle answer time over the week, in milliseconds (null: none recorded). */
  medianMs: number | null;
  /** Follow posts sent today (UTC). */
  postsToday: number;
  /** 👍 and 👎 on the bot's answers (bot/reactions.ts): counts, never who clicked. */
  votesUp: number;
  votesDown: number;
}

/** A question the bot couldn't answer, most asked first: what people actually typed, which search never sees. */
export interface OwnerDiscordAsk {
  /** The latest spelling, as asked (personal data redacted). */
  question: string;
  /** How many times it was asked, in any server. */
  count: number;
  /** The step search answered it at (recovery, no-match…), or null. */
  step: string | null;
  /** The last time it was asked. */
  lastAt: string;
  /** How many servers asked it. */
  servers: number;
}

/** GET /api/owner/discord/limits: what the Discord bot panel shows. */
export interface OwnerDiscordLimits {
  servers: OwnerDiscordServer[];
  /** What a server without a row of its own gets: no cap in either window. */
  defaultLimit: { perHour: number | null; perDay: number | null };
  usage: OwnerDiscordUsage;
  /** Up to 10 questions the bot couldn't answer, most asked first (bot/asks.ts). */
  unanswered: OwnerDiscordAsk[];
}
