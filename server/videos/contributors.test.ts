// Match videos people add (docs/contributors.md): the three tiers, the spoofing case (the self-set My team grants
// nothing), no leak to a viewer who may not see a link, the add-time rules, likes and reports, revocation and
// promotion, and both ways of getting verified. YouTube is a stub: no network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { get, migrate, run, setDb } from "../db.js";
import { getUser, type User } from "../auth/session.js";
import { addVideo, editOwnVideo, contributorProfile, eventVideos, removeOwnVideo, reportVideo, setLike, statusOf, viewerOf, SIGNED_OUT } from "./contributors.js";
import { approve, claimInvite, createInvite, grantRoster, readInvite, reject, requestFromInvite, revoke, revokeInvite, submitApplication, withdrawApplication } from "./verification.js";
import { ownerLinkAction, ownerContributors } from "./moderation.js";
import { forgetMembership } from "./membership.js";

vi.mock("../env.js", async (orig) => {
  const m = await orig<typeof import("../env.js")>();
  return { env: new Proxy(m.env, { get: (t, k) => (k === "youtubeApiKey" || k === "controlPointUrl" ? null : Reflect.get(t, k)) }) };
});
// YouTube: a watch page that plays (3 minutes), one that's gone, one 45 minutes long, and channel pages.
const page = (status: string, length: number) => `"playabilityStatus":{"status":"${status}","reason":""} "lengthSeconds":"${length}"`;
const yt = vi.fn(async (url: string) => {
  const id = /v=([^&]+)/.exec(url)?.[1] ?? "";
  if (/youtube\.com\/@/.test(url)) return new Response(url.includes("@nobody") ? "nope" : `"externalId":"UC${"a".repeat(22)}"`, { status: url.includes("@nobody") ? 404 : 200 });
  if (id.startsWith("gone")) return new Response(page("ERROR", 0));
  if (id.startsWith("long")) return new Response(page("OK", 2700));
  return new Response(page("OK", 180));
});
vi.stubGlobal("fetch", yt);

const S = 2025, E = "USNJTEST";
const M6 = { season: S, code: E, level: "qual", series: 0, number: 6 };
const M7 = { ...M6, number: 7 };
const M9 = { ...M6, number: 9 }; // not played

async function user(email: string, name: string | null, username: string | null): Promise<User> {
  const r = await get<{ id: number }>("INSERT INTO users (email, display_name, username, created_at) VALUES (?, ?, ?, ?) RETURNING id", [email, name, username, new Date().toISOString()]);
  return (await getUser(Number(r!.id)))!;
}
const fresh = async (u: User) => (await getUser(u.id))!;
const url = (id: string) => `https://youtu.be/${id}`;

let owner: User, verified: User, hyp: User, hyp2: User, pigeon: User, loner: User;
beforeEach(async () => {
  const c = createClient({ url: ":memory:" });
  setDb(c);
  await migrate(c);
  forgetMembership();
  await run("INSERT INTO events (season, code, name, source) VALUES (?, ?, 'NJ Test Meet', 'first')", [S, E]);
  for (const n of [6, 7, 8]) await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, 'first')", [S, E, n, `Q${n}`]);
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (?, ?, 'qual', 0, 9, 'Q9', 0, 'first')", [S, E]);
  for (const [n, name] of [[4215, "Hypnotic"], [23314, "Galactic Pigeon"]] as const) await run("INSERT INTO teams (number, name) VALUES (?, ?)", [n, name]);
  owner = await user("owner@example.test", "Owner", "owner_one");
  verified = await user("ver@example.test", "Test Parthiv", "testparthiv");
  hyp = await user("hyp@example.test", "Hyp One", "hyp_one");
  hyp2 = await user("hyp2@example.test", "Hyp Two", "hyp_two");
  pigeon = await user("pig@example.test", "Pigeon", "pigeon_one");
  loner = await user("lone@example.test", "Lone", "lone_one");
  for (const [u, t] of [[hyp, 4215], [hyp2, 4215], [pigeon, 23314]] as const) await grantRoster(u.email!, t, null, "owner@example.test");
});

describe("tiers", () => {
  it("a team-only link shows to that team and its contributor, and to nobody else (Parthiv's example)", async () => {
    const add = await addVideo(hyp, M6, { url: url("teamclip01") });
    expect(add.ok).toBe(true);
    if (add.ok) expect(add.video.tier).toBe("team");
    expect((await eventVideos(S, E, await viewerOf(hyp2))).get("qual:0:6")?.name).toBe("Hyp One");
    expect((await eventVideos(S, E, await viewerOf(hyp))).get("qual:0:6")?.mine).toBe(true);
    expect((await eventVideos(S, E, await viewerOf(pigeon))).size).toBe(0);
    expect((await eventVideos(S, E, SIGNED_OUT)).size).toBe(0);
  });

  it("the self-set My team grants nothing (spoofing)", async () => {
    await addVideo(hyp, M6, { url: url("teamclip01") });
    await run("INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, 'myTeam', '4215', ?)", [pigeon.id, Date.now()]);
    forgetMembership();
    expect((await viewerOf(pigeon)).teams).toEqual([23314]);
    expect((await eventVideos(S, E, await viewerOf(pigeon))).size).toBe(0);
  });

  it("a verified contributor's link is public, signed out included, with the badge", async () => {
    await run("INSERT INTO video_contributors (user_id, status, source, requested_at) VALUES (?, 'pending', 'direct', ?)", [verified.id, new Date().toISOString()]);
    await approve(verified.id, "owner@example.test");
    const add = await addVideo(await fresh(verified), M6, { url: url("pubclip001") });
    expect(add.ok && add.video.tier).toBe("public");
    const seen = (await eventVideos(S, E, SIGNED_OUT)).get("qual:0:6");
    expect(seen).toMatchObject({ name: "Test Parthiv", verified: true, videoId: "pubclip001" });
    expect(JSON.stringify(seen)).not.toContain("testparthiv@"); // no email
    expect(seen?.profile).toBe("/contributors/testparthiv");
  });

  it("no team and not verified: refused (it stays a personal link on the device)", async () => {
    const add = await addVideo(loner, M6, { url: url("lonely0001") });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.code).toBe("noTeam");
  });

  it("a team the contributor isn't on is refused, whatever the client sends", async () => {
    const add = await addVideo(hyp, M6, { url: url("teamclip01"), team: 23314 });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.code).toBe("team");
  });

  it("a link whose contributor has no name isn't served", async () => {
    await addVideo(hyp, M6, { url: url("teamclip01") });
    await run("UPDATE users SET display_name = NULL WHERE id = ?", [hyp.id]);
    expect((await eventVideos(S, E, await viewerOf(hyp2))).size).toBe(0);
  });
});

describe("adding", () => {
  it("refuses an unplayed match, a non-YouTube link and a gone video; warns on a long one", async () => {
    expect(await addVideo(hyp, M9, { url: url("teamclip01") })).toMatchObject({ ok: false, code: "unplayed" });
    expect(await addVideo(hyp, M6, { url: "https://vimeo.com/123" })).toMatchObject({ ok: false, error: "That doesn't look like a YouTube link." });
    expect(await addVideo(hyp, M6, { url: url("gone000001") })).toMatchObject({ ok: false, error: "This video is private or deleted." });
    expect(await addVideo(hyp, M6, { url: url("long000001") })).toMatchObject({ ok: false, code: "long" });
    expect((await addVideo(hyp, M6, { url: url("long000001"), confirmLong: true })).ok).toBe(true);
    // A timestamp where the match starts makes a long video a fine match link.
    expect((await addVideo(hyp, M7, { url: "https://www.youtube.com/watch?v=long000002&t=754" })).ok).toBe(true);
  });

  it("asks before the same video goes on a second match, and records the confirm", async () => {
    await addVideo(hyp, M6, { url: url("teamclip01") });
    const again = await addVideo(hyp, M7, { url: url("teamclip01") });
    expect(again).toMatchObject({ ok: false, code: "duplicate" });
    if (!again.ok) expect(again.error).toBe("This video is already linked to Q6 at NJ Test Meet — are you sure it's Q7?");
    expect((await addVideo(hyp, M7, { url: url("teamclip01"), confirmDuplicate: true })).ok).toBe(true);
    expect(await get("SELECT 1 FROM owner_audit WHERE action = 'video.duplicate_confirmed'")).toBeTruthy();
  });

  it("the first live link keeps the match's slot; a second is stored and told so", async () => {
    await addVideo(hyp, M6, { url: url("teamclip01") });
    const second = await addVideo(hyp2, M6, { url: url("teamclip02") });
    expect(second).toMatchObject({ ok: true, shown: false, occupiedBy: "Hyp One" });
  });

  it("20 links a day, server-side: the 21st is told to slow down", async () => {
    const many = [6, 7, 8];
    let last;
    for (let i = 0; i < 21; i++) last = await addVideo(hyp, { ...M6, number: many[i % 3] }, { url: url(`rate${String(i).padStart(6, "0")}`), confirmDuplicate: true });
    expect(last).toMatchObject({ ok: false, status: 429 });
    expect(Number((await get<{ n: number }>("SELECT COUNT(*) n FROM contributor_videos WHERE contributor_user_id = ?", [hyp.id]))!.n)).toBeLessThanOrEqual(20);
  });

  it("needs a username and an actual name", async () => {
    const noName = await user("x@example.test", null, "x_one");
    expect(await addVideo(noName, M6, { url: url("teamclip01") })).toMatchObject({ ok: false, code: "setup" });
  });
});

describe("likes, reports, removal", () => {
  it("likes toggle, one per account, and a hidden link answers as if it didn't exist", async () => {
    const add = await addVideo(hyp, M6, { url: url("teamclip01") });
    const id = add.ok ? add.video.id : 0;
    expect(await setLike(hyp2, id, true)).toEqual({ likes: 1, liked: true });
    expect(await setLike(hyp2, id, true)).toEqual({ likes: 1, liked: true });
    expect(await setLike(hyp2, id, false)).toEqual({ likes: 0, liked: false });
    expect(await setLike(pigeon, id, true)).toBeNull();
    expect(await reportVideo(pigeon, id, "wrong_match", "")).toMatchObject({ ok: false, status: 404 });
  });

  it("a link the owner hid can still be edited by its contributor, and stays hidden", async () => {
    const add = await addVideo(hyp, M6, { url: url("teamclip01") });
    const id = add.ok ? add.video.id : 0;
    expect(await ownerLinkAction(id, "hide", "owner@example.test", null)).toMatchObject({ ok: true });
    const out = await editOwnVideo(hyp, id, { url: url("teamclip02") });
    expect(out).toMatchObject({ ok: true, shown: false, video: { id, videoId: "teamclip02" } });
    expect((await get<{ status: string }>("SELECT status FROM contributor_videos WHERE id = ?", [id]))?.status).toBe("hidden");
  });

  it("one open report per reporter; reports never hide a link; self-removal resolves them as removed", async () => {
    const add = await addVideo(hyp, M6, { url: url("teamclip01") });
    const id = add.ok ? add.video.id : 0;
    expect(await reportVideo(hyp2, id, "wrong_match", "It's Q7")).toEqual({ ok: true, already: false });
    expect(await reportVideo(hyp2, id, "wrong_match", "")).toEqual({ ok: true, already: true });
    expect(await reportVideo(hyp, id, "wrong_match", "")).toMatchObject({ ok: false }); // not your own
    expect((await eventVideos(S, E, await viewerOf(hyp2))).get("qual:0:6")).toBeTruthy();
    await setLike(hyp2, id, true);
    expect(await removeOwnVideo(hyp, id)).toBe(true);
    expect((await eventVideos(S, E, await viewerOf(hyp2))).size).toBe(0);
    expect(await get("SELECT resolution FROM contributor_video_reports WHERE video_id = ?", [id])).toMatchObject({ resolution: "removed" });
    expect(await get("SELECT 1 FROM contributor_video_likes WHERE video_id = ?", [id])).toBeUndefined();
    // Their own removal makes no inbox item.
    expect(await get("SELECT 1 FROM inbox_items WHERE user_id = ?", [hyp.id])).toBeUndefined();
  });

  it("the owner removing a link tells the contributor, and the match falls back", async () => {
    const a = await addVideo(hyp, M6, { url: url("teamclip01") });
    await addVideo(hyp2, M6, { url: url("teamclip02") });
    await ownerLinkAction(a.ok ? a.video.id : 0, "remove", "owner@example.test", "wrong match");
    expect((await eventVideos(S, E, await viewerOf(hyp2))).get("qual:0:6")?.videoId).toBe("teamclip02");
    expect(await get<{ title: string }>("SELECT title FROM inbox_items WHERE user_id = ? AND category = 'videoContributions'", [hyp.id])).toMatchObject({ title: "One of your videos was removed: Q6 at NJ Test Meet" });
  });
});

describe("verification", () => {
  it("promotion: approving an unverified contributor makes their team links public, and says how many", async () => {
    await addVideo(hyp, M6, { url: url("teamclip01") });
    await run("INSERT INTO video_contributors (user_id, status, source, requested_at) VALUES (?, 'pending', 'application', ?)", [hyp.id, new Date().toISOString()]);
    expect(await approve(hyp.id, "owner@example.test")).toMatchObject({ ok: true, promoted: 1 });
    expect((await eventVideos(S, E, SIGNED_OUT)).get("qual:0:6")?.tier).toBe("public");
  });

  it("revocation: public links drop to the team if still on it, else only theirs; verifying again brings them back", async () => {
    await approve(verified.id, "owner@example.test", { direct: true });
    await addVideo(await fresh(verified), M6, { url: url("pubclip001") });
    expect(await revoke(verified.id, "owner@example.test", "testing")).toMatchObject({ ok: true, toTeam: 0, toSelf: 1 });
    expect((await eventVideos(S, E, SIGNED_OUT)).size).toBe(0);
    expect((await eventVideos(S, E, await viewerOf(verified))).get("qual:0:6")?.verified).toBe(false);
    expect((await approve(verified.id, "owner@example.test", { direct: true })).ok).toBe(true);
    expect((await eventVideos(S, E, SIGNED_OUT)).get("qual:0:6")?.verified).toBe(true);
  });

  it("invites: no login wall to read, single use, revocable, and claiming needs the account ready", async () => {
    const inv = await createInvite("ver@example.test", "Archive", "owner@example.test");
    if (!inv.ok) throw new Error(inv.error);
    expect(await readInvite(inv.token, null)).toMatchObject({ state: "valid" });
    expect((await claimInvite(verified, inv.token)).ok).toBe(true);
    expect(await claimInvite(hyp, inv.token)).toMatchObject({ ok: false, code: "claimed", error: "This invite was already claimed." });
    expect((await requestFromInvite(verified, inv.token)).ok).toBe(true);
    const q = await ownerContributors();
    expect(q.requests[0]).toMatchObject({ source: "invite", invite: { intendedEmail: "ver@example.test", note: "Archive", emailMatches: true } });
    const other = await createInvite("hyp@example.test", null, "owner@example.test");
    if (!other.ok) throw new Error(other.error);
    expect(await revokeInvite(require("node:crypto").createHash("sha256").update(other.token).digest("hex").slice(0, 16), "owner@example.test")).toBe(true);
    expect(await claimInvite(hyp, other.token)).toMatchObject({ ok: false, error: "This link is no longer valid." });
  });

  const form = (o: Record<string, unknown> = {}) => ({
    teamNumber: 4215, teamName: "Hypnotic", role: "student" as const, roleOther: "", events: "NJ State Championship, March 2026",
    channelUrl: "https://www.youtube.com/@somechannel", sampleUrl: url("sample0001"), recorded: "recorded_myself" as const,
    why: "I record every NJ qualifier and want teams to find them.", extra: "",
    agreements: { own: true, correct: true, noSpam: true, removable: true, publicName: true }, ...o,
  });

  it("applications: every field checked, nothing written on a refusal, one pending at a time, withdraw frees it", async () => {
    for (const bad of [{ sampleUrl: "" }, { agreements: { own: true } }, { teamNumber: 99999 }, { why: "videos" }, { channelUrl: "https://www.youtube.com/@nobody" }]) {
      const out = await submitApplication(loner, form(bad));
      expect(out.ok).toBe(false);
    }
    expect(await get("SELECT 1 FROM verification_applications")).toBeUndefined();
    expect((await submitApplication(loner, form())).ok).toBe(true);
    expect((await statusOf(loner)).status).toBe("pending");
    expect(await submitApplication(loner, form())).toMatchObject({ ok: false, error: "You already have an application waiting for review." });
    expect(await withdrawApplication(loner)).toBe(true);
    expect((await submitApplication(loner, form())).ok).toBe(true);
  });

  it("three applications in 30 days at most, even sent at once", async () => {
    for (let i = 0; i < 2; i++) { expect((await submitApplication(loner, form())).ok).toBe(true); expect(await withdrawApplication(loner)).toBe(true); }
    const both = await Promise.all([submitApplication(loner, form()), submitApplication(loner, form())]);
    expect(both.filter((x) => x.ok)).toHaveLength(1);
    expect(await withdrawApplication(loner)).toBe(true);
    expect(await submitApplication(loner, form())).toMatchObject({ ok: false, status: 429 });
    expect((await get<{ n: number }>("SELECT COUNT(*) n FROM verification_applications"))?.n).toBe(3);
  });

  it("a rejection shares its reason (or the plain line), and holds re-applying for 7 days, invites included", async () => {
    await submitApplication(loner, form());
    await reject(loner.id, "owner@example.test", "Send a sample from an NJ event", "looked thin");
    const st = await statusOf(loner);
    expect(st.rejected?.reason).toBe("Send a sample from an NJ event");
    expect(JSON.stringify(st)).not.toContain("looked thin");
    expect((await submitApplication(loner, form())).ok).toBe(false);
    const inv = await createInvite("lone@example.test", null, "owner@example.test");
    if (!inv.ok) throw new Error(inv.error);
    expect(await claimInvite(loner, inv.token)).toMatchObject({ ok: false, code: "cooldown" });
    const item = await get<{ body: string }>("SELECT body FROM inbox_items WHERE user_id = ? ORDER BY id DESC", [loner.id]);
    expect(item?.body).toBe("Send a sample from an NJ event");
  });

  it("claiming an invite while an application is pending withdraws it", async () => {
    await submitApplication(loner, form());
    const inv = await createInvite("lone@example.test", null, "owner@example.test");
    if (!inv.ok) throw new Error(inv.error);
    await claimInvite(loner, inv.token);
    await requestFromInvite(loner, inv.token);
    expect(await get("SELECT status, withdrawn_reason FROM verification_applications WHERE user_id = ?", [loner.id])).toMatchObject({ status: "withdrawn", withdrawn_reason: "claimed an invite" });
    expect((await ownerContributors()).requests.map((r) => r.source)).toEqual(["invite"]);
  });

  it("the profile lists only what this viewer may see", async () => {
    await addVideo(hyp, M6, { url: url("teamclip01") });
    expect((await contributorProfile("hyp_one", hyp2))?.videos.length).toBe(1);
    expect((await contributorProfile("hyp_one", null))?.videos.length).toBe(0);
    expect(await contributorProfile("nobody_here", null)).toBeNull();
  });
});
