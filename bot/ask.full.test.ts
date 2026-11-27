// An answer bigger than one card: the embed shows its start (one block, three rows, about 500 characters as read), and
// the whole of it — every block, every list's rows — rides along for the "Show the full answer" button (bot/buttons.ts).
import { describe, expect, it } from "vitest";
import type { SearchAnswer, SearchHit } from "../src/shared/api";
import type { LeaderboardRow, StatAnswer } from "../src/shared/searchStat";
import { answerPost, askEmbed } from "./ask";

const SITE = "https://controlscout.org";

const boardRows = (n: number): LeaderboardRow[] =>
  Array.from({ length: n }, (_, i) => ({
    rank: i + 1, team: { label: `${i + 1}`, href: `/teams/${i + 1}` }, location: "Oradell, NJ",
    record: "1-0-0", opr: 100 - i, value: 100 - i, display: `${100 - i}`,
  }));

/** A board of `n` teams, then a second block the short card leaves to the website. */
const board = (n: number): StatAnswer => ({
  family: "leaderboard", intent: "opr-top", title: "Top OPR", scope: [],
  blocks: [
    { kind: "leaderboard", title: "Top OPR", stat: { id: "opr", label: "OPR" }, note: "2025–26", rows: boardRows(n) },
    { kind: "links", title: "Also", items: [{ label: "All teams", href: "/teams" }] },
  ],
  definition: "OPR without penalties", source: "2025–26 matches",
});

const answer = (stat: StatAnswer): SearchAnswer => ({ q: "top opr", hits: [], pages: [], step: "deterministic", weak: false, stat });
const hit: SearchHit = { kind: "team", ref: "4215", title: "4215 | Hypnotic Robotics", subtitle: "Oradell, NJ", season: 2025 };

describe("an answer bigger than one card", () => {
  it("shows the start of a board, and hands over the whole of it", () => {
    const a = answer(board(10));
    const post = answerPost("top opr", a, null, SITE);
    // The card: the first block's three rows, and where the rest went.
    expect(post.embed.description).toContain("3. [3](");
    expect(post.embed.description).not.toContain("4. ");
    expect(post.embed.description).toMatch(/…and 7 more on the website/);
    // The rest: every row, and the block the card never drew.
    expect(post.full).toBeDefined();
    expect(post.full!.startsWith("**Top OPR**\n")).toBe(true);
    expect(post.full).toContain("10. [10](");
    expect(post.full).toContain("**Also**");
    expect(post.full).toContain("All teams");
    expect(post.full).not.toContain("…more on the website");
    expect(post.full).toContain("[Open this answer on controlscout.org]");
  });

  it("is the same embed askEmbed gives, so nothing about a short answer changes", () => {
    const a = answer(board(10));
    expect(askEmbed("top opr", a, null, SITE)).toEqual(answerPost("top opr", a, null, SITE).embed);
  });

  it("a stat card that already holds everything carries no whole", () => {
    // No headline, one block of two rows: the card is the answer, so the button would open the same lines again.
    const a = answer({ ...board(2), blocks: [board(2).blocks[0]], title: "Top OPR" });
    const post = answerPost("top opr", a, null, SITE);
    expect(post.embed.description).toContain("2. [2](");
    expect(post.full).toBeUndefined();
  });

  it("a headline with its rows behind it still carries its whole", () => {
    const a = answer({ ...board(5), headline: { value: "100", label: "OPR", href: "/teams/1" } });
    const post = answerPost("top opr", a, null, SITE);
    expect(post.embed.description).not.toContain("1. ");
    expect(post.full).toBeDefined();
    expect(post.full).toContain("5. [5](");
  });

  it("shows every row of a long list, not the first twenty-five", () => {
    const post = answerPost("top opr", answer(board(40)), null, SITE);
    expect(post.full).toContain("40. [40](");
    expect(post.full).toContain("26. [26](");
  });

  it("lists every result, not the first fifteen", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({ ...hit, ref: String(4000 + i), title: `${4000 + i} | Team ${4000 + i}` }));
    const post = answerPost("team", { q: "team", step: "deterministic", weak: false, pages: [], hits } as SearchAnswer, null, SITE);
    expect(post.full).toContain("4019 | Team 4019");
  });

  it("a short answer carries no whole: there is nothing more to show", () => {
    const a: SearchAnswer = { q: "4215", hits: [hit], pages: [], step: "deterministic", weak: false };
    const post = answerPost("4215", a, null, SITE);
    expect(post.embed.description).toContain("[4215 | Hypnotic Robotics]");
    expect(post.full).toBeUndefined();
  });

  it("a lead cut by the read limit still carries its whole", () => {
    // Ten results, no card: three fit the read, and the other seven are the rest of the answer.
    const a: SearchAnswer = {
      q: "hypnotic", step: "deterministic", weak: false, pages: [],
      hits: Array.from({ length: 10 }, (_, i) => ({ ...hit, ref: String(4000 + i), title: `${4000 + i} | Team ${4000 + i}` })),
    };
    const post = answerPost("hypnotic", a, null, SITE);
    expect(post.full).toBeDefined();
    expect(post.full).toContain("4009 | Team 4009");
  });
});
