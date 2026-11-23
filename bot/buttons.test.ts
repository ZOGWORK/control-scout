// The answer's buttons: a question lives in the store, not in the custom id (100 characters is not a question), and it
// expires after an hour; the components carry at most four ask buttons, then the website link and the videos.
import { describe, expect, it } from "vitest";
import { ASK_PREFIX, LABEL_MAX, QUESTIONS_MAX, QUESTION_TTL_MS, QuestionButtons, answerComponents, buttonLabel, buttonQuestion } from "./buttons";
import type { AskReply } from "./ask";

const reply = (over: Partial<AskReply> = {}): AskReply => ({
  embed: { title: "Answer", url: "https://controlscout.org/search?q=x" },
  meta: { step: "deterministic", refined: false, sentence: false },
  ...over,
});

describe("the question store", () => {
  it("hands back the words a button stands for, until an hour after the answer", () => {
    const b = new QuestionButtons();
    const id = b.put("who won decode", 1_000);
    expect(id.startsWith(ASK_PREFIX)).toBe(true);
    expect(b.get(id, 1_000)).toBe("who won decode");
    expect(b.get(id, 1_000 + QUESTION_TTL_MS)).toBe("who won decode");
    expect(b.get(id, 1_000 + QUESTION_TTL_MS + 1)).toBeNull();
    // Forgotten once expired, so an hour of answers can't grow the process.
    expect(b.size).toBe(0);
  });

  it("knows nothing of an id it never made (a restart), or of another button's", () => {
    const b = new QuestionButtons();
    expect(b.get("ask:zzz")).toBeNull();
    expect(buttonQuestion(b, "follow:4215")).toBeNull();
    const id = b.put("4215 opr");
    expect(buttonQuestion(b, id, 0)).toBe("4215 opr");
    // Two processes each count from 0: their first ids still differ, so an old message's button never asks what a
    // restarted bot's first answer offers.
    expect(new QuestionButtons().put("who won decode")).not.toBe(new QuestionButtons().put("who won decode"));
    expect(new QuestionButtons().get(id)).toBeNull();
  });

  it("keeps at most QUESTIONS_MAX questions, dropping the oldest", () => {
    const b = new QuestionButtons();
    const first = b.put("first", 0);
    for (let i = 0; i < QUESTIONS_MAX; i++) b.put(`q${i}`, 0);
    expect(b.size).toBe(QUESTIONS_MAX);
    expect(b.get(first, 0)).toBeNull();
  });

  it("labels fit Discord's 80 characters, on one line", () => {
    expect(buttonLabel("  4215   awards ")).toBe("4215 awards");
    const long = buttonLabel("x".repeat(200));
    expect(long).toHaveLength(LABEL_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the components", () => {
  it("a row of ask buttons, then a row with the website and the videos", () => {
    const b = new QuestionButtons();
    const rows = answerComponents(reply({ next: ["4215 awards", "4215 opr", "4215 worlds", "4215 at worlds", "one too many"], watch: [{ label: "Q85", url: "https://youtu.be/A" }] }), b, 0);
    expect(rows).toHaveLength(2);
    expect(rows[0].components).toHaveLength(4); // four at most: the fifth would pass Discord's row cap
    expect(rows[0].components[0]).toMatchObject({ type: 2, style: 2, label: "4215 awards" });
    expect(rows[1].components.map((c) => (c as { label?: string }).label)).toEqual(["Open on controlscout.org", "Q85"]);
    // Each ask button's custom id is the store's, and gives the words back.
    const id = (rows[0].components[0] as { custom_id: string }).custom_id;
    expect(buttonQuestion(b, id, 0)).toBe("4215 awards");
  });

  it("nothing to offer, no row: no empty components on a message", () => {
    expect(answerComponents(reply({ embed: { title: "x" } }), new QuestionButtons())).toEqual([]);
    const only = answerComponents(reply(), new QuestionButtons());
    expect(only).toHaveLength(1);
    expect(only[0].components).toHaveLength(1);
  });
});
