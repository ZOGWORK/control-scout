// What one Discord post can hold: the embed carries the answer up to Discord's own description limit (whole lines,
// every block with its own title), and the rest — a board's rows past the cut, a compound question's other parts, a
// card's every line — comes back for the handler to post in the channel under it. Nothing is dropped, and there is no
// "more on the website".
import { describe, expect, it } from "vitest";
import type { SearchAnswer, SearchHit } from "../src/shared/api";
import type { LeaderboardRow, StatAnswer } from "../src/shared/searchStat";
import { DESCRIPTION_MAX, answerPost, askEmbed } from "./ask";

const SITE = "https://controlscout.org";

const boardRows = (n: number): LeaderboardRow[] =>
  Array.from({ length: n }, (_, i) => ({
    rank: i + 1, team: { label: `${i + 1}`, href: `/teams/${i + 1}` }, location: "Oradell, NJ",
    record: "1-0-0", opr: 100 - i, value: 100 - i, display: `${100 - i}`,
  }));

/** A board of `n` teams, then a second block. */
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

describe("an answer bigger than one post", () => {
  it("a table's every column is posted, not the first four", () => {
    const stat: StatAnswer = {
      family: "leaderboard", intent: "opr-top", title: "Table", scope: [],
      blocks: [{
        kind: "table", title: "Quals", columns: ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, label: key.toUpperCase() })),
        rows: [{ cells: { a: "A", b: "B", c: "C", d: "D", e: "E", f: "F" } }],
      }],
      definition: "d", source: "s",
    };
    const post = answerPost("table", answer(stat), null, SITE);
    expect(post.embed.description).toContain("A · B · C · D · E · F");
  });

  it("posts a board whole in the embed when Discord can hold it, with nothing left over", () => {
    const post = answerPost("top opr", answer(board(10)), null, SITE);
    // No cap of ours: all ten rows, and the block the card used to leave to the website.
    expect(post.embed.description).toContain("1. [1](");
    expect(post.embed.description).toContain("10. [10](");
    expect(post.embed.description).toContain("**Also**");
    expect(post.embed.description).toContain("All teams");
    expect(post.embed.description).not.toContain("more on the website");
    expect(post.rest).toBeUndefined();
  });

  it("hands over the rows the embed can't hold, and loses none", () => {
    const post = answerPost("top opr", answer(board(200)), null, SITE);
    expect(post.embed.description!.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(post.rest).toBeDefined();
    // Every row is in the post, the embed's lines and the rest together.
    const all = `${post.embed.description}\n${post.rest}`;
    for (const rank of [1, 25, 100, 200]) expect(all).toContain(`${rank}. [${rank}](`);
  });

  it("is the same embed askEmbed gives, so nothing about an ordinary answer changes", () => {
    const a = answer(board(10));
    expect(askEmbed("top opr", a, null, SITE)).toEqual(answerPost("top opr", a, null, SITE).embed);
  });

  it("keeps a headline's rows behind it, in the embed or the rest", () => {
    const a = answer({ ...board(5), headline: { value: "100", label: "OPR", href: "/teams/1" } });
    const post = answerPost("top opr", a, null, SITE);
    const all = `${post.embed.description}\n${post.rest ?? ""}`;
    expect(post.embed.description).toContain("OPR");
    expect(post.embed.description).toContain("[100](");
    expect(all).toContain("1. [1](");
    expect(all).toContain("5. [5](");
  });

  it("a short answer carries no rest: there is nothing more to show", () => {
    const a: SearchAnswer = { q: "4215", hits: [hit], pages: [], step: "deterministic", weak: false };
    const post = answerPost("4215", a, null, SITE);
    expect(post.embed.description).toContain("[4215 | Hypnotic Robotics]");
    expect(post.rest).toBeUndefined();
  });

  it("hands over every result too long for one embed", () => {
    const a: SearchAnswer = {
      q: "hypnotic", step: "deterministic", weak: false, pages: [],
      hits: Array.from({ length: 10 }, (_, i) => ({ ...hit, ref: String(4000 + i), title: `${4000 + i} | Team ${4000 + i}` })),
    };
    const post = answerPost("hypnotic", a, null, SITE);
    const all = `${post.embed.description}\n${post.rest ?? ""}`;
    expect(all).toContain("4009 | Team 4009");
  });
});
