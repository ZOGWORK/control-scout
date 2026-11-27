// What a mention asks the bot to *do*, rather than to answer: follow a team, watch an event, remind a person, remember a
// person's team. These used to go to the chat, which can only talk — so "follow 4215" got a paragraph about 4215's OPR
// and "remember that my team is 4215" got "Got it, I'll remember!" with nothing remembered. Now each one either happens
// (bot/handler.ts runs it with the same code as /follow, bot/reminders.ts, bot/memory.ts) or the reply says plainly why
// it didn't and what will work. Pure: parsing only, so every phrasing is tested without Discord.

/** What a message asks the bot to do. `rest`: the part of the message that is a question of its own, answered after the
 *  action ("follow 4215 and tell me when they play next" → follows, then answers "when do they play next"). */
export type Action =
  | { kind: "follow"; team: number; rest: string }
  | { kind: "unfollow"; team: number; rest: string }
  | { kind: "watchEvent"; team: number | null; event: string | null; rest: string }
  | { kind: "remind"; team: number; rest: string }
  | { kind: "cancelRemind"; team: number | null; rest: string }
  | { kind: "myTeam"; team: number; rest: string }
  | { kind: "forgetMyTeam"; rest: string };

/** A team number as people type one: 1 to 5 digits. Teams 1990–2099 exist ("follow 2025" is team 2025); a number said
 *  as a year is caught by `saidAsYear` from what follows it. */
const TEAM = String.raw`(?:team\s*#?\s*)?(\d{1,5})`;
/** "2025-26", "2025 season", "2025 worlds", "2025's game": a year in a sentence, never a team to act on. */
const saidAsYear = (q: string, n: number) =>
  n >= 1990 && n <= 2099 && new RegExp(String.raw`\b${n}(?:'s)?\s*(?:[-–/]\s*\d{2}\b|(?:season|worlds|world|championships?|game|games|kickoff|robot|rules?|events?)\b)`, "i").test(q);
const team = (s: string | undefined): number | null => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** What follows an action clause and is a question of its own: "… and tell me when they play next". */
const restOf = (s: string) => s.replace(/^\s*(?:,|;|\.|and|also|then|plus)\s*(?:and\s+)?/i, "").replace(/^(?:tell me|let me know)\s+/i, "").trim();

const POLITE = String.raw`^(?:(?:hey|hi|yo)\s+)?(?:bruno[,\s]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?`;

const RULES: { re: RegExp; make: (m: RegExpMatchArray) => Action | null }[] = [
  // "forget my team", "i'm not on 4215 any more"
  { re: new RegExp(`${POLITE}(?:forget|clear|reset)\\s+(?:that\\s+)?my\\s+team\\b(.*)$`, "i"), make: (m) => ({ kind: "forgetMyTeam", rest: restOf(m[1]) }) },
  // "remember that my team is 4215", "my team is 4215", "set my team to 4215" — the number ends the clause, so "our team
  // is 12 points behind 6980" or "my team is 5 minutes from our match" is a question, never a team to keep.
  {
    re: new RegExp(`${POLITE}(?:remember\\s+(?:that\\s+)?|note\\s+(?:that\\s+)?|fyi\\s+)?(?:my\\s+team\\s+(?:is|=)|our\\s+team\\s+is|set\\s+my\\s+team\\s+(?:to|as))\\s+${TEAM}(?=\\s*(?:$|[,;.!?]|(?:and|so|btw|now)\\b))(.*)$`, "i"),
    make: (m) => { const t = team(m[1]); return t ? { kind: "myTeam", team: t, rest: restOf(m[2]) } : null; },
  },
  // "we're team 4215", "i'm on team 4215", "we are 4215." — the word "team", or a number that ends the clause, so
  // "we are 10 minutes from our match" or "we're 12 points behind" is a question, never a team to keep.
  {
    re: new RegExp(`${POLITE}(?:remember\\s+(?:that\\s+)?|fyi\\s+)?(?:we(?:'re|\\s+are)|i(?:'m|\\s+am)\\s+(?:on|in|from|with))\\s+(?:team\\s*#?\\s*(\\d{1,5})\\b|#?(\\d{3,5})(?=\\s*(?:$|[,;.!?]|\\s+(?:and|so|btw)\\b)))(.*)$`, "i"),
    make: (m) => { const t = team(m[1] ?? m[2]); return t ? { kind: "myTeam", team: t, rest: restOf(m[3]) } : null; },
  },
  // "stop reminding me about 4215", "cancel my reminder"
  {
    re: new RegExp(`${POLITE}(?:stop\\s+reminding\\s+me|cancel\\s+(?:my\\s+|the\\s+)?reminders?|don'?t\\s+remind\\s+me)(?:\\s+(?:about|for|of)\\s+${TEAM})?\\b(.*)$`, "i"),
    make: (m) => ({ kind: "cancelRemind", team: team(m[1]), rest: restOf(m[2]) }),
  },
  // "remind me when 4215 plays next", "ping me before 4215's next match", "remind me about 4215", "tell me when 4215
  // plays". "Tell me about 4215" is a question, never a reminder: "tell" only reminds with when/before/once.
  {
    re: new RegExp(`${POLITE}(?:(?:remind|ping|notify|alert)\\s+me\\s+(?:when|before|about|of|for|once)|tell\\s+me\\s+(?:when|before|once))\\s+(?:team\\s+)?${TEAM}(?:'s)?\\b(?:\\s+(?:plays?|is\\s+(?:up|on|playing)|has\\s+(?:a|its|their)\\s+(?:next\\s+)?match|next(?:\\s+match)?|(?:next\\s+)?match(?:es)?|goes\\s+on))*(.*)$`, "i"),
    make: (m) => { const t = team(m[1]); return t ? { kind: "remind", team: t, rest: restOf(m[2]) } : null; },
  },
  // "watch the next event 4215 is in", "watch 4215's next event", "follow USNJCMP", "watch event USNJCMP"
  {
    re: new RegExp(`${POLITE}(?:watch|follow|track)\\s+(?:the\\s+)?(?:next\\s+event\\s+(?:team\\s+)?${TEAM}(?:\\s+is\\s+(?:in|at|playing(?:\\s+in|\\s+at)?|going\\s+to))?|(?:team\\s+)?${TEAM}'?s?\\s+next\\s+event)\\b(.*)$`, "i"),
    make: (m) => { const t = team(m[1] ?? m[2]); return t ? { kind: "watchEvent", team: t, event: null, rest: restOf(m[3]) } : null; },
  },
  {
    re: new RegExp(`${POLITE}(?:watch|follow|track)\\s+(?:the\\s+)?event\\s+([A-Z]{2}[A-Z0-9]{2,12})\\b(.*)$`, "i"),
    make: (m) => ({ kind: "watchEvent", team: null, event: m[1].toUpperCase(), rest: restOf(m[2]) }),
  },
  // "unfollow 4215", "stop following 4215"
  {
    re: new RegExp(`${POLITE}(?:unfollow|stop\\s+following|stop\\s+watching|untrack)\\s+(?:team\\s+)?${TEAM}\\b(.*)$`, "i"),
    make: (m) => { const t = team(m[1]); return t ? { kind: "unfollow", team: t, rest: restOf(m[2]) } : null; },
  },
  // "follow 4215", "follow team 4215 here", "watch 4215", "track 4215 in this channel"
  {
    re: new RegExp(`${POLITE}(?:follow|watch|track|subscribe\\s+to)\\s+(?:team\\s+)?${TEAM}\\b(?:\\s+(?:here|in\\s+(?:this|the)\\s+channel))?(.*)$`, "i"),
    make: (m) => { const t = team(m[1]); return t ? { kind: "follow", team: t, rest: restOf(m[2]) } : null; },
  },
];

/** The action a message asks for, or null when it's a question (the chat answers it). Only a message that *starts*
 *  with the request counts: "how many teams follow 4215's lead" is a question, not a follow. */
export function parseAction(q: string): Action | null {
  const s = q.replace(/\s+/g, " ").trim().replace(/[!.?]+$/, "");
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) { const a = r.make(m); if (a && !("team" in a && a.team != null && saidAsYear(s, a.team))) return a; }
  }
  return null;
}

/** "my team" / "our team" / "my team's" in a question, read as the person's own team, so search reads a number it can
 *  answer: "how did my team do at their last event" → "how did 4215 do at their last event". A message that names no
 *  such phrase, or a person with no team kept, is asked as typed. */
export function withMyTeam(q: string, mine: number | null): string {
  if (!mine) return q;
  return q
    .replace(/\b(?:my|our)\s+team(['’]s)?\b/gi, (_, s) => `${mine}${s ? "'s" : ""}`)
    .replace(/\bhow\s+(?:did|do|are|were)\s+we\b/gi, (m) => m.replace(/\bwe\b/i, String(mine)))
    .replace(/\b(?:our|my)\s+(opr|record|rank(?:ing)?|matches|schedule|next\s+match|score)\b/gi, (_, w) => `${mine}'s ${w}`);
}

/** Whether a message leans on the person's own team ("my team", "our record", "how did we do"): only then is the team
 *  they told the bot sent with the chat. */
export const mentionsMine = (q: string) =>
  /\b(?:my|our)\s+(?:team|opr|record|rank(?:ing)?|matches|schedule|next\s+match|score)\b|\bhow\s+(?:did|do|are|were)\s+we\b/i.test(q);
