// @vitest-environment jsdom
// A question's answer card: a rule from the game manual has a book icon, a record (Worlds trips) the trophy.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchCard } from "../../shared/api";
import { AnswerCard } from "./SearchBox";

afterEach(cleanup);
const card = (kind: SearchCard["kind"]): SearchCard => ({ kind, title: kind === "rule" ? "Rule G418" : "Worlds appearances", lines: [{ text: "x" }] });

describe("AnswerCard icon", () => {
  it("a rule gets the book, a record keeps the trophy", () => {
    expect(render(<AnswerCard card={card("rule")} onOpen={() => {}} />).container.querySelector('[data-card-icon="rule"]')).toBeTruthy();
    cleanup();
    expect(render(<AnswerCard card={card("worlds")} onOpen={() => {}} />).container.querySelector('[data-card-icon="rule"]')).toBeNull();
  });
});
