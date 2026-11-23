// /ask: the website's search answer as one embed, Bruno only where the site would use him, credited only then.
import { describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../src/shared/api";
import { BRUNO_CREDIT, DESCRIPTION_MAX, ask, askEmbed, askNext, chatContext, chatPost, fitLines, videoLinks, type AskDeps } from "./ask";
import { grounded } from "../server/api/searchBrunoAnswer";
import { SORRY_SENTENCE } from "../src/shared/search";
import { NO_CHAT, NO_REPLY } from "./smallTalk";
import { brunoMethod, brunoPersona } from "./productFacts";

const SITE = "https://controlscout.org";
const hit = (n: number, extra: Partial<SearchHit> = {}): SearchHit => ({ kind: "team", ref: String(n), title: `${n} | Team ${n}`, subtitle: "Oradell, NJ", season: 2025, ...extra });
const base = (over: Partial<SearchAnswer> = {}): SearchAnswer => ({ q: "4215", hits: [hit(4215)], pages: [], step: "deterministic", weak: false, ...over });

function deps(answer: SearchAnswer, over: Partial<AskDeps> = {}): AskDeps {
  return {
    search: vi.fn(async () => answer),
    refine: vi.fn(async () => ({ ...answer, step: "ai" as const, refined: "4215 awards", hits: [hit(4215, { section: "awards" })] })),
    bruno: vi.fn(async () => ({ text: "4215 won 3 awards.", points: [] })),
    enabled: vi.fn(async () => true),
    available: () => true,
    ...over,
  };
}

describe("what goes to the chat", () => {
  it("sends who he is and how to work a question out with every chat", () => {
    const sent = chatContext(["4215 OPR was 42.1."], ["This server asks about 4215 most."]);
    expect(sent).toContain(brunoPersona());
    expect(sent).toContain(brunoMethod());
    expect(sent).toContain("4215 OPR was 42.1.");
    expect(sent).toContain("This server asks about 4215 most.");
    // Product knowledge and the answer's shape still go, after the persona and method.
    expect(sent.indexOf(brunoPersona())).toBeLessThan(sent.indexOf(brunoMethod()));
    expect(sent.join(" ")).toMatch(/remodel is complete/);
  });
});

describe("the embed, step by step", () => {
  it("deterministic: the results as linked lines, a link to the same answer on the website, no credit", () => {
    const e = askEmbed("4215", base(), null, SITE);
    expect(e.title).toBe("4215 | Team 4215");
    expect(e.description!.split("\n")).toEqual([`• [4215 | Team 4215](${SITE}/teams/4215) · Oradell, NJ`, `[Open this answer on controlscout.org](${SITE}/search?q=4215)`]);
    expect(e.url).toBe(`${SITE}/search?q=4215`);
    expect(e.footer!.text).toBe("Control Scout • controlscout.org");
    expect(e.footer!.text).not.toMatch(/Bruno/);
  });

  it("did-you-mean: says what it read the query as", () => {
    const e = askEmbed("hypnotc", base({ step: "did-you-mean", didYouMean: "hypnotic" }), null, SITE);
    expect(e.description!.split("\n")[0]).toBe("Did you mean **hypnotic**?");
    expect(e.footer!.text).not.toMatch(/Bruno/);
  });

  it("ai (Bruno's rewrite used): his reading shown, and the credit on its own line above Control Scout's", () => {
    const e = askEmbed("what did hypnotic win", base({ step: "ai", refined: "4215 awards" }), null, SITE);
    expect(e.description!.split("\n")[0]).toBe("Bruno AI read it as: **4215 awards**");
    expect(e.footer!.text).toBe(`${BRUNO_CREDIT}\nControl Scout • controlscout.org`);
  });

  it("a Bruno sentence: his one sentence quoted (not his points: the short answer), credited", () => {
    const e = askEmbed("how many awards did 4215 win?", base(), { text: "4215 won 3 awards.", points: ["Inspire 2024"] }, SITE);
    expect(e.description).toMatch(/^> 4215 won 3 awards\.\n• \[4215/);
    expect(e.description).not.toMatch(/Inspire 2024/);
    expect(e.footer!.text.split("\n")[0]).toBe("Bruno AI, from Control Point");
  });

  it("closest: the near matches as linked lines, no credit", () => {
    const e = askEmbed("42155", base({ step: "closest", hits: [hit(4215), hit(42150)] }), null, SITE);
    expect(e.description).toMatch(/\[42150 \| Team 42150\]\(https:\/\/controlscout\.org\/teams\/42150\)/);
    expect(e.footer!.text).not.toMatch(/Bruno/);
  });

  it("recovery: the website's sorry, what was understood, questions that work, closest and where to browse; never a made-up answer", () => {
    const a = base({
      step: "recovery", hits: [],
      recovery: { understood: ["a team number: 99999"], closest: [hit(9999)], browse: [{ title: "Browse all teams", href: "/teams" }] },
      sorry: { understood: ["Team 99999"], suggest: ["9999 awards"] },
    });
    const e = askEmbed("99999 robot weight", a, null, SITE);
    expect(e.title).toBe("Sorry — I can't answer that yet");
    const lines = e.description!.split("\n");
    expect(lines[0]).toBe("I read it as: Team 99999");
    // The questions that work are buttons now (bot/buttons.ts), not copyable text: askNext hands them over.
    expect(lines.join("\n")).not.toContain("/ask question:");
    expect(askNext(a)).toEqual(["9999 awards"]);
    expect(lines).toContain(`[Browse all teams](${SITE}/teams)`);
    expect(lines.at(-1)).toBe(`[Open this answer on controlscout.org](${SITE}/search?q=99999%20robot%20weight)`);
    expect(e.footer!.text).not.toMatch(/Bruno/);
  });

  it("a card: its title, headline and lines, links kept", () => {
    const a = base({ card: { kind: "worlds", title: "Worlds appearances", team: { number: 4215, name: "Hypnotic Robotics" }, count: 2, headline: "First went to Worlds in 2021–22", lines: [{ text: "2021–22 Franklin", detail: "Rank 12", href: "/events/2021/FRANKLIN" }] } });
    const e = askEmbed("when did hypnotic go to worlds", a, null, SITE);
    expect(e.title).toBe("Worlds appearances · 4215 Hypnotic Robotics");
    expect(e.description!.split("\n").slice(0, 2)).toEqual(["**First went to Worlds in 2021–22**", `• [2021–22 Franklin](${SITE}/events/2021/FRANKLIN) · Rank 12`]);
  });

  it("a stat answer with a headline: the headline alone (it is the answer), the rest one tap away", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ rank: i + 1, team: { label: `${100 + i}`, href: `/teams/${100 + i}` }, location: null, record: "5–1–0", opr: 50, value: 50 - i, display: `${50 - i}.0` }));
    const stat = { family: "leaderboard", intent: "opr-top", title: "Top OPR", scope: [], blocks: [{ kind: "leaderboard", title: "Top 7", stat: { id: "opr", label: "OPR" }, note: "2025–26 · 7 teams", rows }], definition: "OPR without penalties", source: "2025–26 matches" } as const;
    const e = askEmbed("top opr", base({ stat: { ...stat, headline: { value: "50.0", label: "OPR", href: "/teams/100" } } as never }), null, SITE);
    expect(e.description!.split("\n")).toEqual([`**[50.0](${SITE}/teams/100)** OPR`, `[Open this answer on controlscout.org](${SITE}/search?q=top%20opr)`]);
    // No headline: the first block, its list cut at 3.
    const lines = askEmbed("top opr", base({ stat: stat as never }), null, SITE).description!.split("\n");
    expect(lines).toContain(`1. [100](${SITE}/teams/100) **50.0** · 5–1–0`);
    expect(lines).toContain("…and 4 more on the website");
    expect(lines).not.toContain("*2025–26 matches*");
  });

  it("shows the question as asked above every answer (and the sorry), and offers up to 2 questions to ask next as buttons", () => {
    expect(askEmbed("who  won decode", base(), null, SITE).author).toEqual({ name: "Asked: who won decode" });
    expect(askEmbed("x", base({ step: "recovery", hits: [], sorry: { understood: [], suggest: [] } }), null, SITE).author!.name).toBe("Asked: x");
    const a = base({ suggest: ["4215 awards", "4215 opr", "4215 worlds"] });
    const e = askEmbed("4215", a, null, SITE);
    // Not copy-paste text in the card: the answer's buttons carry them (bot/handler.ts, bot/buttons.ts).
    expect(e.description).not.toContain("Ask next");
    expect(askNext(a)).toEqual(["4215 awards", "4215 opr"]);
    // An answer's related questions come first, then search's suggestions, deduplicated.
    expect(askNext(base({ suggest: ["x"], stat: { blocks: [{ kind: "related", title: "More", queries: ["x", "y", "z"] }] } as never }))).toEqual(["x", "y"]);
  });

  it("a yes-or-no question leads with its verdict", () => {
    const e = askEmbed("has 4215 been to worlds", base({ verdict: { answer: "Yes", label: "4215 has been to Worlds 2 times" } }), null, SITE);
    expect(e.description!.split("\n")[0]).toBe("**Yes** · 4215 has been to Worlds 2 times");
  });

  it("never past Discord's limits: cut from the bottom, the link to the whole answer kept", () => {
    const a = base({ hits: Array.from({ length: 5 }, (_, i) => hit(i + 1, { title: "x".repeat(1500) })) });
    const e = askEmbed("x", a, null, SITE);
    expect(e.description!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(e.description).toMatch(/…more on the website\n\[Open this answer on controlscout\.org\]/);
    expect(JSON.stringify(e).length).toBeLessThan(6000);
    expect(fitLines(["a", "b"], 100)).toBe("a\nb");
  });
});

describe("the same path as the website, Bruno only where it would use him", () => {
  it("a strong answer: no rewrite asked for; any ask, even a statement, gets Bruno's short answer", async () => {
    const d = deps(base());
    const r = await ask("4215 highlights", d, SITE);
    expect(d.refine).not.toHaveBeenCalled();
    expect(d.bruno).toHaveBeenCalledWith("4215 highlights");
    expect(r.meta).toEqual({ step: "deterministic", refined: false, sentence: true });
    expect(r.embed.footer!.text.split("\n")[0]).toBe("Bruno AI, from Control Point");
  });

  it("a weak answer with discordBruno on: his rewrite, credited", async () => {
    const d = deps(base({ step: "recovery", hits: [] }));
    const r = await ask("hypnotic trophies", d, SITE);
    expect(d.refine).toHaveBeenCalledWith("hypnotic trophies");
    expect(r.meta.refined).toBe(true);
    expect(r.embed.footer!.text).toMatch(/^Bruno AI, from Control Point\n/);
  });

  it("discordBruno off: no rewrite is asked for, and the deterministic answer posts", async () => {
    const d = deps(base({ step: "recovery", hits: [], recovery: { understood: ["a name"], closest: [], browse: [] } }), { enabled: vi.fn(async () => false) });
    const r = await ask("hypnotic trophies", d, SITE);
    expect(d.refine).not.toHaveBeenCalled();
    expect(r.embed.title).toBe("Sorry — I can't answer that yet");
    expect(r.embed.footer!.text).not.toMatch(/Bruno/);
  });

  it("a question with discordBruno on: one sentence, credited; off: none, no credit", async () => {
    const on = await ask("who won the most awards in 2025?", deps(base()), SITE);
    expect(on.meta.sentence).toBe(true);
    expect(on.embed.description).toMatch(/^> 4215 won 3 awards\./);
    const d = deps(base(), { enabled: vi.fn(async () => false) });
    const off = await ask("who won the most awards in 2025?", d, SITE);
    expect(d.bruno).not.toHaveBeenCalled();
    expect(off.embed.footer!.text).not.toMatch(/Bruno/);
  });

  it("Bruno unconfigured, failing or slow: the deterministic answer still posts, no credit, no error", async () => {
    const unconfigured = deps(base({ step: "did-you-mean", didYouMean: "hypnotic" }), { available: () => false });
    const r1 = await ask("who is hypnotc?", unconfigured, SITE);
    expect(unconfigured.refine).not.toHaveBeenCalled();
    expect(unconfigured.bruno).not.toHaveBeenCalled();
    expect(r1.embed.footer!.text).toBe("Control Scout • controlscout.org");
    const failing = deps(base({ step: "did-you-mean", didYouMean: "hypnotic" }), { refine: vi.fn(async () => { throw new Error("timeout"); }), bruno: vi.fn(async () => { throw new Error("502"); }) });
    const r2 = await ask("who is hypnotc?", failing, SITE);
    expect(r2.meta).toEqual({ step: "did-you-mean", refined: false, sentence: false });
    expect(r2.embed.footer!.text).not.toMatch(/Bruno/);
  });

  it("a Bruno sentence with a number the facts don't have fails the site's own check (grounded), so it never reaches /ask", () => {
    const facts = ["4215 Hypnotic Robotics: 3 awards in 2025–26"];
    expect(grounded("4215 won 3 awards.", facts, "how many awards did 4215 win?")).toBe(true);
    expect(grounded("4215 won 7 awards.", facts, "how many awards did 4215 win?")).toBe(false);
  });
});

describe("a long answer in the channel", () => {
  it("is a few short lines as read (links count as their text), the rest one tap away", () => {
    const a = base({ hits: [], card: { kind: "info", title: "Long", lines: Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i} `.padEnd(200, "x"), href: `/events/2025/E${i}` })) } });
    const e = askEmbed("long", a, null, SITE);
    const read = e.description!.replace(/\]\([^)]*\)/g, "]").length;
    expect(read).toBeLessThanOrEqual(500 + 80);
    expect(e.description).toMatch(/…more on the website\n\[Open this answer on controlscout\.org\]\(.*\)$/);
  });
});

describe("the bot's own switch", () => {
  it("the real deps read discordBruno only, never the website's brunoSearch / brunoAnswers", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./ask.ts", import.meta.url), "utf8");
    expect(src).toContain('isEnabled("discordBruno")');
    expect(src).toContain('}, "discordBruno"),');
    expect(src).toContain('undefined, "discordBruno"),');
    // His facts come from the same unlearned search the bot shows, never a click-reordered one.
    expect(src).toContain('{ limit: SEARCH_PAGE_LIMIT, learn: false }, Date.now(), undefined, "discordBruno")');
    expect(src).not.toMatch(/isEnabled\("bruno(Search|Answers)"\)/);
  });
});

describe("videos", () => {
  const v = { main: { videoId: "AAA", t: 90, kind: "match" as const, match: "Q85" }, mainRow: "/m/85", rows: { "/m/85": { videoId: "AAA", t: 90, kind: "match" as const, match: "Q85" }, "/m/18": { videoId: "BBB", t: 0, kind: "match" as const, match: "Q18" }, "/m/9": { videoId: "CCC", t: 5, kind: "contributor" as const, match: "Q9" } } };
  it("the main one first, then the listed matches' clips; never a video people added; at most 3", () => {
    expect(videoLinks(v)).toEqual([{ label: "Q85", url: "https://www.youtube.com/watch?v=AAA&t=90s" }, { label: "Q18", url: "https://www.youtube.com/watch?v=BBB" }]);
    expect(videoLinks(undefined)).toEqual([]);
  });
  it("a Watch line in the answer, and the main video as the message's text (a player under the embed)", async () => {
    const e = askEmbed("23268 highlights", base(), null, SITE, v);
    expect(e.description).toContain("▶ Watch: [Q85](https://www.youtube.com/watch?v=AAA&t=90s) · [Q18](https://www.youtube.com/watch?v=BBB)");
    const r = await ask("23268 highlights", deps(base(), { video: vi.fn(async () => v) }), SITE);
    expect(r.content).toBe("https://www.youtube.com/watch?v=AAA&t=90s");
    expect((await ask("23268", deps(base()), SITE)).content).toBeUndefined();
  });
});

describe("a chat with Bruno", () => {
  const vid = { main: { videoId: "AAA", t: 90, kind: "match" as const, match: "Q85" } };
  const chatDeps = (reply: { text: string; search: boolean } | null, over: Partial<AskDeps> = {}) => deps(base(), {
    facts: vi.fn(async (a: SearchAnswer) => [`Result: ${a.hits[0]?.title ?? "none"}`]),
    chat: vi.fn(async () => reply),
    video: vi.fn(async () => vid),
    ...over,
  });

  it("a greeting: his reply is the post, with no card, video, website link or search sentence", async () => {
    // A greeting finds no records: nothing to post beside his words.
    const d = chatDeps({ text: "Hey! I'm Bruno. Ask me about any FTC team.", search: false }, { search: vi.fn(async (q: string) => base({ q, hits: [] })) });
    const r = await ask("hi bruno", d, SITE);
    expect(r.chat).toEqual({ text: "Hey! I'm Bruno. Ask me about any FTC team." });
    expect(r.meta).toMatchObject({ chat: true, sentence: false });
    expect(d.bruno).not.toHaveBeenCalled();
    expect(d.video).not.toHaveBeenCalled();
    expect(d.chat).toHaveBeenCalledWith("hi bruno", ["Result: none"], [], []);
  });

  it("a message that asks several things: each part's facts go with the message's own, and its answer is the card", async () => {
    const q = "what is like the best team rn, where are they from and what is their auto opr";
    const board = base({ q: "what is the best team", hits: [], card: { kind: "high-scores", title: "Top teams by OPR", lines: [{ text: "23268 Ultraviolet", detail: "Hillsborough, NJ · OPR 157.9" }] } });
    const lookups = vi.fn(async () => ({ facts: ["#1 23268 Ultraviolet (Hillsborough, NJ): OPR 157.9, Auto OPR 40"], answer: board }));
    const d = chatDeps({ text: "23268 Ultraviolet, from Hillsborough, NJ: 157.9 OPR, 40 on Auto.", search: true }, { lookups });
    const r = await ask(q, d, SITE);
    expect(lookups).toHaveBeenCalledWith(q);
    // The message's facts first, then the parts' (the leaderboard's own line answers "where from" and "auto opr").
    expect(d.chat).toHaveBeenCalledWith(q, ["Result: 4215 | Team 4215", "#1 23268 Ultraviolet (Hillsborough, NJ): OPR 157.9, Auto OPR 40"], [], []);
    expect(r.chat?.text).toMatch(/23268/);
    // His words keep their shape, and the board search found for the part rides beside them as the card, linked to that
    // answer on the site rather than to the whole message search.
    expect(r.chat?.card).toBe(true);
    expect(r.chat?.text).not.toMatch(/Top teams by OPR/);
    expect(r.embed.title).toBe("Top teams by OPR");
    expect(r.embed.description).toContain(`${SITE}/search?q=what%20is%20the%20best%20team`);
    // The footer under his text links to the same answer, not to the whole message search nothing can read.
    expect(r.chat?.page).toBe(`${SITE}/search?q=what%20is%20the%20best%20team`);
    expect(r.next).toEqual([]);
  });

  it("a part whose answer has nothing to show never replaces the message's card and links", async () => {
    const q = "what is the best team and who won decode";
    const sorry = base({ q: "who won decode", hits: [], step: "recovery", sorry: { understood: [], suggest: [] } });
    const d = chatDeps({ text: "23268 is top.", search: true }, { lookups: vi.fn(async () => ({ facts: [], answer: sorry })) });
    const r = await ask(q, d, SITE);
    expect(r.embed.title).toBe("4215 | Team 4215");
    expect(r.chat?.card).toBe(true);
    expect(r.chat?.page).toBe(`${SITE}/search?q=${encodeURIComponent(q)}`);
  });

  it("a conversational reply posts no records card, even when search found some", async () => {
    // His words are an explanation, not a records answer: the card search incidentally has doesn't ride along with it.
    const r = await ask("explain a swerve", chatDeps({ text: "**A coaxial swerve keeps both motors on one axis.**", search: false }), SITE);
    expect(r.chat).toEqual({ text: "**A coaxial swerve keeps both motors on one axis.**" });
    expect(r.chat?.card).toBeUndefined();
    expect(r.chat?.page).toBeUndefined();
  });

  it("a records answer: its video, its card and its page go with his reply", async () => {
    const r = await ask("who won decode", chatDeps({ text: "30030 Exodus won.", search: true }), SITE);
    expect(r.chat).toEqual({ text: "30030 Exodus won.", card: true, video: "https://www.youtube.com/watch?v=AAA&t=90s", page: `${SITE}/search?q=who%20won%20decode` });
    expect(r.embed.title).toBe("4215 | Team 4215");
  });

  it("no chat reply (off, failed, timed out, a number not in the facts): the card at once, no second call to him", async () => {
    for (const d of [chatDeps(null), chatDeps(null, { chat: vi.fn(async () => { throw new Error("The operation was aborted due to timeout"); }) })]) {
      const r = await ask("4215", d, SITE);
      expect(r.chat).toBeUndefined();
      expect(r.embed.title).toBe("4215 | Team 4215");
      expect(r.meta.sentence).toBe(false);
      expect(d.bruno).not.toHaveBeenCalled();
    }
  });

  it("a follow-up in a thread: he gets the thread, and the facts for the last question too", async () => {
    const search = vi.fn(async (q: string) => base({ hits: [hit(q === "who won decode" ? 30030 : 4215)] }));
    const d = chatDeps({ text: "Second were 4215.", search: true }, { search });
    const history = [{ role: "user" as const, text: "who won decode" }, { role: "bruno" as const, text: "30030 Exodus won." }];
    await ask("and second?", d, SITE, history);
    expect(d.chat).toHaveBeenCalledWith("and second?", ["Result: 4215 | Team 4215", "Result: 30030 | Team 30030"], history, []);
  });

  it("the post: the question quoted for /ask, his words, the video, and a small credit line with an unpreviewed link", () => {
    expect(chatPost("who  won decode", { text: "30030 Exodus won.", video: "https://youtu.be/A", page: `${SITE}/search?q=x` }, { quote: true }).split("\n")).toEqual([
      "> **who won decode**", "30030 Exodus won.", "https://youtu.be/A", `-# Bruno AI · [more on controlscout.org](<${SITE}/search?q=x>)`,
    ]);
    expect(chatPost("hi", { text: "Hey!" }, { quote: false })).toBe("Hey!\n-# Bruno AI · controlscout.org");
    // A structured explanation goes out as he wrote it — a bold lead, paragraphs, bullets — whole, while Discord's own
    // 2,000-character message cap still holds for one that runs long.
    const answer = "**A coaxial swerve puts both drive motors on one axis.**\n\nThat keeps the wheel's turning on the module's pivot.\n- **Coaxial**: both motors share a shaft\n- **Offset**: the motors sit beside the pivot";
    expect(chatPost("explain a coaxial swerve", { text: answer }, { quote: false })).toBe(`${answer}\n-# Bruno AI · controlscout.org`);
    expect(chatPost("x", { text: "y".repeat(3000) }, { quote: false })).toHaveLength(2000);
  });
});

describe("a follow-up's facts", () => {
  it("a broad new answer doesn't crowd out the earlier question's records: both get a share, inside the caps", async () => {
    const many = (p: string) => Array.from({ length: 40 }, (_, i) => `${p} fact ${i}`);
    const search = vi.fn(async (q: string) => base({ q }));
    const facts = vi.fn(async (a: SearchAnswer) => many(a.q === "who won decode" ? "earlier" : "new"));
    const chat = vi.fn(async () => ({ text: "ok", search: false }));
    await ask("and second?", deps(base({ q: "and second?" }), { search, facts, chat }), SITE, [{ role: "user", text: "who won decode" }, { role: "bruno", text: "30030 won." }]);
    const sent = (chat.mock.calls[0] as unknown[])[1] as string[];
    expect(sent).toHaveLength(40);
    expect(sent.filter((f) => f.startsWith("new"))).toHaveLength(20);
    expect(sent.filter((f) => f.startsWith("earlier"))).toHaveLength(20);
    expect(sent[0]).toBe("new fact 0");
    expect(sent[20]).toBe("earlier fact 0");
  });
});

describe("ungrounded numbers", () => {
  it("names the numbers a reply has that the facts and question don't, so a dropped chat can be traced", async () => {
    const { ungrounded } = await import("../server/api/searchBrunoAnswer");
    expect(ungrounded("OPR 16, ranked #1,378 of 2,227 in 2026–27", ["16 OPR (#1,378 of 2,227 worldwide · 2026–27)"], "4215 opr")).toEqual([]);
    expect(ungrounded("OPR 16.4, bottom 38%", ["16 OPR · top 62%"], "4215 opr")).toEqual(["16.4", "38"]);
  });
});

describe("when no chat can answer", () => {
  const nothing = (q: string) => base({ q, hits: [], step: "recovery", recovery: { understood: ["no team, event or match"], closest: [], browse: [] } });
  /** Search finds nothing and Bruno's rewrite finds nothing either: the card is the website's sorry. */
  const plain = (q: string) => deps(nothing(q), { refine: vi.fn(async () => null) });

  it("a favourite, a greeting and thanks all get the one honest fallback, credited to Control Scout", async () => {
    for (const q of ["who's your favorite person in this server", "hi", "thanks!"]) {
      const r = await ask(q, plain(q), SITE);
      expect(r.chat?.by).toBe("scout");
      expect(r.chat?.text).toBe(NO_CHAT);
      expect(r.chat?.text).not.toMatch(/\d/);
      // What posts is the fallback, not the card (the card only stands in for a chat that didn't happen).
      expect(r.meta.chat).toBe(true);
      expect(chatPost(q, r.chat!, { quote: true })).toContain("-# Control Scout · [more on controlscout.org]");
      expect(chatPost(q, r.chat!, { quote: true })).not.toContain("Bruno AI");
    }
  });

  it("a chat that is wired and on but said nothing about this message doesn't claim its AI is unreachable", async () => {
    // The chat just answered the message before this one in the same channel: a reply it dropped (a number the facts
    // haven't, bot/ask.ts's grounded check), an empty one or a failure is about this message, not about the deployment.
    const q = "are you sure you are a bruno";
    const chat = vi.fn(async () => null);
    const d = deps(nothing(q), { chat, facts: vi.fn(async () => []), refine: vi.fn(async () => null) });
    const r = await ask(q, d, SITE);
    expect(chat).toHaveBeenCalled();
    expect(r.chat?.by).toBe("scout");
    expect(r.chat?.text).toBe(NO_REPLY);
    expect(r.chat?.text).not.toMatch(/unreachable/);
  });

  it("a chat that is off or unconfigured still says plainly that it can't chat", async () => {
    const q = "are you sure you are a bruno";
    const rest = { chat: vi.fn(async () => null), facts: vi.fn(async () => []), refine: vi.fn(async () => null) };
    expect((await ask(q, deps(nothing(q), { ...rest, enabled: vi.fn(async () => false) }), SITE)).chat?.text).toBe(NO_CHAT);
    expect((await ask(q, deps(nothing(q), { ...rest, available: () => false }), SITE)).chat?.text).toBe(NO_CHAT);
  });

  it("a chat about a mechanism posts even though his answer has a number: nothing found, nothing asked of the records", async () => {
    // The screenshot's question: search finds nothing for it, there is no number in it, so the numbers in his explanation
    // ("1:1", "2 motors") are how a swerve works, not a record — the reply posts instead of the fallback.
    const q = "coxial suspension swerve explain";
    const d = deps(nothing(q), {
      facts: vi.fn(async () => []), refine: vi.fn(async () => null),
      chat: vi.fn(async () => ({ text: "A coaxial swerve drives both wheels from one axis, usually 1:1.", search: false, unknown: ["1"] })),
    });
    const r = await ask(q, d, SITE);
    expect(r.chat?.text).toMatch(/1:1/);
    expect(r.chat?.by).toBeUndefined();
    expect(r.meta.chat).toBe(true);
  });

  it("a number the facts don't have still refuses his reply when the message asked about the records", async () => {
    const d = deps(base(), {
      facts: vi.fn(async () => ["4215 Hypnotic Robotics: 3 awards in 2025–26"]),
      chat: vi.fn(async () => ({ text: "4215 won 7 awards.", search: true, unknown: ["7"] })),
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const r = await ask("4215 awards", d, SITE);
      expect(r.chat).toBeUndefined();
      expect(r.embed.title).toBe("4215 | Team 4215");
      // The numbers only, so a dropped reply is traced to the number that failed.
      expect(info.mock.calls.flat().join(" ")).toContain("[bot] chat dropped: numbers not in the facts: 7");
    } finally { info.mockRestore(); }
  });

  it("the screenshot's build question with a ratio in it is a chat, not a record claim: his explanation posts", async () => {
    // "should I use a 42:15 gear reduction on my robot turret": the digits are a ratio, so his own numbers (a swerve's
    // 2:1, a turret's 3:1) are about the mechanism, not the records, and the reply is not thrown away.
    const q = "should I use a 42:15 gear reduction on my robot turret because it is my team numebr";
    const d = deps(nothing(q), {
      facts: vi.fn(async () => []), refine: vi.fn(async () => null),
      chat: vi.fn(async () => ({ text: "**42:15 is far too slow for a turret.** Most turrets land near 2:1 or 3:1 so they hold position under a hit.", search: false, unknown: ["2", "1", "3"] })),
    });
    const r = await ask(q, d, SITE);
    expect(r.chat?.text).toContain("42:15");
    expect(r.chat?.by).toBeUndefined();
  });

  it("a build question no chat answered gets the plain line, not search's guess at a team", async () => {
    // Search read "gear reduction" as Team 12499 Gear Up: telling someone asking about gearing that is worse than one
    // plain line saying this message got no answer.
    const q = "should I use a 42:15 gear reduction on my robot turret because it is my team numebr";
    const d = deps(nothing(q), { chat: vi.fn(async () => null), facts: vi.fn(async () => []), refine: vi.fn(async () => null) });
    expect((await ask(q, d, SITE)).chat?.text).toBe(NO_REPLY);
    // A records question still keeps its own card.
    const records = "who had the highest score at 2025 worlds";
    expect((await ask(records, plain(records), SITE)).chat).toBeUndefined();
  });

  it("the screenshot's maths question is a chat, not a records miss: the cosine posts", async () => {
    // "what is the cosine of 35 degrees i need it for a auto trust": 35 is a measurement, nowhere near a team, so his
    // value (0.8192) isn't a record claim, and the card no longer says no team matched.
    const q = "what is the cosine of 35 degrees i need it for a auto trust";
    const d = deps(nothing(q), {
      facts: vi.fn(async () => []), refine: vi.fn(async () => null),
      chat: vi.fn(async () => ({ text: "**cos(35°) ≈ 0.8192.** For an auto that swings an arm 35° from vertical, that's the height factor: about 0.82 of the arm's length.", search: false, unknown: ["0", "8192", "35"] })),
    });
    const r = await ask(q, d, SITE);
    expect(r.chat?.text).toContain("0.8192");
    expect(r.chat?.by).toBeUndefined();
    // No chat answer: the one plain line, not "No team, event or match matched".
    const none = deps(nothing(q), { chat: vi.fn(async () => null), facts: vi.fn(async () => []), refine: vi.fn(async () => null) });
    const line = await ask(q, none, SITE);
    expect(line.chat?.text).toBe(NO_REPLY);
    expect(line.embed.title).toBe(SORRY_SENTENCE);
  });

  it("a message naming a number is a records question, even when search finds nothing for it", async () => {
    const d = deps(nothing("99999 swerve ratio"), {
      facts: vi.fn(async () => []), refine: vi.fn(async () => null),
      chat: vi.fn(async () => ({ text: "Teams at that number usually run 2 motors on a 1:1.", search: false, unknown: ["2"] })),
    });
    expect((await ask("99999 swerve ratio", d, SITE)).chat).toBeUndefined();
  });

  it("the model's chat speaks first when it has something to say, fallback or not", async () => {
    const facts = vi.fn(async () => []);
    const chat = vi.fn(async () => ({ text: "Hey! Ask me about a team.", search: false }));
    const r = await ask("hi", deps(nothing("hi"), { chat, facts, refine: vi.fn(async () => null) }), SITE);
    expect(chat).toHaveBeenCalled();
    expect(r.chat?.by).toBeUndefined();
    expect(r.chat?.text).toBe("Hey! Ask me about a team.");
  });

  it("a records question search couldn't answer keeps the honest card", async () => {
    // A number makes it a records question however short: it never gets the chat fallback.
    const q = "who had the highest score at 2025 worlds";
    const r = await ask(q, plain(q), SITE);
    expect(r.chat).toBeUndefined();
    expect(r.embed.title).toBe(SORRY_SENTENCE);
  });
});

describe("the site's failed-search queue", () => {
  it("a records question search couldn't answer is fed to it, with the server; a greeting and an answered one are not", async () => {
    const miss = vi.fn();
    const nothing = (q: string) => base({ q, hits: [], step: "recovery", recovery: { understood: ["no team, event or match"], closest: [], browse: [] } });
    const q = "who had the highest score at 2025 worlds";
    const d = deps(nothing(q), { refine: vi.fn(async () => null), miss });
    await ask(q, d, SITE, [], [], "g1");
    expect(miss).toHaveBeenCalledWith(q, expect.objectContaining({ step: "recovery" }), "g1");
    // An answer search gave teaches the queue nothing.
    miss.mockClear();
    await ask("4215", deps(base(), { miss }), SITE, [], [], "g1");
    expect(miss).not.toHaveBeenCalled();
    // A greeting that no chat answered isn't a failed search either.
    await ask("hi", deps(nothing("hi"), { refine: vi.fn(async () => null), miss }), SITE, [], [], "g1");
    expect(miss).not.toHaveBeenCalled();
    // A chat that answers it does teach it nothing: the person got their answer.
    await ask(q, deps(nothing(q), { refine: vi.fn(async () => null), facts: vi.fn(async () => []), chat: vi.fn(async () => ({ text: "30030 won.", search: false })), miss }), SITE, [], [], "g1");
    expect(miss).not.toHaveBeenCalled();
    // A greeting is not a records question just because an earlier turn in the thread named a team: smallTalk answers it.
    await ask("thanks", deps(nothing("thanks"), { refine: vi.fn(async () => null), miss }), SITE, [{ role: "user", text: "who won 4215" }], [], "g1");
    expect(miss).not.toHaveBeenCalled();
    // And a question about the records with no number in it is one, even where the bot answers with its one plain line.
    for (const q of ["who won decode", "how did our alliance do at austin"]) {
      await ask(q, deps(nothing(q), { refine: vi.fn(async () => null), miss }), SITE, [], [], "g1");
      expect(miss).toHaveBeenLastCalledWith(q, expect.objectContaining({ step: "recovery" }), "g1");
    }
    // A greeting, a build question (even one whose "team" and "matches" are about the robot), and a long message with
    // nothing of the records in it are not.
    for (const q of ["hi", "should i use a 42:15 gear reduction on my turret", "what gear ratio should our team use in matches", "how do we keep our robot cool in a hot venue"]) {
      miss.mockClear();
      await ask(q, deps(nothing(q), { refine: vi.fn(async () => null), miss }), SITE, [], [], "g1");
      expect(miss).not.toHaveBeenCalled();
    }
  });
});

describe("a chat first", () => {
  it("a weak answer goes to the chat before search's rewrite: no refine or sentence when he replies", async () => {
    const d = deps(base({ step: "recovery", hits: [] }), {
      facts: vi.fn(async () => []),
      chat: vi.fn(async () => ({ text: "I couldn't find that one — try a team number.", search: false })),
    });
    const r = await ask("hypnotic trophies", d, SITE);
    expect(r.chat?.text).toBe("I couldn't find that one — try a team number.");
    expect(r.chat?.by).toBeUndefined();
    expect(d.refine).not.toHaveBeenCalled();
    expect(d.bruno).not.toHaveBeenCalled();
  });
});
