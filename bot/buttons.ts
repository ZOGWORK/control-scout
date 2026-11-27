// The buttons under an answer (Discord components). A card used to say "Ask next: `/ask question: …`" as text to copy;
// now each suggestion is a button, the website link is a link button, and the videos are link buttons too.
//
// A question is kept in a store, not in the custom id: Discord allows 100 characters, which is not enough for a real
// question, and a truncated one would ask something else. So a button carries a short id, and the store hands back the
// words. The store writes through to the database (bot/handler.ts's `dbButtonStore`), so a button under an old answer
// still works after a restart; the process keeps a bounded cache in front of it. A database that can't be read still
// answers from the cache, and an id nobody kept says so instead of guessing. Follows are deliberately not buttons: a
// button would let anyone follow without Manage Server.
import type { APIActionRowComponent, APIButtonComponent } from "discord.js";
import { get, run } from "../server/db.js";
import type { AskReply } from "./ask.js";

/** How long a button works. Long enough to outlive an event weekend and a deploy; old rows are pruned. */
export const QUESTION_TTL_MS = 30 * 86_400_000;
/** Questions cached at once: bounded so a busy day can't grow the process. The database keeps the rest. */
export const QUESTIONS_MAX = 2000;
/** Discord's cap on a button's label. */
export const LABEL_MAX = 80;
/** Every ask button's custom id starts with this. */
export const ASK_PREFIX = "ask:";
/** Buttons in one row: Discord's cap. */
export const ROW_MAX = 5;
/** The link button every card carries. */
export const SITE_LABEL = "Open on controlscout.org";
/** The button that reports an answer (bot/handler.ts opens a modal; bot/report.ts files it). */
export const REPORT_PREFIX = "report:";
export const REPORT_LABEL = "Something's wrong";
/** Discord's cap on one message's text, less the room a split on a line needs. */
export const CHUNK_MAX = 1_900;

/** A label that fits a button: one line, clipped with an ellipsis. */
export const buttonLabel = (s: string) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};

/** Where a question lives past the answer it was offered under. */
export interface ButtonStore {
  put: (id: string, question: string, at: number, guild: string | null) => Promise<void>;
  get: (id: string) => Promise<{ question: string; at: number } | null>;
  prune: (before: number) => Promise<void>;
}

let writes = 0;

/** The bot's store: `discord_button_questions` (migration 110). The table is private and pruned as it grows. */
export const dbButtonStore = (): ButtonStore => ({
  put: async (id, question, at, guild) => {
    await run(
      "INSERT OR REPLACE INTO discord_button_questions (id, question, guild_id, created_at) VALUES (?, ?, ?, ?)",
      [id, question, guild, new Date(at).toISOString()],
    );
    if (++writes % 100 === 0) {
      await run("DELETE FROM discord_button_questions WHERE created_at < ?", [new Date(at - QUESTION_TTL_MS).toISOString()]).catch(() => {});
    }
  },
  get: async (id) => {
    const r = await get<{ question: string; created_at: string }>(
      "SELECT question, created_at FROM discord_button_questions WHERE id = ?", [id]);
    return r ? { question: String(r.question), at: Date.parse(r.created_at) } : null;
  },
  prune: async (before) => { await run("DELETE FROM discord_button_questions WHERE created_at < ?", [new Date(before).toISOString()]); },
});

/** Text a button stands for — a question to ask, or the whole of a long answer — kept behind a short id: Discord allows
 *  100 characters for one, which is neither. A bounded cache in front of the store (`dbButtonStore`), so it outlives a
 *  restart and an id nobody kept says so instead of guessing. */
class KeptText {
  private m = new Map<string, { text: string; at: number }>();
  private n = 0;

  /** `store`: where the text outlives this process (`dbButtonStore`); absent: memory only (tests, a store failure). */
  constructor(private readonly prefix: string, private readonly max: number, private readonly store: ButtonStore | null = null) {}

  /** Keep a text and return the custom id a button uses for it. */
  async put(text: string, now = Date.now(), guild: string | null = null): Promise<string> {
    // The id carries a moment and randomness, so a restarted process never reuses an old answer's id.
    const id = `${this.prefix}${now.toString(36)}${Math.random().toString(36).slice(2, 4)}${(this.n++).toString(36)}`;
    this.m.set(id, { text, at: now });
    // Oldest first: a Map iterates in insertion order.
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    // A write that fails is a cache-only button, never a failed answer: the answer has already been posted.
    if (this.store) await this.store.put(id, text, now, guild).catch(() => {});
    return id;
  }

  /** The text behind a button's id, or null when it has expired or was never kept (an older bot's button). */
  async get(id: string, now = Date.now()): Promise<string | null> {
    let v = this.m.get(id);
    if (!v && this.store) {
      const kept = (await this.store.get(id).catch(() => null)) ?? undefined;
      if (kept) { v = { text: kept.question, at: kept.at }; this.m.set(id, v); }
    }
    if (!v) return null;
    if (now - v.at > QUESTION_TTL_MS) { this.m.delete(id); return null; }
    return v.text;
  }

  get size() { return this.m.size; }
}

/** The questions behind the answer buttons, with an expiry. */
export class QuestionButtons extends KeptText {
  constructor(store: ButtonStore | null = null) { super(ASK_PREFIX, QUESTIONS_MAX, store); }
}

/** The question a clicked button offers, or null: not one of ours (a follow button, an older bot's id), or expired. */
export async function buttonQuestion(buttons: QuestionButtons, customId: string, now = Date.now()): Promise<string | null> {
  return customId.startsWith(ASK_PREFIX) ? buttons.get(customId, now) : null;
}

/** A long answer as Discord messages: whole lines until one message is near its 2000-character cap, and a line too long
 *  for one message cut to fit. */
export function textChunks(text: string, max = CHUNK_MAX): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => { if (cur) { out.push(cur); cur = ""; } };
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > max) { flush(); out.push(rest.slice(0, max)); rest = rest.slice(max); }
    if (cur && cur.length + 1 + rest.length > max) flush();
    cur = cur ? `${cur}\n${rest}` : rest;
  }
  flush();
  return out.length ? out : [text.slice(0, max)];
}

/**
 * The components for an answer: one row of questions to ask next (askNext offers up to Discord's five), a row of link
 * buttons for the website and the videos, and the report button. Empty only when there is nothing at all to offer, so
 * a message never carries an empty row.
 */
export async function answerComponents(r: AskReply, buttons: QuestionButtons, now = Date.now(), guild: string | null = null): Promise<APIActionRowComponent<APIButtonComponent>[]> {
  const rows: APIActionRowComponent<APIButtonComponent>[] = [];
  // Every question the answer offers, up to Discord's five to a row.
  const ask = (await Promise.all((r.next ?? []).slice(0, ROW_MAX).map(async (q) => ({
    type: 2 as const, style: 2 as const, custom_id: await buttons.put(q, now, guild), label: buttonLabel(q),
  })))).slice(0, ROW_MAX);
  if (ask.length) rows.push({ type: 1, components: ask });
  const links = [
    ...(r.embed.url ? [{ type: 2 as const, style: 5 as const, url: r.embed.url, label: SITE_LABEL }] : []),
    ...(r.watch ?? []).slice(0, 4).map((w) => ({ type: 2 as const, style: 5 as const, url: w.url, label: buttonLabel(w.label) })),
  ].slice(0, ROW_MAX);
  if (links.length) rows.push({ type: 1, components: links });
  // Every answer can be reported, whether or not it offers a question or a link: the person who notices a wrong answer
  // is the one who should be able to say so (a 👎 could be mistaken for a dislike, so this is a labelled button).
  rows.push({ type: 1, components: [{ type: 2, style: 2, custom_id: `${REPORT_PREFIX}answer`, label: REPORT_LABEL }] });
  return rows;
}
