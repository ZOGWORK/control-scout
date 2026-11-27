// Discord's limits on one embed, stated once, so a card can be checked against them instead of against whatever number
// the code that builds it happens to remember. A card Discord would refuse (a 1,025-character field, a 26th field,
// 6,001 characters in all) fails `bot/limits.test.ts` and the tests that build the bot's real cards, not a reader's
// message. Kept out of `bot/views.ts` so these are a statement of Discord's documented limits, not a side effect of how
// one card is built.
import type { APIEmbed } from "discord.js";

/** Discord's documented embed limits (discord.com/developers/docs/resources/message#embed-object-embed-limits). */
export const LIMITS = {
  title: 256,
  description: 4_096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1_024,
  footer: 2_048,
  author: 256,
  /** An embed's whole text: its title, description, field names and values, footer and author. */
  embed: 6_000,
} as const;

/** One part of a card Discord won't take. */
export interface LimitProblem {
  /** The part, as the card names it: "title", "field 3 value", the field count itself, "embed". */
  where: string;
  limit: number;
  length: number;
  /** Set when the part is empty: Discord refuses an empty field name or value whatever its length. */
  empty?: true;
}

/** The text an embed holds, as Discord counts it: every part, each within its own limit or not. */
export function embedChars(e: APIEmbed): number {
  return (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0)
    + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
}

/** What Discord would refuse about this card; empty when it would take it. */
export function embedProblems(e: APIEmbed): LimitProblem[] {
  const out: LimitProblem[] = [];
  const over = (where: string, text: string | undefined, limit: number) => {
    const length = text?.length ?? 0;
    if (length > limit) out.push({ where, limit, length });
  };
  over("title", e.title, LIMITS.title);
  over("description", e.description, LIMITS.description);
  over("footer", e.footer?.text, LIMITS.footer);
  over("author", e.author?.name, LIMITS.author);
  const fields = e.fields ?? [];
  if (fields.length > LIMITS.fields) out.push({ where: "fields", limit: LIMITS.fields, length: fields.length });
  fields.forEach((f, i) => {
    over(`field ${i + 1} name`, f.name, LIMITS.fieldName);
    over(`field ${i + 1} value`, f.value, LIMITS.fieldValue);
    if (!f.name) out.push({ where: `field ${i + 1} name`, limit: LIMITS.fieldName, length: 0, empty: true });
    if (!f.value) out.push({ where: `field ${i + 1} value`, limit: LIMITS.fieldValue, length: 0, empty: true });
  });
  const total = embedChars(e);
  if (total > LIMITS.embed) out.push({ where: "embed", limit: LIMITS.embed, length: total });
  return out;
}
