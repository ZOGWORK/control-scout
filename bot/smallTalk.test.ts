// One honest fallback (bot/smallTalk.ts): when no model answered and search found nothing, every short message that
// isn't a records question gets the same plain line — no canned greeting, no guessed favourite, no fact.
import { describe, expect, it } from "vitest";
import { NO_CHAT, NO_REPLY, SMALL_TALK_WORDS, smallTalk } from "./smallTalk";

describe("the one fallback", () => {
  it("answers the screenshot's favourite, a greeting, thanks, a joke and a goodbye the same honest way", () => {
    for (const q of [
      "who's your favorite person in this server",
      "hi",
      "hey there",
      "who are you",
      "are you a bot",
      "thanks!",
      "bye",
      "tell me a joke",
      "what can you do",
    ]) expect(smallTalk(q)).toBe(NO_CHAT);
  });

  it("says what's wrong and what still works, and names no favourite, fact or number", () => {
    expect(NO_CHAT).toMatch(/can't chat right now/);
    expect(NO_CHAT).toMatch(/records/);
    expect(NO_CHAT).toMatch(/a team, an event or a match/);
    expect(NO_CHAT).not.toMatch(/\d/);
    expect(NO_CHAT).not.toMatch(/favourite|favorite|opinion|I think/i);
  });

  it("a chat that is there and said nothing about this message is not called unreachable", () => {
    // The screenshot's exchange: the bot chatted twice, then met a message the model gave no usable reply to ("are you
    // sure you are a bruno"). The AI answers, so the line says only that this one got no answer.
    for (const q of ["are you sure you are a bruno", "hi", "thanks!"]) expect(smallTalk(q, true)).toBe(NO_REPLY);
    expect(smallTalk("are you sure you are a bruno")).toBe(NO_CHAT);
    expect(NO_REPLY).toMatch(/didn't get an answer/);
    expect(NO_REPLY).toMatch(/a team, an event or a match/);
    expect(NO_REPLY).not.toMatch(/unreachable|can't chat/);
    expect(NO_REPLY).not.toMatch(/\d/);
    expect(NO_REPLY).not.toMatch(/favourite|favorite|opinion|I think/i);
    // A records question keeps its honest card however the chat was doing.
    expect(smallTalk("6980", true)).toBeNull();
    expect(smallTalk("hello, which teams from romania are going to worlds this year and how are they ranked", true)).toBeNull();
  });

  it("leaves a records question alone: a number in it, or anything long", () => {
    expect(smallTalk("6980")).toBeNull();
    expect(smallTalk("2025 worlds")).toBeNull();
    expect(smallTalk("is it true that 4215 hypnotic robotics beat 6980 bad wolf at worlds this season")).toBeNull();
    expect(smallTalk("hello, which teams from romania are going to worlds this year and how are they ranked")).toBeNull();
    // Only reached when search found nothing either, so a records question with no number still reads as chat otherwise.
    expect(smallTalk("highest score in new jersey")).toBe(NO_CHAT);
  });

  it("a build question with a ratio gets the one line however long it is", () => {
    // The screenshot's message: search guessed "Team 12499 Gear Up" from "gear reduction", which answers nothing.
    const q = "should I use a 42:15 gear reduction on my robot turret because it is my team numebr";
    expect(smallTalk(q)).toBe(NO_CHAT);
    expect(smallTalk(q, true)).toBe(NO_REPLY);
    // A records question still keeps its card.
    expect(smallTalk("6980", true)).toBeNull();
    expect(smallTalk("is it true that 4215 hypnotic robotics beat 6980 bad wolf at worlds this season", true)).toBeNull();
  });

  it("counts words, so the length rule is the one the bot documents", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(SMALL_TALK_WORDS).toBe(12);
    expect(smallTalk(`${words(SMALL_TALK_WORDS - 1)} hi`)).toBe(NO_CHAT);
    expect(smallTalk(`${words(SMALL_TALK_WORDS + 1)} hi`)).toBeNull();
  });
});
