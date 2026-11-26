// Answering without being mentioned, in the one channel a server picks with `/config channel:` (Manage Server).
// The pick is stored per server (`discord_guild_settings.ask_channel`, bot/settings.ts) and needs Discord's privileged
// Message Content intent (bot/index.ts asks for it only when DISCORD_MESSAGE_CONTENT=1, so a deployment without the
// portal switch still starts). Even then the bot acts only in that channel and its threads: everywhere else it reads
// nothing but messages that mention it or reply to it.
import { guildSettings } from "./settings.js";

/** How long a server's pick is kept in this process. Every message in every channel asks here, and a read each would be
 *  one query a message; a change through `/config` shows up within a minute. */
export const ASK_CHANNEL_TTL_MS = 60_000;
const ASK_CHANNELS_MAX = 5_000;

const picked = new Map<string, { at: number; channel: string | null }>();

/** Handle for tests: forget every cached pick (a write in the same process would otherwise wait out its minute). */
export function forgetAskChannels(): void {
  picked.clear();
}

/**
 * The channel this server picked for questions with no mention, or null (the default: no such channel). Read at most
 * once a minute per server; a read that fails answers with the last known pick, and with null when there never was
 * one — the bot never starts answering because a database read broke.
 */
export async function askChannel(guild: string, now = Date.now()): Promise<string | null> {
  const known = picked.get(guild);
  if (known && now - known.at < ASK_CHANNEL_TTL_MS) return known.channel;
  let channel: string | null;
  try {
    channel = (await guildSettings(guild)).askChannel;
  } catch {
    return known?.channel ?? null;
  }
  if (picked.size >= ASK_CHANNELS_MAX && !picked.has(guild)) picked.clear();
  picked.set(guild, { at: now, channel });
  return channel;
}

/**
 * Whether a message is in that channel, or in a thread under it (a thread carries the channel it was started from as
 * `parentId`), which is also where the answers go. No pick: nothing is answered without a mention.
 */
export function inAskChannel(
  channel: { id?: string | null; parentId?: string | null } | null | undefined,
  picked: string | null,
): boolean {
  if (!picked) return false;
  return channel?.id === picked || channel?.parentId === picked;
}
