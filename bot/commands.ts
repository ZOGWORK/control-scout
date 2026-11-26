// The slash commands and their registration. Registering compares what Discord already has with
// these definitions first and writes only when something changed, so a restart is a no-op for Discord
// (and a bulk overwrite, never an add, so a command can't be registered twice).
import { ApplicationCommandOptionType, ChannelType, InteractionContextType, PermissionFlagsBits, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

/** /follow and /unfollow: people who can manage the server (a server admin can grant others), and only in servers. */
const MANAGE = { default_member_permissions: String(PermissionFlagsBits.ManageGuild), contexts: [InteractionContextType.Guild] };

export type CommandDef = RESTPostAPIChatInputApplicationCommandsJSONBody;

export const COMMANDS: CommandDef[] = [
  {
    name: "team",
    description: "A team's season: record, OPR, world ranking, its next event and next match",
    options: [{ type: ApplicationCommandOptionType.Integer, name: "number", description: "FTC team number or name", required: true, autocomplete: true, min_value: 1, max_value: 999999 }],
  },
  {
    name: "next",
    description: "A team's next match: when, with whom, and the win odds",
    options: [{ type: ApplicationCommandOptionType.Integer, name: "team", description: "FTC team number or name", required: true, autocomplete: true, min_value: 1, max_value: 999999 }],
  },
  {
    name: "compare",
    description: "Two teams side by side: records, OPR and who wins the head-to-head",
    options: [
      { type: ApplicationCommandOptionType.Integer, name: "team", description: "FTC team number or name", required: true, autocomplete: true, min_value: 1, max_value: 999999 },
      { type: ApplicationCommandOptionType.Integer, name: "other", description: "The team to compare it with", required: true, autocomplete: true, min_value: 1, max_value: 999999 },
    ],
  },
  {
    name: "predict",
    description: "Win odds and predicted score for a qualification match (or how the call went)",
    options: [
      { type: ApplicationCommandOptionType.String, name: "event", description: "Event name or code", required: true, autocomplete: true, max_length: 100 },
      { type: ApplicationCommandOptionType.Integer, name: "match", description: "Qualification match number", required: true, min_value: 1, max_value: 9999 },
    ],
  },
  {
    name: "event",
    description: "An event's status, progress and top teams by OPR",
    options: [{ type: ApplicationCommandOptionType.String, name: "code", description: "Event name or code", required: true, autocomplete: true, max_length: 100 }],
  },
  {
    name: "rankings",
    description: "The world's top 10 teams by rating, with movement since last week",
  },
  {
    name: "follow",
    description: "Post here for a team's matches and results, or for a whole event",
    ...MANAGE,
    options: [
      { type: ApplicationCommandOptionType.Integer, name: "team", description: "FTC team number or name (or name an event instead)", autocomplete: true, min_value: 1, max_value: 999999 },
      { type: ApplicationCommandOptionType.String, name: "event", description: "Event name or code, instead of a team", autocomplete: true, max_length: 100 },
      { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Where to post (this channel if left out)", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
    ],
  },
  {
    name: "unfollow",
    description: "Stop the automatic posts for a team or an event",
    ...MANAGE,
    options: [
      { type: ApplicationCommandOptionType.Integer, name: "team", description: "FTC team number or name", autocomplete: true, min_value: 1, max_value: 999999 },
      { type: ApplicationCommandOptionType.String, name: "event", description: "Event name or code", autocomplete: true, max_length: 100 },
      { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Only in this channel (every channel if left out)", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
    ],
  },
  {
    name: "following",
    description: "The teams and events this server follows, and where each one posts",
    contexts: [InteractionContextType.Guild],
  },
  {
    name: "ask",
    description: "Ask anything in plain words: the website's search answers it",
    options: [{ type: ApplicationCommandOptionType.String, name: "question", description: "Like the search box: who won decode, 4215 vs 6980, 4215 highlights", required: true, max_length: 500 }],
  },
  {
    name: "settings",
    description: "How this server gets its posts: quiet hours, match reminders, a role to ping",
    ...MANAGE,
    options: [
      { type: ApplicationCommandOptionType.String, name: "quiet_hours", description: "UTC hours to stay silent, like 22-7, or off for none", max_length: 20 },
      { type: ApplicationCommandOptionType.Boolean, name: "reminders", description: "A heads-up before each match (off: results and event posts only)" },
      { type: ApplicationCommandOptionType.String, name: "ping_role", description: "Role to ping on a reminder: <@&id>, a role id, or none", max_length: 40 },
    ],
  },
  {
    name: "config",
    description: "This bot's setup, and how this server's answers read: an ask channel, style, follow-ups, videos",
    ...MANAGE,
    options: [
      { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Answer plain messages here without a mention, each in a thread", channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
      { type: ApplicationCommandOptionType.String, name: "style", description: "How long answers read here", choices: [
        { name: "Short: a line or two", value: "short" },
        { name: "Default: the site's own shape", value: "default" },
        { name: "Detailed: the reasoning too", value: "detailed" },
      ] },
      { type: ApplicationCommandOptionType.Boolean, name: "extras", description: "Offer the next questions as buttons under an answer" },
      { type: ApplicationCommandOptionType.Boolean, name: "videos", description: "Include match clips in answers" },
      { type: ApplicationCommandOptionType.Boolean, name: "reset", description: "Put the answer settings back to their defaults, and stop answering without a mention" },
    ],
  },
  {
    name: "help",
    description: "Everything Control Scout can do here",
  },
];

/** What decides whether a registered command differs from ours (Discord adds ids, versions and defaults). */
function canonical(c: { name: string; description: string; options?: readonly any[]; default_member_permissions?: string | null; contexts?: readonly number[] | null }): string {
  const opt = (o: any) => ({
    type: o.type, name: o.name, description: o.description, required: !!o.required, autocomplete: !!o.autocomplete,
    min_value: o.min_value ?? null, max_value: o.max_value ?? null, max_length: o.max_length ?? null, channel_types: o.channel_types ?? null,
  });
  return JSON.stringify({ name: c.name, description: c.description, options: (c.options ?? []).map(opt), perms: c.default_member_permissions ?? null, contexts: c.contexts ?? null });
}

/** True when Discord already has exactly these commands (in any order) and nothing else. */
export function sameCommands(registered: readonly { name: string; description: string; options?: readonly any[]; default_member_permissions?: string | null; contexts?: readonly number[] | null }[], ours: readonly CommandDef[] = COMMANDS): boolean {
  if (registered.length !== ours.length) return false;
  const a = registered.map(canonical).sort(), b = ours.map((c) => canonical(c as any)).sort();
  return a.every((x, i) => x === b[i]);
}
