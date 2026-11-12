// /ask: the website's search answer as one embed, Bruno only where the site would use him, credited only then.
import { describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../src/shared/api";
import { BRUNO_CREDIT, DESCRIPTION_MAX, ask, askEmbed, fitLines, type AskDeps } from "./ask";
import { grounded } from "../server/api/searchBrunoAnswer";

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
    expect(lines).toContain("`/ask question: 9999 awards`");
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

  it("shows the question as asked above every answer (and the sorry), plus up to 2 questions to ask next", () => {
    expect(askEmbed("who  won decode", base(), null, SITE).author).toEqual({ name: "Asked: who won decode" });
    expect(askEmbed("x", base({ step: "recovery", hits: [], sorry: { understood: [], suggest: [] } }), null, SITE).author!.name).toBe("Asked: x");
    const e = askEmbed("4215", base({ suggest: ["4215 awards", "4215 opr", "4215 worlds"] }), null, SITE);
    expect(e.description).toContain("**Ask next:** `/ask question: 4215 awards` · `/ask question: 4215 opr`");
    expect(e.description).not.toContain("4215 worlds");
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
    expect(src).not.toMatch(/isEnabled\("bruno(Search|Answers)"\)/);
  });
});
