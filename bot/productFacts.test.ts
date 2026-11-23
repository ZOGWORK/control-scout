import { expect, it } from "vitest";
import { answerScope, answerStyle, brunoMethod, brunoPersona, productFacts, zogModeReply } from "./productFacts";
import { ungrounded } from "../server/api/searchBrunoAnswer";

it("grounds the completed remodel and available Zog Mode without claiming its background is on", () => {
  const facts = productFacts();
  expect(facts.join(" ")).toContain("remodel is complete");
  expect(facts.join(" ")).toContain("yellow/gold");
  expect(facts.join(" ")).toContain("multiple angled streams");
  expect(facts.join(" ")).toContain("existing, available");
  expect(facts.join(" ")).not.toMatch(/currently (?:enabled|disabled)|Dog Mode/);
  // The one public access rule is kept (the owner chooses whether it shows); internals never are.
  expect(facts.join(" ")).not.toMatch(/dogTheme|internal flag/i);
  expect(ungrounded("The v8 remodel is complete. Zog Mode exists and is available.", facts, "what changed?")).toEqual([]);
});
it("keeps every product fact inside Control Point's 400-character cap, so none is clipped mid-sentence", () => {
  const facts = productFacts();
  for (const f of facts) expect(f.length).toBeLessThanOrEqual(400);
  expect(facts.find((f) => f.startsWith("Zog Mode is an existing"))).toMatch(/Only the owner can turn it on or off/);
});

it("knows he is Bruno, a golden retriever in spirit — and that he is software, not a dog or a person", () => {
  const who = brunoPersona();
  expect(who.length).toBeLessThanOrEqual(400);
  expect(who).toMatch(/You are Bruno/);
  expect(who).toMatch(/golden retriever/);
  expect(who).toMatch(/friendly, loyal, eager to help/);
  // A light touch only when asked: no self-introduction in every answer, and no pretending to be the dog.
  expect(who).toMatch(/unless someone asks who you are/);
  expect(who).toMatch(/software, not a real dog or a person/);
});

it("asks him to think the question through first, and to say what's missing rather than guess — inside the cap", () => {
  const how = brunoMethod();
  expect(how.length).toBeLessThanOrEqual(400);
  expect(how).toMatch(/Think before you answer/);
  expect(how).toContain("show a calculation's steps");
  expect(how).toMatch(/say what's missing rather than guessing/);
  expect(how).toMatch(/Cut filler/);
  // A message asking several things is answered part by part, from the facts bot/tools.ts gathers for each.
  expect(how).toMatch(/answer each part the facts cover and say which part they don't/);
});

it("tells him how to shape a chat answer — records short, how/why in paragraphs or bullets, a build request in steps — inside the cap", () => {
  const style = answerStyle();
  expect(style.length).toBeLessThanOrEqual(400);
  expect(style).toMatch(/records gets the number/);
  expect(style).toMatch(/How\/why gets a \*\*bold\*\* summary/);
  expect(style).toContain("'- ' bullets");
  // The shape the swerve-drive guide missed: a how-to is steps, not a records line.
  expect(style).toMatch(/how-to or build guide/);
  expect(style).toMatch(/3-6 numbered steps with parts, sizes and numbers/);
  expect(style).toMatch(/1,000-1,800 chars/);
  // Still a Discord message, not a document.
  expect(style).toMatch(/No headings, tables or code/);
  // And the records question is offered only on a records answer: a guide doesn't end with an OPR nudge.
  expect(style).toMatch(/only on a records answer/);
});

it("lets him answer the channel's own questions — maths, design, rules — inside the cap, with FTC numbers still from the facts", () => {
  const scope = answerScope();
  expect(scope.length).toBeLessThanOrEqual(400);
  expect(scope).toMatch(/not only Control Scout or FTC ones/);
  expect(scope).toMatch(/a cosine/);
  expect(scope).toMatch(/Never refuse a question just because it isn't about the records/);
  // What he must never invent still can't: a team's numbers are the facts'.
  expect(scope).toMatch(/FTC numbers \(a team's OPR, record, score\) still come only from the facts/);
});

it("recognizes the screenshot's question but leaves actual dog-named teams to search", () => {
  expect(zogModeReply("where is the dog")).toContain("Zog Mode");
  expect(zogModeReply("turn on zog mode")).toContain("Zog Mode exists");
  expect(zogModeReply("turn on zog mode")).not.toMatch(/owner|console|flag|settings|enabled|disabled|turned on/i);
  expect(zogModeReply("Sea Dog Robotics scores")).toBeNull();
  expect(zogModeReply("team zog rankings")).toBeNull();
  expect(zogModeReply("zog 1234")).toBeNull();
  expect(zogModeReply("who is zog")).toBeNull();
  expect(zogModeReply("zog stats")).toBeNull();
});
