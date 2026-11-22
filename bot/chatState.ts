// Whether the bot's chat is on, and why not: one place both the startup summary (bot/config.ts) and a chat that
// doesn't happen (bot/ask.ts) take the answer from, so the summary and a later "chat off" line always match.
import { brunoAvailable } from "../server/auth/controlPoint.js";
import { isEnabled } from "../server/flags.js";

/** Why the chat can't run, in the words ask.ts logs at ask time. */
export const CHAT_OFF_UNCONFIGURED = "Control Point isn't configured (CONTROL_POINT_INTERNAL_URL and CONTROL_POINT_INTERNAL_KEY)";
export const CHAT_OFF_SWITCH = "the discordBruno switch is off";

export interface ChatSetup { on: boolean; why?: string }

/** Chat: on only with Control Point configured and the bot's own `discordBruno` switch on — the same two checks a chat
 *  makes, in the same order. A switch that can't be read (the database down at startup) reads as off, as it does then. */
export async function chatSetup(): Promise<ChatSetup> {
  if (!brunoAvailable()) return { on: false, why: CHAT_OFF_UNCONFIGURED };
  if (!(await isEnabled("discordBruno").catch(() => false))) return { on: false, why: CHAT_OFF_SWITCH };
  return { on: true };
}
