// The buttons under an answer (Discord components). A card used to say "Ask next: `/ask question: …`" as text to copy;
// now each suggestion is a button, the website link is a link button, and the videos are link buttons too.
//
// A question is kept here for an hour, not in the custom id: Discord allows 100 characters, which is not enough for a
// real question, and a truncated one would ask something else. So a button carries `ask:<n>`, and the store (in the bot's
// process) hands back the words. The trade is that a button stops working an hour after the answer, or after a restart:
// clicking one then says so, and `/ask` still works. Follows are deliberately not buttons: a button would let anyone
// follow without Manage Server.
import type { APIActionRowComponent, APIButtonComponent } from "discord.js";
import type { AskReply } from "./ask.js";

/** How long a button works. An answer's follow-up is asked within minutes; an hour is generous. */
export const QUESTION_TTL_MS = 60 * 60_000;
/** Questions kept at once: far more than an hour's answers, and bounded so a busy day can't grow the process. */
export const QUESTIONS_MAX = 2000;
/** Discord's cap on a button's label. */
export const LABEL_MAX = 80;
/** Every ask button's custom id starts with this. */
export const ASK_PREFIX = "ask:";
/** Buttons in one row: Discord's cap. */
export const ROW_MAX = 5;
/** The link button every card carries. */
export const SITE_LABEL = "Open on controlscout.org";

/** A label that fits a button: one line, clipped with an ellipsis. */
export const buttonLabel = (s: string) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};

/** The questions behind the answer buttons, with an expiry. */
export class QuestionButtons {
  private m = new Map<string, { question: string; at: number }>();
  private n = 0;

  /** Keep a question and return the custom id a button uses for it. */
  put(question: string, now = Date.now()): string {
    const id = `${ASK_PREFIX}${(this.n++).toString(36)}`;
    this.m.set(id, { question, at: now });
    // Oldest first: a Map iterates in insertion order.
    while (this.m.size > QUESTIONS_MAX) this.m.delete(this.m.keys().next().value!);
    return id;
  }

  /** The question behind a button's id, or null when it has expired or was never here (before a restart). */
  get(id: string, now = Date.now()): string | null {
    const v = this.m.get(id);
    if (!v) return null;
    if (now - v.at > QUESTION_TTL_MS) { this.m.delete(id); return null; }
    return v.question;
  }

  get size() { return this.m.size; }
}

/** The question a clicked button offers, or null: not one of ours (a follow button, an older bot's id), or expired. */
export function buttonQuestion(buttons: QuestionButtons, customId: string, now = Date.now()): string | null {
  return customId.startsWith(ASK_PREFIX) ? buttons.get(customId, now) : null;
}

/**
 * The components for an answer: one row of ask buttons (at most four, then the website link), and a row of link buttons
 * for the videos. Empty when there is nothing to offer, so a message never carries an empty row.
 */
export function answerComponents(r: AskReply, buttons: QuestionButtons, now = Date.now()): APIActionRowComponent<APIButtonComponent>[] {
  const rows: APIActionRowComponent<APIButtonComponent>[] = [];
  const ask = (r.next ?? []).slice(0, 4).map((q) => ({
    type: 2 as const, style: 2 as const, custom_id: buttons.put(q, now), label: buttonLabel(q),
  }));
  if (ask.length) rows.push({ type: 1, components: ask });
  const links = [
    ...(r.embed.url ? [{ type: 2 as const, style: 5 as const, url: r.embed.url, label: SITE_LABEL }] : []),
    ...(r.watch ?? []).slice(0, 4).map((w) => ({ type: 2 as const, style: 5 as const, url: w.url, label: buttonLabel(w.label) })),
  ].slice(0, ROW_MAX);
  if (links.length) rows.push({ type: 1, components: links });
  return rows;
}
