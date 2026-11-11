// Usernames: format, reserved names, case-insensitive uniqueness, the 30-day rule, suggestions, and the audit log.
import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { get, migrate, run, setDb } from "../db.js";
import { checkUsername, nameHistory, setDisplayName, setUsername } from "./username.js";
import { getUser } from "./session.js";
import { usernameProblem, usernameSuggestions } from "../../src/shared/username.js";

async function user(email: string, name: string | null = null) {
  const r = await get<{ id: number }>("INSERT INTO users (email, display_name, created_at) VALUES (?, ?, ?) RETURNING id", [email, name, new Date().toISOString()]);
  return (await getUser(Number(r!.id)))!;
}

beforeEach(async () => {
  const c = createClient({ url: ":memory:" });
  setDb(c);
  await migrate(c);
});

describe("username rules", () => {
  it("takes 3–20 letters, numbers and underscores, starting with a letter", () => {
    expect(usernameProblem("partv08")).toBeNull();
    expect(usernameProblem("ab")).toBe("format");
    expect(usernameProblem("8team")).toBe("format");
    expect(usernameProblem("has space")).toBe("format");
    expect(usernameProblem("a".repeat(21))).toBe("format");
    expect(usernameProblem("Admin")).toBe("reserved");
    expect(usernameProblem("gardenstatearchive")).toBe("reserved");
  });
  it("suggests the team number, then small numbers, never a rule-breaking one", () => {
    expect(usernameSuggestions("partv08", 4215, () => false)).toEqual(["partv08_4215", "partv08_2", "partv08_3"]);
    const long = usernameSuggestions("abcdefghijklmnopqrst", 4215, () => false);
    for (const s of long) expect(usernameProblem(s)).toBeNull();
    expect(usernameSuggestions("partv08", null, (u) => u === "partv08_2")).toEqual(["partv08_3", "partv08_4", "partv08_5"]);
  });
});

describe("setUsername", () => {
  it("is unique ignoring case and offers free ones when taken", async () => {
    const a = await user("a@example.test"), b = await user("b@example.test");
    expect((await setUsername(a, "Partv08")).ok).toBe(true);
    const out = await setUsername(b, "partv08", 4215);
    expect(out.ok).toBe(false);
    if (!out.ok) { expect(out.reason).toBe("taken"); expect(out.suggestions[0]).toBe("partv08_4215"); }
  });
  it("allows one change in 30 days and frees the old name at once", async () => {
    const a = await user("a@example.test"), b = await user("b@example.test");
    await setUsername(a, "first_one");
    const again = await setUsername((await getUser(a.id))!, "second_one");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("tooSoon");
    // 31 days on: the change goes through, and the old one is free for someone else.
    await run("UPDATE users SET username_changed_at = ? WHERE id = ?", [new Date(Date.now() - 31 * 864e5).toISOString(), a.id]);
    expect((await setUsername((await getUser(a.id))!, "second_one")).ok).toBe(true);
    expect((await setUsername(b, "first_one")).ok).toBe(true);
  });
  it("logs changes to the username and the actual name, as the account's own", async () => {
    const a = await user("a@example.test", "Parthiv");
    await setUsername(a, "testparthiv");
    await setDisplayName(a, "Parthiv M");
    await setDisplayName(a, "Parthiv M"); // no change: no row
    const h = await nameHistory(a.id);
    expect(h).toEqual([
      expect.objectContaining({ field: "username", from: null, to: "testparthiv" }),
      expect.objectContaining({ field: "name", from: "Parthiv", to: "Parthiv M" }),
    ]);
    expect((await get<{ actor: string }>("SELECT actor FROM owner_audit WHERE action = 'account.name'"))?.actor).toBe("a@example.test");
  });
  it("refuses reserved names and bad formats without touching the account", async () => {
    const a = await user("a@example.test");
    expect((await checkUsername(a, "owner")).ok).toBe(false);
    expect((await setUsername(a, "x")).ok).toBe(false);
    expect((await getUser(a.id))!.username).toBeNull();
  });
});

describe("two changes at once", () => {
  it("only one lands inside the 30 days", async () => {
    const a = await user("a@example.test");
    await setUsername(a, "first_one");
    await run("UPDATE users SET username_changed_at = ? WHERE id = ?", [new Date(Date.now() - 31 * 864e5).toISOString(), a.id]);
    const stale = (await getUser(a.id))!;
    const [x, y] = await Promise.all([setUsername(stale, "second_one"), setUsername(stale, "third_one")]);
    expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
    expect(["second_one", "third_one"]).toContain((await getUser(a.id))!.username);
  });
});
