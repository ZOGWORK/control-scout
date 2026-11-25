// Answering without being mentioned, in one channel a server chooses by naming it: Control Scout reads a message it
// wasn't pinged in only when that channel is called `#ask-control-scout`. Creating or renaming a channel already needs
// Manage Server, so the name is the opt-in — no new command and no stored setting.
//
// This needs Discord's privileged Message Content intent (bot/index.ts adds it only when DISCORD_MESSAGE_CONTENT=1, so
// a deployment without the portal switch keeps starting), and even then the bot acts only in that channel: everywhere
// else it still reads nothing but messages that mention it or reply to it.
export const ASK_CHANNEL = "ask-control-scout";

/** Whether a channel is the one the bot answers in without a mention. Threads don't count: their name isn't the channel's. */
export function isAskChannel(channel: { name?: string | null } | null | undefined): boolean {
  return String(channel?.name ?? "").trim().toLowerCase() === ASK_CHANNEL;
}
