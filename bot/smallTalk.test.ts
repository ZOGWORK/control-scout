// One honest fallback (bot/smallTalk.ts): when no model answered and search found nothing, every short message that
// isn't a records question gets the same plain line — no canned greeting, no guessed favourite, no fact.
import { describe, expect, it } from "vitest";
import { NO_CHAT, SMALL_TALK_WORDS, smallTalk } from "./smallTalk";

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

  it("leaves a records question alone: a number in it, or anything long", () => {
    expect(smallTalk("6980")).toBeNull();
    expect(smallTalk("2025 worlds")).toBeNull();
    expect(smallTalk("is it true that 4215 hypnotic robotics beat 6980 bad wolf at worlds this season")).toBeNull();
    expect(smallTalk("hello, which teams from romania are going to worlds this year and how are they ranked")).toBeNull();
    // Only reached when search found nothing either, so a records question with no number still reads as chat otherwise.
    expect(smallTalk("highest score in new jersey")).toBe(NO_CHAT);
  });

  it("counts words, so the length rule is the one the bot documents", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(SMALL_TALK_WORDS).toBe(12);
    expect(smallTalk(`${words(SMALL_TALK_WORDS - 1)} hi`)).toBe(NO_CHAT);
    expect(smallTalk(`${words(SMALL_TALK_WORDS + 1)} hi`)).toBeNull();
  });
});
