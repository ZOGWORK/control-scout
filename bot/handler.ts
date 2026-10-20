// Interactions in, embeds out. Every command answers: the reply is deferred before any lookup (Discord
// allows 3 seconds for a first response; a cold event can take longer), and every failure becomes a
// friendly embed, logged here with the command and its arguments. Autocomplete answers from a cached
// event list and never throws.
import { MessageFlags, type APIEmbed, type AutocompleteInteraction, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { AnswerCache, Cooldown } from "./guard.js";
import { Friendly, errorEmbed, unavailableEmbed } from "./views.js";
import { eventChoices, eventLookup, predictLookup, rankChoices, rankingsLookup, teamLookup } from "./lookups.js";

export type Log = (m: string) => void;

export interface Lookups {
  team: (n: number) => Promise<APIEmbed>;
  predict: (event: string, match: number) => Promise<APIEmbed>;
  event: (code: string) => Promise<APIEmbed>;
  rankings: () => Promise<APIEmbed>;
  choices: (typed: string) => Promise<{ name: string; value: string }[]>;
}

export const realLookups: Lookups = {
  team: teamLookup,
  predict: predictLookup,
  event: eventLookup,
  rankings: () => rankingsLookup(),
  choices: async (typed) => rankChoices(await eventChoices(), typed),
};

/** The command and its arguments as one line, for the cache key and the log. */
export function describe(i: Pick<ChatInputCommandInteraction, "commandName" | "options">): string {
  const args = i.options.data.map((o) => `${o.name}=${String(o.value ?? "").trim().toUpperCase().slice(0, 100)}`).sort();
  return [`/${i.commandName}`, ...args].join(" ");
}

export function createHandler(log: Log, lookups: Lookups = realLookups, opts: { ttlMs?: number; cooldownMs?: number } = {}) {
  const cache = new AnswerCache<APIEmbed>(opts.ttlMs ?? 60_000, 2000, (e) => e instanceof Friendly);
  const cooldown = new Cooldown(opts.cooldownMs ?? 3000);

  function answer(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const key = describe(i);
    switch (i.commandName) {
      case "team": return cache.get(key, () => lookups.team(i.options.getInteger("number", true)));
      case "predict": return cache.get(key, () => lookups.predict(i.options.getString("event", true), i.options.getInteger("match", true)));
      case "event": return cache.get(key, () => lookups.event(i.options.getString("code", true)));
      case "rankings": return cache.get(key, () => lookups.rankings());
      default: return Promise.reject(new Friendly("Unknown command", "This command isn't one Control Scout knows. Try /team, /predict, /event or /rankings."));
    }
  }

  async function command(i: ChatInputCommandInteraction): Promise<void> {
    const wait = cooldown.take(i.user.id);
    if (wait > 0) {
      await i.reply({ embeds: [errorEmbed("Slow down", `One command every 3 seconds. Try again in ${Math.ceil(wait / 1000)} s.`)], flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply();
    let embed: APIEmbed;
    try {
      embed = await answer(i);
    } catch (e) {
      if (e instanceof Friendly) embed = errorEmbed(e.title, e.detail);
      else {
        log(`${describe(i)} failed: ${(e as Error)?.message ?? String(e)}`);
        embed = unavailableEmbed();
      }
    }
    await i.editReply({ embeds: [embed] });
  }

  async function autocomplete(i: AutocompleteInteraction): Promise<void> {
    let list: { name: string; value: string }[] = [];
    try {
      list = await lookups.choices(String(i.options.getFocused() ?? ""));
    } catch (e) {
      log(`autocomplete /${i.commandName} failed: ${(e as Error)?.message ?? String(e)}`);
    }
    await i.respond(list.slice(0, 25));
  }

  return async function handle(i: Interaction): Promise<void> {
    try {
      if (i.isChatInputCommand()) await command(i);
      else if (i.isAutocomplete()) await autocomplete(i);
    } catch (e) {
      // Discord itself failed (the interaction expired, the network dropped): log it and stay up.
      log(`interaction failed: ${(e as Error)?.message ?? String(e)}`);
    }
  };
}
