// The four slash commands and their registration. Registering compares what Discord already has with
// these definitions first and writes only when something changed, so a restart is a no-op for Discord
// (and a bulk overwrite, never an add, so a command can't be registered twice).
import { ApplicationCommandOptionType, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

export type CommandDef = RESTPostAPIChatInputApplicationCommandsJSONBody;

export const COMMANDS: CommandDef[] = [
  {
    name: "team",
    description: "A team's season: record, OPR, world ranking and next event",
    options: [{ type: ApplicationCommandOptionType.Integer, name: "number", description: "FTC team number", required: true, min_value: 1, max_value: 999999 }],
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
];

/** What decides whether a registered command differs from ours (Discord adds ids, versions and defaults). */
function canonical(c: { name: string; description: string; options?: readonly any[] }): string {
  const opt = (o: any) => ({
    type: o.type, name: o.name, description: o.description, required: !!o.required, autocomplete: !!o.autocomplete,
    min_value: o.min_value ?? null, max_value: o.max_value ?? null, max_length: o.max_length ?? null,
  });
  return JSON.stringify({ name: c.name, description: c.description, options: (c.options ?? []).map(opt) });
}

/** True when Discord already has exactly these commands (in any order) and nothing else. */
export function sameCommands(registered: readonly { name: string; description: string; options?: readonly any[] }[], ours: readonly CommandDef[] = COMMANDS): boolean {
  if (registered.length !== ours.length) return false;
  const a = registered.map(canonical).sort(), b = ours.map((c) => canonical(c as any)).sort();
  return a.every((x, i) => x === b[i]);
}
