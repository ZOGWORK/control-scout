// Deleting an account leaves nothing that names the person: their sign-in code, their name and username
// history in the owner audit (the rows stay, who and what don't), the invite they claimed, and the address
// on what they sent through /contact and bug reports. Someone else's rows are untouched.
import { beforeAll, describe, expect, it } from "vitest";
import { all, DELETED_ACCOUNT_ACTOR, get, migrate, openDb, run, setDb } from "../db";
import { recordAudit } from "../portal/audit";
import { deleteUser, userForIdentity } from "./session";
import { setDisplayName } from "./username";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});

const now = () => new Date().toISOString();

async function seed(email: string) {
  const user = await userForIdentity("email", email, email);
  await setDisplayName(user, `Name of ${email}`);
  await setDisplayName(user, `New name of ${email}`);
  await run("INSERT INTO email_codes (email, code_hash, expires_at, window_start) VALUES (?, 'h', ?, ?)", [email, now(), now()]);
  await run("INSERT INTO contributor_invites (token_hash, email, created_by, created_at, expires_at, claimed_by_user_id, claimed_at) VALUES (?, ?, 'owner', ?, ?, ?, ?)",
    [`t-${email}`, email, now(), now(), user.id, now()]);
  await run("INSERT INTO bug_reports (created_at, category, message, email) VALUES (?, 'bug', 'it broke', ?)", [now(), email.toUpperCase()]);
  await run("INSERT INTO contact_messages (created_at, topic, email, message) VALUES (?, 'other', ?, 'hello')", [now(), email]);
  return user;
}

describe("deleteUser", () => {
  it("removes or anonymises every personal row tied to the account, and only that account's", async () => {
    const gone = await seed("gone@example.com");
    const kept = await seed("kept@example.com");
    await recordAudit("owner@example.com", "flags.set", { userId: gone.id }, null, { from: false, to: true }); // not theirs to erase

    await deleteUser(gone.id);

    expect(await get("SELECT 1 FROM email_codes WHERE email = ?", ["gone@example.com"])).toBeUndefined();
    const audit = await all<any>("SELECT actor, action, old_value, new_value FROM owner_audit WHERE json_extract(details, '$.userId') = ? ORDER BY id", [gone.id]);
    expect(audit.filter((r) => r.action === "account.name")).toEqual([
      { actor: DELETED_ACCOUNT_ACTOR, action: "account.name", old_value: null, new_value: null },
      { actor: DELETED_ACCOUNT_ACTOR, action: "account.name", old_value: null, new_value: null },
    ]);
    expect(audit.find((r) => r.action === "flags.set")).toMatchObject({ actor: "owner@example.com", old_value: "false", new_value: "true" });
    expect(JSON.stringify(await all("SELECT * FROM owner_audit"))).not.toContain("gone@example.com");
    expect((await get<any>("SELECT claimed_by_user_id, claimed_at FROM contributor_invites WHERE token_hash = 't-gone@example.com'"))).toMatchObject({ claimed_by_user_id: null });
    expect(await get("SELECT 1 FROM bug_reports WHERE email = ? COLLATE NOCASE", ["gone@example.com"])).toBeUndefined();
    expect(await get("SELECT 1 FROM contact_messages WHERE email = ?", ["gone@example.com"])).toBeUndefined();
    expect(Number((await get<any>("SELECT COUNT(*) n FROM contact_messages WHERE message = 'hello'")).n)).toBe(2); // the message itself stays

    // The other account keeps all of it.
    expect(await get("SELECT 1 FROM email_codes WHERE email = ?", ["kept@example.com"])).toBeTruthy();
    expect(await all("SELECT 1 FROM owner_audit WHERE actor = 'kept@example.com' AND new_value IS NOT NULL")).toHaveLength(2);
    expect(Number((await get<any>("SELECT claimed_by_user_id FROM contributor_invites WHERE token_hash = 't-kept@example.com'")).claimed_by_user_id)).toBe(kept.id);
    expect(await get("SELECT 1 FROM bug_reports WHERE email = ? COLLATE NOCASE", ["kept@example.com"])).toBeTruthy();
    expect(await get("SELECT 1 FROM contact_messages WHERE email = ?", ["kept@example.com"])).toBeTruthy();
  });

  it("the audit log stays append-only for everything else", async () => {
    const id = await recordAudit("owner@example.com", "account.name", { userId: 1 }, null, { from: "a", to: "b" });
    // Half an erasure (values kept, or another actor) is refused, as is editing any other action.
    await expect(run("UPDATE owner_audit SET actor = ? WHERE id = ?", [DELETED_ACCOUNT_ACTOR, id])).rejects.toThrow(/append-only/);
    await expect(run("UPDATE owner_audit SET actor = 'x', old_value = NULL, new_value = NULL WHERE id = ?", [id])).rejects.toThrow(/append-only/);
    await expect(run("UPDATE owner_audit SET action = 'flags.set' WHERE id = ?", [id])).rejects.toThrow(/append-only/);
    await expect(run("DELETE FROM owner_audit WHERE id = ?", [id])).rejects.toThrow(/append-only/);
    const other = await recordAudit("owner@example.com", "flags.set", null, null, { from: 1, to: 2 });
    await expect(run("UPDATE owner_audit SET actor = ?, old_value = NULL, new_value = NULL WHERE id = ?", [DELETED_ACCOUNT_ACTOR, other])).rejects.toThrow(/append-only/);
  });
});
