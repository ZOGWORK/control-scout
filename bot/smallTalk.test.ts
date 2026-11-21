// Small talk (bot/smallTalk.ts): a short message that isn't a records question gets the bot's own reply, and a real
// question — a number, a long one, or one of the data phrasings — is left to search.
import { describe, expect, it } from "vitest";
import { SMALL_TALK_WORDS, smallTalk } from "./smallTalk";

describe("small talk", () => {
  it("answers the message from the screenshot: a favourite person, with no favourite and no invented fact", () => {
    const said = smallTalk("who's your favorite person in this server");
    expect(said).toMatch(/don't have favourites/);
    expect(said).not.toMatch(/\d/);
  });

  it("greets, introduces itself, says thanks and goodbye", () => {
    expect(smallTalk("hi")).toMatch(/^Hey — I'm Control Scout/);
    expect(smallTalk("hey there")).toBeTruthy();
    expect(smallTalk("who are you")).toMatch(/I'm Control Scout/);
    expect(smallTalk("are you a bot")).toMatch(/Not a person/);
    expect(smallTalk("thanks!")).toMatch(/^Anytime/);
    expect(smallTalk("bye")).toMatch(/^See you/);
  });

  it("says what it can do, and turns a joke into a records offer", () => {
    expect(smallTalk("what can you do")).toMatch(/look up any team/);
    expect(smallTalk("tell me a joke")).toMatch(/penalty/);
  });

  it("leaves every real question alone: numbers, data phrasings and anything long", () => {
    expect(smallTalk("6980")).toBeNull();
    expect(smallTalk("2025 worlds")).toBeNull();
    expect(smallTalk("who won decode")).toBeNull();
    expect(smallTalk("highest score in new jersey")).toBeNull();
    expect(smallTalk("is it true that 4215 hypnotic robotics beat 6980 bad wolf at worlds this season")).toBeNull();
    expect(smallTalk("hello, which teams from romania are going to worlds this year and how are they ranked")).toBeNull();
  });

  it("counts words, so the length rule is the one the bot documents", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(SMALL_TALK_WORDS).toBe(12);
    expect(smallTalk(`${words(SMALL_TALK_WORDS - 1)} hi`)).toBeTruthy();
    expect(smallTalk(`${words(SMALL_TALK_WORDS + 1)} hi`)).toBeNull();
  });
});
