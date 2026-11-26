// The answer's buttons: a question lives in a store, not in the custom id (100 characters is not a question); it
// outlives the process in the database and expires after 30 days; the components carry at most four ask buttons, then
// the website link and the videos.
import { describe, expect, it } from "vitest";
import { ASK_PREFIX, LABEL_MAX, QUESTIONS_MAX, QUESTION_TTL_MS, QuestionButtons, answerComponents, buttonLabel, buttonQuestion, type ButtonStore } from "./buttons";
import type { AskReply } from "./ask";

const reply = (over: Partial<AskReply> = {}): AskReply => ({
  embed: { title: "Answer", url: "https://controlscout.org/search?q=x" },
  meta: { step: "deterministic", refined: false, sentence: false },
  ...over,
});

/** A stand-in for the database: what a restart would still find. */
const memoryStore = (): ButtonStore & { rows: Map<string, { question: string; at: number; guild: string | null }> } => {
  const rows = new Map<string, { question: string; at: number; guild: string | null }>();
  return {
    rows,
    put: async (id, question, at, guild) => { rows.set(id, { question, at, guild }); },
    get: async (id) => rows.get(id) ?? null,
    prune: async () => {},
  };
};

describe("the question store", () => {
  it("hands back the words a button stands for, until 30 days after the answer", async () => {
    const b = new QuestionButtons();
    const id = await b.put("who won decode", 1_000);
    expect(id.startsWith(ASK_PREFIX)).toBe(true);
    expect(await b.get(id, 1_000)).toBe("who won decode");
    expect(await b.get(id, 1_000 + QUESTION_TTL_MS)).toBe("who won decode");
    expect(await b.get(id, 1_000 + QUESTION_TTL_MS + 1)).toBeNull();
    // Forgotten once expired, so the cache can't grow with old answers.
    expect(b.size).toBe(0);
  });

  it("still answers after a restart, from the store", async () => {
    const store = memoryStore();
    const first = new QuestionButtons(store);
    const id = await first.put("4215 opr", 1_000, "g1");
    expect(store.rows.get(id)).toEqual({ question: "4215 opr", at: 1_000, guild: "g1" });
    // A fresh process has no cache, but the same store: the button under the old answer still works.
    expect(await new QuestionButtons(store).get(id, 2_000)).toBe("4215 opr");
    // An expired row is not kept, even when the store still has it.
    expect(await new QuestionButtons(store).get(id, 1_000 + QUESTION_TTL_MS + 1)).toBeNull();
  });

  it("knows nothing of an id it never made, or of another button's", async () => {
    const b = new QuestionButtons();
    expect(await b.get("ask:zzz")).toBeNull();
    expect(await buttonQuestion(b, "follow:4215")).toBeNull();
    const id = await b.put("4215 opr");
    expect(await buttonQuestion(b, id, 0)).toBe("4215 opr");
    // Two stores in one process still make different ids, so one answer's button never asks another's question.
    expect(await new QuestionButtons().put("who won decode")).not.toBe(await new QuestionButtons().put("who won decode"));
    expect(await new QuestionButtons().get(id)).toBeNull();
  });

  it("keeps at most QUESTIONS_MAX questions in the process cache, dropping the oldest", async () => {
    const b = new QuestionButtons();
    const first = await b.put("first", 0);
    await Promise.all(Array.from({ length: QUESTIONS_MAX }, (_, i) => b.put(`q${i}`, 0)));
    expect(b.size).toBe(QUESTIONS_MAX);
    expect(await b.get(first, 0)).toBeNull();
  });

  it("labels fit Discord's 80 characters, on one line", () => {
    expect(buttonLabel("  4215   awards ")).toBe("4215 awards");
    const long = buttonLabel("x".repeat(200));
    expect(long).toHaveLength(LABEL_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the components", () => {
  it("a row of ask buttons, then a row with the website and the videos", async () => {
    const b = new QuestionButtons();
    const rows = await answerComponents(reply({ next: ["4215 awards", "4215 opr", "4215 worlds", "4215 at worlds", "one too many"], watch: [{ label: "Q85", url: "https://youtu.be/A" }] }), b, 0, "g1");
    expect(rows).toHaveLength(2);
    expect(rows[0].components).toHaveLength(4); // four at most: the fifth would pass Discord's row cap
    expect(rows[0].components[0]).toMatchObject({ type: 2, style: 2, label: "4215 awards" });
    expect(rows[1].components.map((c) => (c as { label?: string }).label)).toEqual(["Open on controlscout.org", "Q85"]);
    // Each ask button's custom id is the store's, and gives the words back.
    const id = (rows[0].components[0] as { custom_id: string }).custom_id;
    expect(await buttonQuestion(b, id, 0)).toBe("4215 awards");
  });

  it("nothing to offer, no row: no empty components on a message", async () => {
    expect(await answerComponents(reply({ embed: { title: "x" } }), new QuestionButtons())).toEqual([]);
    const only = await answerComponents(reply(), new QuestionButtons());
    expect(only).toHaveLength(1);
    expect(only[0].components).toHaveLength(1);
  });
});
