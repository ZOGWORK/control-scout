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
  /** False: the default ceiling (bot/quota.ts). True: the server has a row of its own. */
  custom: boolean;
  /** Chats counted in the current UTC hour and day (bot/quota.ts). */
  usedHour: number;
  usedDay: number;
  /** Teams and events followed in the server (bot/follows.ts). */
  follows: number;
  /** Follows that stopped because their channel kept refusing posts, kept so the server can see why. */
  stoppedFollows: number;
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
  /** Answers the bot has posted, and how many a person reported with a 👎 (bot/asks.ts answerStats): the quality signal
   *  now that there is no 👍. */
  answers: number;
  reported: number;
  /** Reports per 100 answers (0–100; null with no answers). */
  reportedPct: number | null;
  /** Share of the week's asks whose exact words were asked more than once (0–100; null with no asks). */
  repeatPct: number | null;
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
  /** What a server without a row of its own gets: the default ceiling (bot/quota.ts). */
  defaultLimit: { perHour: number | null; perDay: number | null };
  usage: OwnerDiscordUsage;
  /** Up to 10 questions the bot couldn't answer, most asked first (bot/asks.ts). */
  unanswered: OwnerDiscordAsk[];
}
