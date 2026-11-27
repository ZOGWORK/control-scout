// Discord's own limits on a card (bot/limits.ts): the check the bot's real cards are held to, so a sweep that goes one
// character or one field too far fails a test instead of a reader's post.
import { describe, expect, it } from "vitest";
import { LIMITS, embedChars, embedProblems } from "./limits";

const card = (over: object = {}) => ({ title: "Q1 · Meet", description: "Austin, TX", color: 0, ...over });

describe("Discord's limits on a card", () => {
  it("takes the cards the bot builds, blank-named continuation fields included", () => {
    expect(embedProblems(card())).toEqual([]);
    // A list's continuation field carries a zero-width space, not an empty name.
    expect(embedProblems(card({ fields: [{ name: "By OPR", value: "1. [4215](url) · **80**" }, { name: "\u200b", value: "2. [6980](url) · **78**" }] }))).toEqual([]);
  });

  it("names the part that breaks it", () => {
    expect(embedProblems(card({ title: "x".repeat(LIMITS.title + 1) }))).toEqual([{ where: "title", limit: LIMITS.title, length: LIMITS.title + 1 }]);
    expect(embedProblems(card({ fields: [{ name: "By OPR", value: "x".repeat(LIMITS.fieldValue + 1) }] })))
      .toEqual([{ where: "field 1 value", limit: LIMITS.fieldValue, length: LIMITS.fieldValue + 1 }]);
    expect(embedProblems(card({ fields: Array.from({ length: LIMITS.fields + 1 }, () => ({ name: "n", value: "v" })) })))
      .toContainEqual({ where: "fields", limit: LIMITS.fields, length: LIMITS.fields + 1 });
    expect(embedProblems(card({ footer: { text: "f".repeat(LIMITS.footer + 1) } })).map((p) => p.where)).toEqual(["footer"]);
  });

  it("refuses an empty field name or value, whatever its length", () => {
    expect(embedProblems(card({ fields: [{ name: "", value: "v" }] }))).toEqual([{ where: "field 1 name", limit: LIMITS.fieldName, length: 0, empty: true }]);
    expect(embedProblems(card({ fields: [{ name: "n", value: "" }] }))).toEqual([{ where: "field 1 value", limit: LIMITS.fieldValue, length: 0, empty: true }]);
  });

  it("adds every part up to the 6,000 an embed has", () => {
    // Each part inside its own limit, the card over Discord's for the whole embed: the sum is what it refuses.
    const e = card({ title: "t", description: "d".repeat(LIMITS.description), fields: [{ name: "n", value: "v".repeat(LIMITS.fieldValue) }, { name: "n", value: "v".repeat(LIMITS.fieldValue) }] });
    expect(embedChars(e)).toBe(1 + LIMITS.description + 2 * (1 + LIMITS.fieldValue));
    expect(embedProblems(e)).toEqual([{ where: "embed", limit: LIMITS.embed, length: embedChars(e) }]);
    // A card exactly at the 6,000 is one Discord takes (every part inside its own limit too).
    const exact = card({
      title: "t", description: "d".repeat(LIMITS.description),
      footer: { text: "f".repeat(LIMITS.embed - (1 + LIMITS.description + 1 + LIMITS.fieldValue)) },
      fields: [{ name: "n", value: "v".repeat(LIMITS.fieldValue) }],
    });
    expect(embedChars(exact)).toBe(LIMITS.embed);
    expect(embedProblems(exact)).toEqual([]);
  });
});
