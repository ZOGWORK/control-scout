// How search reads a query's words before matching (src/shared/searchQuery.ts): plurals, openings, stopwords,
// time words and a question's own words. The same rules run on the real data in server/api/search.test.ts.
import { describe, expect, it } from "vitest";
import { PLURALS, isQuestionForm, nameWords, singularize, stripConversation, timePhrase } from "./searchQuery";
import { cleanTeamName, searchTeamTitle, teamNameOf, teamWords } from "./teamTitle";

describe("plurals", () => {
  it("reads every listed plural as its singular, and only those", () => {
    for (const [plural, one] of Object.entries(PLURALS)) {
      expect(singularize(plural), plural).toBe(one);
      expect(singularize(`${plural[0].toUpperCase()}${plural.slice(1)} in New Jersey`), plural).toBe(`${one} in New Jersey`);
    }
    // A name's own plural that isn't listed stays as typed: "Robotics" is no plural of "Robotic".
    expect(singularize("Hypnotic Robotics")).toBe("Hypnotic Robotics");
    expect(singularize("meet")).toBe("meet");
  });
  it("makes 'meets' and 'meet' the same name words", () => {
    expect(nameWords("Meets in New Jersey").toLowerCase()).toBe(nameWords("Meet in New Jersey").toLowerCase());
    expect(nameWords("Meets at New Jersey").toLowerCase()).toBe(nameWords("Meet at new Jersey").toLowerCase());
    expect(nameWords("Meets in New Jersey")).toBe("meet New Jersey");
  });
});

describe("conversational openings", () => {
  it("strips the opening, never the same word later", () => {
    expect(stripConversation("how good is simply complex")).toEqual({ rest: "simply complex", opening: "how good is", topic: "stats" });
    expect(stripConversation("how good is Good Enough")).toMatchObject({ rest: "Good Enough" });
    expect(stripConversation("How Good Is Good Enough?")).toMatchObject({ rest: "Good Enough" });
    expect(stripConversation("what is the rank of 4215")).toMatchObject({ rest: "4215", topic: "rankings" });
    expect(stripConversation("where is 4215")).toEqual({ rest: "4215", opening: "where is" });
    expect(stripConversation("how is 4215 doing")).toMatchObject({ rest: "4215", topic: "stats" });
  });
  it("leaves a word with no opening as a keyword", () => {
    expect(stripConversation("good teams")).toBeNull();
    expect(stripConversation("good enough")).toBeNull();
    expect(stripConversation("how good is")).toBeNull(); // nothing after it
  });
});

describe("words that never name anything", () => {
  it("drops stopwords when other words are left", () => {
    expect(nameWords("the gear heads")).toBe("gear heads");
    expect(nameWords("battle at the bay")).toBe("battle bay");
    expect(nameWords("the")).toBe("the"); // nothing else: kept as typed
  });
  it("reads time words as time, never as a name", () => {
    expect(timePhrase("upcoming meets in New Jersey")).toEqual({ phrase: "upcoming", rest: "meets in New Jersey" });
    expect(timePhrase("meets this weekend")).toEqual({ phrase: "this weekend", rest: "meets" });
    expect(timePhrase("past meets in NJ")).toEqual({ phrase: "past", rest: "meets in NJ" });
    expect(nameWords("upcoming meets in New Jersey")).toBe("meet New Jersey");
    expect(nameWords("upcoming")).toBe("upcoming"); // alone: kept, never an empty search
    // "past" beside no event word is a name's word ("Pastabots" never was one anyway).
    expect(timePhrase("past glory robotics")).toBeNull();
  });
  it("drops a question's own words only from a question", () => {
    expect(isQuestionForm("Can robots descore sample elements in autonomous?")).toBe(true);
    expect(isQuestionForm("can robots descore samples")).toBe(true);
    expect(isQuestionForm("can control")).toBe(false); // a team's name, two words
    expect(nameWords("Can robots descore sample elements in autonomous?").split(" ")).not.toContain("Can");
    expect(nameWords("can control")).toBe("can control");
  });
});

describe("team titles", () => {
  it("shows the number and the name once each", () => {
    expect(searchTeamTitle(18061, "Simply Complex 18061")).toBe("18061 | Simply Complex");
    expect(searchTeamTitle(18061, "18061 Simply Complex")).toBe("18061 | Simply Complex");
    expect(searchTeamTitle(4215, "Hypnotic Robotics")).toBe("4215 | Hypnotic Robotics");
    expect(searchTeamTitle(4215, null)).toBe("4215");
    expect(searchTeamTitle(4215, "4215")).toBe("4215");
    // A number inside the name that isn't the team's own stays.
    expect(cleanTeamName(31825, "Robots 4 Good")).toBe("Robots 4 Good");
    expect(cleanTeamName(32128, "Village Robots 2025")).toBe("Village Robots 2025");
  });
  it("reads the name back from either title shape", () => {
    expect(teamNameOf("18061 | Simply Complex")).toBe("Simply Complex");
    expect(teamNameOf("4215 Hypnotic Robotics")).toBe("Hypnotic Robotics");
    expect(teamWords("18061 | Simply Complex")).toBe("18061 Simply Complex");
  });
});

describe("Greptile on #427", () => {
  it("takes every time phrase out, not just the first", () => {
    expect(nameWords("upcoming qualifiers this weekend in New Jersey")).toBe("qualifier New Jersey");
  });
  it("changes only listed plurals, never a word Object has", () => {
    expect(singularize("constructor toString meets")).toBe("constructor toString meet");
  });
});
